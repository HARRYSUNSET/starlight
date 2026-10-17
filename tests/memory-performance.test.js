const test = require('node:test');
const assert = require('node:assert/strict');
const Memory = require('../www/memory.js');

test('token 估算保留中日韩、表情和混合文本的既有计费边界', () => {
    const samples = ['', null, 'ascii words 123', '中文测试', 'かなカナ한국어', '🙂𠮷𠀀', '\u33ff\u3400\u9fff\ua000\uf900\ufaff'];
    let seed = 4711;
    const alphabet = ['中', '文', 'か', '한', '🙂', 'A', ' ', '\n', '0', '，'];
    for (let sample = 0; sample < 200; sample += 1) {
        let text = '';
        for (let index = 0; index < sample * 3; index += 1) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            text += alphabet[seed % alphabet.length];
        }
        samples.push(text);
    }
    for (const input of samples) {
        const text = String(input || '');
        const cjkCount = (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
        const expected = text ? Math.ceil(cjkCount * 1.15 + (text.length - cjkCount) / 3.6 + 4) : 0;
        assert.equal(Memory.estimateTokens(input), expected);
        assert.equal(Memory.estimateTokens(input), expected, '缓存命中保持同一估算');
    }
});

test('编辑同一消息对象后立即重新计算 token 和上下文窗口', () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({
        id: `message-${index}`,
        role: index % 2 ? 'assistant' : 'user',
        content: '简短消息',
    }));
    const original = Memory.estimateMessagesTokens(messages);
    assert.equal(Memory.takeRecentMessages(messages, 0, 1000).startIndex, 0);
    messages.at(-1).content = '长'.repeat(3000);
    assert.ok(Memory.estimateMessagesTokens(messages) > original);
    assert.equal(Memory.takeRecentMessages(messages, 0, 1000).startIndex, 29);
    messages.at(-1).content = '简短消息';
    assert.equal(Memory.estimateMessagesTokens(messages), original);
    assert.equal(Memory.takeRecentMessages(messages, 0, 1000).startIndex, 0);
});

test('截断预算包括提示文本，且不截断 emoji 的代理对', () => {
    for (const text of ['中文段落'.repeat(300), 'English paragraph. '.repeat(300), '🙂星光𠮷'.repeat(300)]) {
        for (const budget of [1, 4, 5, 10, 24, 50, 99, 200, 1000]) {
            const clipped = Memory.clipTextToTokenBudget(text, budget);
            assert.ok(Memory.estimateTokens(clipped) <= budget, `预算 ${budget} 被截断提示挤占`);
            assert.equal(Buffer.from(clipped, 'utf8').toString('utf8'), clipped);
            if (budget >= 50) assert.match(clipped, /记忆内容已按本轮预算截断/);
        }
    }
    assert.equal(Memory.clipTextToTokenBudget('完整文本', 100), '完整文本');
});

function summaryMessages(count) {
    return Array.from({ length: count }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user',
        content: index % 2 ? '中'.repeat(1000) : 'x'.repeat(1000),
    }));
}

test('摘要扫描不依赖未归档历史总量，且保持完整往返和精确 token 数', () => {
    const messages = summaryMessages(10000);
    let reads = 0;
    for (const message of messages) {
        const content = message.content;
        Object.defineProperty(message, 'content', { get() { reads += 1; return content; } });
    }
    const memory = {
        summarizedUntil: 10,
        get facts() { throw new Error('切块无需读取全部记忆'); },
        get segments() { throw new Error('切块无需读取全部历史摘要'); },
    };
    const chunk = Memory.findSummaryChunk(messages, memory, {
        recentTokenBudget: 20000, minChunkTokens: 6000, maxChunkTokens: 12000,
    });
    assert.equal(chunk.startIndex, 10);
    assert.equal(chunk.endIndex, 26);
    assert.equal(chunk.messages.at(-1).role, 'assistant');
    assert.ok(reads < 60, `不应遍历整段历史，实际读取 ${reads} 条`);
    assert.equal(chunk.estimatedTokens, Memory.estimateMessagesTokens(chunk.messages));
});

test('摘要最小阈值高于切块预算时仍检查足够的待归档内容', () => {
    const config = { recentTokenBudget: 20000, minChunkTokens: 18000, maxChunkTokens: 12000 };
    const chunk = Memory.findSummaryChunk(summaryMessages(100), Memory.createEmptyMemory(), config);
    assert.equal(chunk.endIndex, 16);
    assert.equal(chunk.estimatedTokens, Memory.estimateMessagesTokens(chunk.messages));
    assert.equal(Memory.findSummaryChunk(summaryMessages(40), Memory.createEmptyMemory(), config), null);
});

test('摘要只有用户开头超大消息时保留原有完整助手边界行为', () => {
    const messages = summaryMessages(100);
    messages[0].content = '长'.repeat(14000);
    const chunk = Memory.findSummaryChunk(messages, Memory.createEmptyMemory(), {
        recentTokenBudget: 20000, minChunkTokens: 6000, maxChunkTokens: 12000,
    });
    assert.ok(chunk.endIndex > 2);
    assert.equal(chunk.messages.at(-1).role, 'assistant');
    assert.equal(chunk.estimatedTokens, Memory.estimateMessagesTokens(chunk.messages));
    assert.ok(chunk.endIndex <= messages.length - 4);
});

test('召回缓存随摘要/关键词修改更新，公开分词结果不能污染缓存', () => {
    const memory = Memory.createEmptyMemory();
    memory.segments = Array.from({ length: 6 }, (_, index) => ({
        id: `segment-${index}`, startIndex: index * 10, endIndex: index * 10 + 10,
        summary: index === 0 ? '蓝色钥匙藏在旧城钟楼。' : '日常片段',
        keywords: [], importance: 3,
    }));
    const config = { recentSegmentCount: 2, relevantSegmentCount: 2 };
    const ids = query => Memory.selectMemorySegments(memory, query, config).map(segment => segment.id);
    assert.deepEqual(ids('蓝色钥匙'), ['segment-0', 'segment-4', 'segment-5']);
    Memory.tokenizeForSearch('蓝色钥匙藏在旧城钟楼。\n').clear();
    assert.deepEqual(ids('蓝色钥匙'), ['segment-0', 'segment-4', 'segment-5']);
    memory.segments[0].summary = '全新往事';
    assert.deepEqual(ids('蓝色钥匙'), ['segment-4', 'segment-5']);
    memory.segments[1].keywords.push('蓝色钥匙');
    assert.deepEqual(ids('蓝色钥匙'), ['segment-1', 'segment-4', 'segment-5']);
    memory.segments[1].keywords.length = 0;
    assert.deepEqual(ids('蓝色钥匙'), ['segment-4', 'segment-5']);
});

test('使用相同摘要文本的不同会话不会相互召回角色或私有事实', () => {
    const shared = { id: 'same-id', startIndex: 0, endIndex: 10, summary: '共同背景', keywords: [], importance: 3 };
    const first = Memory.normalizeMemory({ core: '甲方秘密', facts: [{ text: '只有甲知道的钥匙' }], segments: [shared] });
    const second = Memory.normalizeMemory({ core: '乙方秘密', facts: [{ text: '只有乙知道的密码' }], segments: [shared] });
    assert.match(Memory.buildMemoryContext(first, '秘密'), /甲方秘密/);
    const context = Memory.buildMemoryContext(second, '秘密');
    assert.match(context, /乙方秘密/);
    assert.match(context, /只有乙知道的密码/);
    assert.doesNotMatch(context, /甲方|只有甲/);
});
