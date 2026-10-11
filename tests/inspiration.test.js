const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Memory = require('../www/memory.js');
const Inspiration = require('../www/inspiration.js');

const snapshot = {
    apiKey: 'sk-test-only', model: 'deepseek-flash',
    settings: '【世界书】\n现代小镇\n【角色设定】\n角色A很怕水',
    memory: '双方约好下午去图书馆。',
    conversations: [{ role: 'user', content: '第十二章，两个人走进图书馆。' }, { role: 'assistant', content: '角色A在门口等候。' }],
    direction: '推进两个人的日常互动',
};
const suggestions = ['一起找书', '讨论午餐', '发现旧书上的留言'].map((text, index) => ({ title: `候选${index}`, text }));
function response(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
function success(items = suggestions) {
    return response({ choices: [{ message: { content: JSON.stringify({ suggestions: items }) } }], usage: { total_tokens: 1200 } });
}
function rejected() {
    return response({ error: { message: 'Insufficient Balance (request_id: cfddcc2d-28c9-4531-8b22-cf8182937a21)' } }, 402);
}
function balance(available) {
    return response({ is_available: available, balance_infos: [{ currency: 'CNY', total_balance: available ? '10.25' : '0' }] });
}

test('灵感在超长设定和消息下仍受输入预算约束，并保留最近用户输入', () => {
    const input = {
        ...snapshot,
        settings: ['【世界书】', '【角色设定】', '【文风】'].map(title => title + '\n' + '详细设定'.repeat(20000)).join('\n'),
        memory: '长期事件'.repeat(20000),
        conversations: [...Array.from({ length: 50 }, () => ({ role: 'assistant', content: '较早剧情'.repeat(5000) })),
            { role: 'user', content: '第十三章，最新的章节指令。' },
            { role: 'assistant', content: '最新正文'.repeat(30000) + '人物抵达图书馆。' }],
    };
    const before = JSON.stringify(input);
    const standard = Inspiration.buildRequest(input);
    const compact = Inspiration.buildRequest(input, true);
    assert.ok(Memory.estimateMessagesTokens(standard.messages) < 9000);
    assert.ok(Memory.estimateMessagesTokens(compact.messages) < 4600);
    for (const request of [standard, compact]) {
        assert.match(request.messages[1].content, /第十三章/);
        assert.match(request.messages[1].content, /人物抵达图书馆/);
        assert.match(request.messages[1].content, /【角色设定】/);
        assert.match(request.messages[0].content, /候选只是沙盒草稿/);
    }
    assert.equal(JSON.stringify(input), before);
});

test('成功后可以连续再次生成，模型与密钥保持一致且每次请求独立', async () => {
    const signals = [];
    const before = JSON.stringify(snapshot);
    const fetch = async (url, options) => {
        assert.match(url, /chat\/completions$/);
        assert.equal(options.headers.Authorization, 'Bearer sk-test-only');
        assert.equal(JSON.parse(options.body).model, snapshot.model);
        signals.push(options.signal);
        return success();
    };
    for (let attempt = 0; attempt < 3; attempt++) {
        const result = await Inspiration.requestRecommendations(snapshot, { fetch });
        assert.deepEqual(result.suggestions, suggestions);
    }
    assert.equal(new Set(signals).size, 3);
    assert.equal(JSON.stringify(snapshot), before);
});

test('402且账户可调用时仅精简重试一次，后续正常请求仍可成功', async () => {
    const calls = [];
    const replies = [rejected(), balance(true), success(), success()];
    const fetch = async (url, options) => { calls.push({ url, options }); return replies.shift(); };
    let notices = 0;
    const result = await Inspiration.requestRecommendations(snapshot, { fetch, onCompactRetry: () => notices++ });
    assert.deepEqual(result.suggestions, suggestions);
    assert.equal(result.compact, true);
    assert.equal(notices, 1);
    assert.match(calls[1].url, /user\/balance$/);
    assert.equal(calls[1].options.headers.Authorization, calls[0].options.headers.Authorization);
    assert.ok(JSON.parse(calls[2].options.body).max_tokens < JSON.parse(calls[0].options.body).max_tokens);
    const next = await Inspiration.requestRecommendations(snapshot, { fetch });
    assert.equal(next.compact, false);
    assert.equal(calls.length, 4);
});

test('402且余额核验不可调用时不重复生成，也不会把有余额的响应解释为零余额', async () => {
    let count = 0;
    await assert.rejects(Inspiration.requestRecommendations(snapshot, {
        fetch: async () => ++count === 1 ? rejected() : balance(false),
    }), error => {
        assert.equal(error.status, 402);
        assert.equal(error.balance.available, false);
        assert.match(Inspiration.describeError(error), /没有可调用余额/);
        assert.equal(error.requestId, 'cfddcc2d-28c9-4531-8b22-cf8182937a21');
        assert.doesNotMatch(JSON.stringify(error.diagnostics), /sk-test-only|第十二章/);
        return true;
    });
    assert.equal(count, 2);
});

test('账户仍可调用但连续两次402时停止重试并保留两次请求详情', async () => {
    let count = 0;
    await assert.rejects(Inspiration.requestRecommendations(snapshot, {
        fetch: async () => ++count === 2 ? balance(true) : rejected(),
    }), error => {
        assert.equal(error.balance.available, true);
        assert.equal(error.diagnostics.length, 2);
        assert.match(Inspiration.describeError(error), /账户查询显示仍可调用/);
        assert.doesNotMatch(Inspiration.describeError(error), /没有可调用余额/);
        return true;
    });
    assert.equal(count, 3);
});

test('余额查询失败时保留原402而不编造余额状态', async () => {
    let count = 0;
    await assert.rejects(Inspiration.requestRecommendations(snapshot, {
        fetch: async () => ++count === 1 ? rejected() : response({ error: { message: 'unavailable' } }, 503),
    }), error => {
        assert.equal(error.status, 402);
        assert.equal(error.balance, null);
        assert.match(Inspiration.describeError(error), /尚未核实/);
        assert.ok(error.balanceCheckError);
        return true;
    });
    assert.equal(count, 2);
});

test('401和429不触发余额检查或自动重试', async () => {
    for (const status of [401, 429]) {
        let count = 0;
        await assert.rejects(Inspiration.requestRecommendations(snapshot, {
            fetch: async () => { count++; return response({ error: { message: 'rejected' } }, status); },
        }), error => error.status === status);
        assert.equal(count, 1);
    }
});

test('超时和用户取消都会释放独立请求，下一次生成仍可成功', async () => {
    const pendingFetch = async (url, options) => new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('aborted', 'AbortError'));
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
    });
    await assert.rejects(Inspiration.requestRecommendations(snapshot, { fetch: pendingFetch, timeoutMs: 10 }), /请求超时/);
    const controller = new AbortController();
    const pending = Inspiration.requestRecommendations(snapshot, { fetch: pendingFetch, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, error => error.name === 'AbortError');
    const next = await Inspiration.requestRecommendations(snapshot, { fetch: async () => success() });
    assert.equal(next.suggestions.length, 3);
});

test('返回空候选或损坏JSON会给出可重试错误，不触发额外付费请求', async () => {
    for (const reply of [success([]), response({ choices: [{ message: { content: '{"suggestions":[' } }] })]) {
        let count = 0;
        await assert.rejects(Inspiration.requestRecommendations(snapshot, {
            fetch: async () => { count++; return reply; },
        }), /请重新生成/);
        assert.equal(count, 1);
    }
});

// Exercise the actual UI request lifecycle in a small DOM-free harness.
function uiHarness(requestRecommendations) {
    const html = fs.readFileSync(require.resolve('../www/index.html'), 'utf8');
    const start = html.indexOf('            function getInspirationState(');
    const end = html.indexOf('            function getCurrentSnippetTarget(', start);
    const element = () => ({ disabled: false, hidden: false, value: '', textContent: '', style: {}, innerHTML: '', querySelectorAll: () => [] });
    const agent = { id: 'story-a', conversations: snapshot.conversations, memory: Memory.createEmptyMemory() };
    const context = {
        AbortController, Map, Date, JSON,
        appData: { activeMode: 'story', apiKey: snapshot.apiKey, storyMemorySettings: {} },
        Inspiration: { ...Inspiration, requestRecommendations }, Memory,
        Story: { buildStructuredPrompt: () => snapshot.settings }, StyleLab: { buildInfluencePrompt: () => '' },
        getCurrentAgent: () => agent, getActiveModel: () => snapshot.model,
        escapeHtml: value => value, showToast: () => {}, appendToComposer: () => {},
        inspirationStates: new Map(), activeInspirationRequest: null, activeBalanceRequest: null,
    };
    for (const name of ['btnGenerateInspiration', 'inspirationRequestInput', 'btnCancelInspiration', 'inspirationOverlay',
        'inspirationNotice', 'inspirationNoticeText', 'inspirationDetails', 'inspirationDiagnostics', 'inspirationResults',
        'apiBalanceStatus', 'inspirationBalanceStatus', 'btnRefreshApiBalance', 'btnInspirationBalance']) context['$' + name] = element();
    vm.createContext(context);
    vm.runInContext(html.slice(start, end), context);
    return context;
}

test('界面首次成功、第二次失败后保留候选并恢复按钮，第三次可正常生成', async () => {
    let count = 0;
    const context = uiHarness(async () => {
        if (++count === 2) throw new Error('temporary failure');
        return { suggestions };
    });
    await context.generateInspiration();
    const first = context.$inspirationResults.innerHTML;
    await context.generateInspiration();
    assert.equal(context.$inspirationResults.innerHTML, first);
    assert.equal(context.$btnGenerateInspiration.disabled, false);
    assert.match(context.$inspirationNoticeText.textContent, /上次成功的候选仍可使用/);
    await context.generateInspiration();
    assert.equal(count, 3);
    assert.equal(context.activeInspirationRequest, null);
});

test('关闭窗口再发起生成时旧请求结果不会覆盖新候选，连点不会重复请求', async () => {
    const pending = [];
    const context = uiHarness(async () => new Promise(resolve => pending.push(resolve)));
    const first = context.generateInspiration();
    await context.generateInspiration();
    assert.equal(pending.length, 1);
    context.closeInspiration();
    const second = context.generateInspiration();
    const newer = [{ title: '新候选', text: '最新请求的结果' }];
    pending[1]({ suggestions: newer });
    await second;
    pending[0]({ suggestions });
    await first;
    assert.match(context.$inspirationResults.innerHTML, /最新请求的结果/);
    assert.doesNotMatch(context.$inspirationResults.innerHTML, /一起找书/);
    assert.equal(context.$btnGenerateInspiration.disabled, false);
});

test('不同剧情的候选独立，生成不会增加正式消息或改变长期记忆', async () => {
    const context = uiHarness(async () => ({ suggestions }));
    const firstAgent = context.getCurrentAgent();
    const firstBefore = JSON.stringify(firstAgent);
    await context.generateInspiration();
    context.closeInspiration();
    const secondAgent = { id: 'story-b', conversations: [], memory: Memory.createEmptyMemory() };
    context.getCurrentAgent = () => secondAgent;
    context.openInspiration();
    assert.doesNotMatch(context.$inspirationResults.innerHTML, /一起找书/);
    context.getCurrentAgent = () => firstAgent;
    context.openInspiration();
    assert.match(context.$inspirationResults.innerHTML, /一起找书/);
    assert.equal(JSON.stringify(firstAgent), firstBefore);
    assert.equal(secondAgent.conversations.length, 0);
    assert.deepEqual(secondAgent.memory, Memory.createEmptyMemory());
});
