(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StarlightAPI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // The timeout measures silence, not total generation time. SSE heartbeats
    // keep long thinking/writing requests alive without limiting their length.
    function createRequestScope(options = {}) {
        const controller = new AbortController();
        const timeoutMs = options.timeoutMs ?? 90000;
        let timer;
        let timedOut = false;
        const abort = () => controller.abort();
        const touch = () => {
            clearTimeout(timer);
            if (!controller.signal.aborted && timeoutMs > 0) {
                timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
            }
        };
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener('abort', abort, { once: true });
        touch();
        return {
            controller,
            signal: controller.signal,
            touch,
            error(cause) {
                if (!timedOut) return cause;
                const error = new Error('接口长时间没有响应，请检查网络后重试；本次未自动重复请求。');
                error.partialContent = cause?.partialContent || '';
                return error;
            },
            dispose() {
                clearTimeout(timer);
                options.signal?.removeEventListener('abort', abort);
            },
        };
    }

    async function readResponseText(response, options = {}) {
        const reader = response.body?.getReader();
        if (!reader) throw new Error('接口没有返回可读取的正文');
        const decoder = new TextDecoder();
        const parts = [];
        let reachedEOF = false;
        const cancel = () => { reader.cancel().catch(() => {}); };
        const checkAbort = () => {
            if (options.signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
        };
        options.signal?.addEventListener('abort', cancel, { once: true });
        try {
            checkAbort();
            while (true) {
                const { done, value } = await reader.read();
                checkAbort();
                options.onActivity?.();
                if (done) { reachedEOF = true; parts.push(decoder.decode()); break; }
                parts.push(decoder.decode(value, { stream: true }));
            }
            return parts.join('');
        } finally {
            options.signal?.removeEventListener('abort', cancel);
            if (!reachedEOF) cancel();
            reader.releaseLock();
        }
    }

    async function readCompletionStream(response, options = {}) {
        if (!response.body?.getReader) throw new Error('接口没有返回可读取的流式正文');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let eventLines = [];
        let fullContent = '';
        let reasoningChars = 0;
        let finishReason = null;
        let usage = null;
        let completed = false;
        let reachedEOF = false;
        const cancel = () => { reader.cancel().catch(() => {}); };
        const checkAbort = () => {
            if (options.signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
        };
        const consumeEvent = () => {
            if (!eventLines.length || completed) { eventLines = []; return; }
            const data = eventLines.join('\n').trim();
            eventLines = [];
            if (!data) return;
            if (data === '[DONE]') { completed = true; return; }
            let parsed;
            try { parsed = JSON.parse(data); }
            catch (_) { throw new Error('流式响应格式损坏，本次回复未完整接收'); }
            if (parsed.error) throw new Error(parsed.error.message || '流式响应中断');
            const choice = parsed.choices?.[0];
            if (typeof choice?.delta?.content === 'string') fullContent += choice.delta.content;
            // Count reasoning without retaining or displaying its private text.
            if (typeof choice?.delta?.reasoning_content === 'string') reasoningChars += choice.delta.reasoning_content.length;
            if (choice?.finish_reason) finishReason = choice.finish_reason;
            if (parsed.usage) usage = parsed.usage;
        };
        const consumeLine = line => {
            if (line.endsWith('\r')) line = line.slice(0, -1);
            if (!line) { consumeEvent(); return; }
            if (line.startsWith('data:')) eventLines.push(line.slice(5).replace(/^ /, ''));
        };
        options.signal?.addEventListener('abort', cancel, { once: true });
        try {
            checkAbort();
            while (!completed) {
                const { done, value } = await reader.read();
                checkAbort();
                options.onActivity?.();
                const previousLength = fullContent.length;
                buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
                let offset = 0;
                let newline;
                while (!completed && (newline = buffer.indexOf('\n', offset)) !== -1) {
                    consumeLine(buffer.slice(offset, newline));
                    offset = newline + 1;
                }
                buffer = buffer.slice(offset);
                if (done) {
                    reachedEOF = true;
                    if (!completed) {
                        if (buffer) consumeLine(buffer);
                        consumeEvent();
                    }
                }
                // One DOM scheduling call per network chunk, not per token/event.
                if (fullContent.length !== previousLength) options.onChunk?.(fullContent);
                if (done) break;
            }
            if (!finishReason) {
                throw new Error('连接在回复完成前中断，本次片段未作为完整剧情保存');
            }
            return { content: fullContent, finishReason, usage, reasoningChars };
        } catch (error) {
            error.partialContent = fullContent;
            error.responseInfo = completionInfo({content:fullContent,finishReason,usage,reasoningChars});
            throw error;
        } finally {
            options.signal?.removeEventListener('abort', cancel);
            if (!reachedEOF) cancel();
            reader.releaseLock();
        }
    }

    // Only non-content metadata may enter diagnostics. Never retain API keys,
    // prompts, character text, or the model's chain of thought here.
    function completionInfo(result = {}, options = {}) {
        const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
        return {
            finishReason: ['stop','length','content_filter','tool_calls','insufficient_system_resource','aborted'].includes(result.finishReason) ? result.finishReason : null,
            format: options.structured ? 'json' : 'text',
            thinking: options.thinkingMode === 'enabled' ? 'enabled' : 'disabled',
            outputLimit: count(options.maxTokens),
            contentChars: typeof result.content === 'string' ? result.content.length : 0,
            reasoningChars: count(result.reasoningChars) || 0,
            reasoningTokens: count(result.usage?.completion_tokens_details?.reasoning_tokens),
            outputTokens: count(result.usage?.completion_tokens),
        };
    }

    function completionError(result = {}, options = {}) {
        const content = typeof result.content === 'string' ? result.content : '';
        const info = completionInfo(result, options);
        let code, message;
        if (info.finishReason !== 'stop' && info.finishReason !== 'length') {
            code = 'RESPONSE_INTERRUPTED';
            message = '服务端中断了本次生成，未采纳不完整结果，原有内容未改变。';
        } else if (!content.trim()) {
            if (info.finishReason === 'length') {
                const hasReasoning = info.reasoningChars > 0 || info.reasoningTokens > 0;
                code = hasReasoning ? 'REASONING_LIMIT' : 'OUTPUT_LIMIT_EMPTY';
                message = hasReasoning
                    ? '本次达到输出上限，模型已进行思考但尚未返回有效正文。可提高单次回复上限或切换为自然创作后重试；原有内容未改变。'
                    : '本次达到输出上限，但没有返回有效正文；可调整单次回复上限后重试，原有内容未改变。';
            } else if (options.structured) {
                code = content.length ? 'JSON_WHITESPACE' : 'EMPTY_JSON';
                message = content.length
                    ? '模型只返回了空白，未提供有效 JSON；可能与输出格式不符有关，原有数据未被覆盖。'
                    : '模型没有返回 JSON 正文，原有数据未被覆盖。';
            } else {
                code = 'EMPTY_CONTENT';
                message = '模型没有返回有效正文，原有内容未改变。';
            }
        } else if (options.requireStop && info.finishReason === 'length') {
            code = 'JSON_TRUNCATED';
            message = '结构化结果达到输出上限，尚未完整生成，原有数据未被覆盖。';
        } else return null;
        const error = new Error(message);
        error.code = code;
        error.responseInfo = info;
        error.partialContent = content.trim() ? content : '';
        return error;
    }

    function createUsageTracker() {
        const totals = { requests: 0, inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheInputTokens: 0, cacheReports: 0 };
        const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
        return {
            record(usage) {
                if (!usage || !valid(usage.prompt_tokens) || !valid(usage.completion_tokens)) return false;
                totals.requests++;
                totals.inputTokens += usage.prompt_tokens;
                totals.outputTokens += usage.completion_tokens;
                if (valid(usage.prompt_cache_hit_tokens) && usage.prompt_cache_hit_tokens <= usage.prompt_tokens) {
                    totals.cacheReports++;
                    totals.cacheHitTokens += usage.prompt_cache_hit_tokens;
                    totals.cacheInputTokens += usage.prompt_tokens;
                }
                return true;
            },
            snapshot() { return { ...totals }; },
        };
    }

    function createTaskMetrics() {
        const tasks = new Map();
        return {
            record(label, elapsedMs, usage, status = 'success', responseInfo) {
                const name=String(label||'其他请求');
                const row=tasks.get(name)||{name,requests:0,successes:0,failures:0,cancelled:0,elapsedMs:0,reported:0,input:0,output:0,cacheHit:0};
                row.requests++; row.elapsedMs+=Math.max(0,Number(elapsedMs)||0);
                if(status==='success')row.successes++;else if(status==='cancelled')row.cancelled++;else row.failures++;
                if(usage&&Number.isFinite(usage.prompt_tokens)&&Number.isFinite(usage.completion_tokens)){
                    row.reported++;row.input+=Math.max(0,usage.prompt_tokens);row.output+=Math.max(0,usage.completion_tokens);
                    row.cacheHit+=Math.min(Math.max(0,Number(usage.prompt_cache_hit_tokens)||0),Math.max(0,usage.prompt_tokens));
                }
                if(responseInfo)row.lastResponse=completionInfo({
                    finishReason:responseInfo.finishReason,content:'',reasoningChars:responseInfo.reasoningChars,
                    usage:{completion_tokens:responseInfo.outputTokens,completion_tokens_details:{reasoning_tokens:responseInfo.reasoningTokens}},
                },{structured:responseInfo.format==='json',thinkingMode:responseInfo.thinking,maxTokens:responseInfo.outputLimit});
                if(responseInfo)row.lastResponse.contentChars=Number.isFinite(responseInfo.contentChars)?Math.max(0,responseInfo.contentChars):0;
                tasks.set(name,row);
            },
            snapshot(){return Array.from(tasks.values(),row=>({...row,...(row.lastResponse?{lastResponse:{...row.lastResponse}}:{})}));},
        };
    }

    // Only callers explicitly marking deterministic auxiliary requests may use
    // this session-only cache. Never cache story prose, private source on disk,
    // failed promises, or mix different credentials/model/options.
    function createAuxiliaryCache(limit=8) {
        const cache=new Map();
        return {
            get(key){if(!cache.has(key))return undefined;const value=cache.get(key);cache.delete(key);cache.set(key,value);return JSON.parse(value);},
            set(key,value){const encoded=JSON.stringify(value);if(encoded.length>1000000)return;cache.delete(key);cache.set(key,encoded);while(cache.size>limit)cache.delete(cache.keys().next().value);},
            clear(){cache.clear();},
        };
    }

    return { createRequestScope, readResponseText, readCompletionStream, completionInfo, completionError, createUsageTracker, createTaskMetrics, createAuxiliaryCache };
});
