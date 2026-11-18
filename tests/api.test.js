const test = require('node:test');
const assert = require('node:assert/strict');
const API = require('../www/api.js');

test('任务分类记录失败与取消、不虚构缺失用量，统计不包含原文',()=>{
    const metrics=API.createTaskMetrics();
    metrics.record('剧情正文',100,{prompt_tokens:10,completion_tokens:5},'success');
    metrics.record('剧情正文',50,null,'cancelled');
    metrics.record('文风预览',20,null,'failed');
    const rows=metrics.snapshot();assert.equal(rows[0].input,10);assert.equal(rows[0].reported,1);
    assert.equal(rows[0].requests,2);assert.equal(rows[0].cancelled,1);assert.equal(rows[1].failures,1);
    rows[0].input=1000;assert.equal(metrics.snapshot()[0].input,10);
});

test('辅助缓存有界且按完整键隔离，返回值不能污染已存结果',()=>{
    const cache=API.createAuxiliaryCache(2);cache.set('model-a/source',{facts:['a']});
    cache.get('model-a/source').facts.push('b');assert.deepEqual(cache.get('model-a/source'),{facts:['a']});
    assert.equal(cache.get('model-b/source'),undefined);cache.set('b',{});cache.set('c',{});
    assert.equal(cache.get('model-a/source'),undefined);cache.clear();assert.equal(cache.get('c'),undefined);
});

const encode = value => new TextEncoder().encode(value);
const event = value => `data: ${JSON.stringify(value)}\n\n`;
const delta = content => event({ choices: [{ delta: { content } }] });
function responseFrom(chunks, keepOpen = false, onCancel = () => {}) {
    return new Response(new ReadableStream({
        start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); if (!keepOpen) controller.close(); },
        cancel: onCancel,
    }));
}

test('SSE 在任意 UTF-8 字节/CRLF 边界拆包仍完整保留中文、emoji 与用量', async () => {
    const usage = { prompt_tokens: 123, completion_tokens: 7, prompt_cache_hit_tokens: 100 };
    const bytes = encode((delta('她笑了🙂。') + event({ choices: [{ delta: {}, finish_reason: 'stop' }], usage }) + 'data: [DONE]\n\n').replace(/\n/g, '\r\n'));
    for (const size of [1, 2, 7, bytes.length]) {
        const chunks = []; for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size));
        let displayed = '';
        const result = await API.readCompletionStream(responseFrom(chunks), { onChunk: text => displayed = text });
        assert.equal(result.content, '她笑了🙂。');
        assert.equal(displayed, result.content);
        assert.equal(result.finishReason, 'stop');
        assert.deepEqual(result.usage, usage);
    }
});

test('同网络片段的多个 token 只触发一次绘制，DONE 立即结束而不等服务器关连接', async () => {
    let calls = 0, cancelled = 0;
    const response = responseFrom([encode(delta('一') + delta('二') + delta('三') + event({choices:[{delta:{},finish_reason:'stop'}]}) + 'data: [DONE]\n\n')], true, () => cancelled++);
    const result = await API.readCompletionStream(response, { onChunk: () => calls++ });
    assert.equal(result.content, '一二三');
    assert.equal(calls, 1);
    assert.equal(cancelled, 1);
    assert.equal(response.body.locked, false);
});

test('支持 SSE 多行事件、心跳及末尾无空行的完成包', async () => {
    const result = await API.readCompletionStream(responseFrom([encode(': keep-alive\n\nevent: message\ndata: {"choices":\ndata: [{"delta":{"content":"正文"},"finish_reason":"stop"}]}')]));
    assert.equal(result.content, '正文');
    assert.equal(result.finishReason, 'stop');
});

test('缺失结束标记的 EOF、坏包及接口错误不能当作完整回复', async () => {
    for (const tail of ['', 'data: broken\n\n', event({ error: { message: '上游中断' } })]) {
        await assert.rejects(API.readCompletionStream(responseFrom([encode(delta('未完') + tail)])), error => {
            assert.equal(error.partialContent, '未完');
            return /中断|损坏/.test(error.message);
        });
    }
});

test('请求超时释放等待中的流；用户取消保持 AbortError，资源可清理', async () => {
    const scope = API.createRequestScope({ timeoutMs: 10 });
    await assert.rejects(API.readCompletionStream(responseFrom([], true), { signal: scope.signal }), error => {
        assert.equal(error.name, 'AbortError');
        assert.match(scope.error(error).message, /长时间没有响应/);
        return true;
    });
    scope.dispose();
    const controller = new AbortController();
    const cancelled = API.createRequestScope({ signal: controller.signal, timeoutMs: 10000 });
    controller.abort();
    await assert.rejects(API.readCompletionStream(responseFrom([], true), { signal: cancelled.signal }), error => cancelled.error(error).name === 'AbortError');
    cancelled.dispose();
});

test('收到心跳会延后空闲截止时间，不限制持续有数据的长回复', async () => {
    const scope = API.createRequestScope({ timeoutMs: 1000 });
    // A real stream calls touch for every read, including comments/reasoning-only frames.
    let activity = 0;
    const result = await API.readCompletionStream(responseFrom([encode(': ping\n\n'), encode(delta('好') + event({choices:[{delta:{},finish_reason:'stop'}]}) + 'data: [DONE]\n\n')]), {
        signal: scope.signal, onActivity: () => { activity++; scope.touch(); },
    });
    assert.equal(activity, 2);
    assert.equal(result.content, '好');
    assert.equal(scope.signal.aborted, false);
    scope.dispose();
});

test('用量只汇总接口实际返回值，缓存命中率按有报告的输入量加权且不保留正文', () => {
    const tracker = API.createUsageTracker();
    assert.equal(tracker.record(null), false);
    assert.equal(tracker.record({ prompt_tokens: NaN, completion_tokens: 1 }), false);
    tracker.record({ prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 80 });
    tracker.record({ prompt_tokens: 900, completion_tokens: 30, prompt_cache_hit_tokens: 450 });
    tracker.record({ prompt_tokens: 2000, completion_tokens: 40 });
    const state = tracker.snapshot();
    assert.deepEqual(state, { requests: 3, inputTokens: 3000, outputTokens: 90, cacheHitTokens: 530, cacheInputTokens: 1000, cacheReports: 2 });
    state.inputTokens = -1;
    assert.equal(tracker.snapshot().inputTokens, 3000);
    assert.equal(API.createUsageTracker().snapshot().requests, 0);
});

test('非流式 JSON 的空白保活也刷新空闲超时，UTF-8 分包仍完整', async () => {
    let activity = 0;
    const bytes = encode(JSON.stringify({ choices: [{ message: { content: '中文🙂' } }] }));
    const chunks = [encode('\n'), encode('  \n'), bytes.slice(0, 45), bytes.slice(45)];
    const response = responseFrom(chunks);
    const text = await API.readResponseText(response, { onActivity: () => activity++ });
    assert.equal(JSON.parse(text).choices[0].message.content, '中文🙂');
    assert.equal(activity, chunks.length + 1);
    assert.equal(response.body.locked, false);
});

test('非流式响应等待期间取消会解除读取，不把截断 JSON 送给业务解析', async () => {
    const controller = new AbortController();
    const response = responseFrom([encode('{"partial":')], true);
    const promise = API.readResponseText(response, { signal: controller.signal });
    controller.abort();
    await assert.rejects(promise, { name: 'AbortError' });
    assert.equal(response.body.locked, false);
});

test('思考流只统计字符，不显示、不保存思考原文，仍正确接收最终正文', async () => {
    const privateText='PRIVATE_REASONING_DO_NOT_STORE';let displayed='';
    const usage={prompt_tokens:20,completion_tokens:30,completion_tokens_details:{reasoning_tokens:25}};
    const result=await API.readCompletionStream(responseFrom([encode(event({choices:[{delta:{reasoning_content:privateText}}]})+delta('正文')+event({choices:[{delta:{},finish_reason:'stop'}],usage})+'data: [DONE]\n\n')]),{onChunk:value=>displayed=value});
    assert.equal(result.reasoningChars,privateText.length);assert.equal(displayed,'正文');
    assert.equal(result.content,'正文');assert.ok(!JSON.stringify(result).includes(privateText));
});

test('空白 JSON、真正空响应与思考超限分别诊断，不把猜测当成确定原因',()=>{
    const blank=API.completionError({content:' \n ',finishReason:'stop'},{structured:true});
    assert.equal(blank.code,'JSON_WHITESPACE');assert.match(blank.message,/可能/);assert.equal(blank.partialContent,'');
    assert.equal(API.completionError({content:'',finishReason:'stop'},{structured:true}).code,'EMPTY_JSON');
    const thinking=API.completionError({content:'',finishReason:'length',reasoningChars:20},{thinkingMode:'enabled',maxTokens:8000});
    assert.equal(thinking.code,'REASONING_LIMIT');assert.match(thinking.message,/已进行思考/);
    const noEvidence=API.completionError({content:'',finishReason:'length'},{thinkingMode:'enabled'});
    assert.equal(noEvidence.code,'OUTPUT_LIMIT_EMPTY');assert.doesNotMatch(noEvidence.message,/思考.*耗尽/);
    assert.equal(API.completionError({content:'',finishReason:'length',usage:{completion_tokens_details:{reasoning_tokens:10}}}).code,'REASONING_LIMIT');
});

test('正常正文、结构化截断与服务端中断分别保留原有处理语义',()=>{
    assert.equal(API.completionError({content:'正文',finishReason:'stop'}),null);
    assert.equal(API.completionError({content:'未完正文',finishReason:'length'}),null);
    const truncated=API.completionError({content:'{"speech":"未完',finishReason:'length'},{structured:true,requireStop:true});
    assert.equal(truncated.code,'JSON_TRUNCATED');assert.equal(truncated.partialContent,'{"speech":"未完');
    const interrupted=API.completionError({content:'未完',finishReason:'insufficient_system_resource'});
    assert.equal(interrupted.code,'RESPONSE_INTERRUPTED');assert.equal(interrupted.partialContent,'未完');
});

test('断流保留正文片段和非正文统计，绝不把思考片段充作恢复正文',async()=>{
    const secret='PRIVATE_REASONING';
    await assert.rejects(API.readCompletionStream(responseFrom([encode(event({choices:[{delta:{reasoning_content:secret}}]}))])),error=>{
        assert.equal(error.partialContent,'');assert.equal(error.responseInfo.reasoningChars,secret.length);
        assert.ok(!JSON.stringify(error).includes(secret));return true;
    });
});

test('请求诊断仅保留白名单数字与状态，快照隔离且不储存正文和密钥',()=>{
    const source={content:'PRIVATE_CONTENT',finishReason:'stop',reasoningChars:4,apiKey:'SECRET_KEY',usage:{completion_tokens:9,completion_tokens_details:{reasoning_tokens:5}}};
    const info=API.completionInfo(source,{structured:true,thinkingMode:'enabled',maxTokens:16000,apiKey:'SECRET_KEY'});
    assert.equal(info.contentChars,source.content.length);assert.equal(info.reasoningTokens,5);
    const metrics=API.createTaskMetrics();metrics.record('房间对白',20,source.usage,'failed',{...info,prompt:'PRIVATE_PROMPT'});
    const snapshot=metrics.snapshot();assert.ok(!/PRIVATE_|SECRET_KEY/.test(JSON.stringify(snapshot)));
    snapshot[0].lastResponse.reasoningChars=999;assert.equal(metrics.snapshot()[0].lastResponse.reasoningChars,4);
    const invalid=API.completionInfo({finishReason:'UNTRUSTED_CONTENT',reasoningChars:-10,usage:{completion_tokens:Infinity}});
    assert.equal(invalid.finishReason,null);assert.equal(invalid.reasoningChars,0);assert.equal(invalid.outputTokens,null);
});
