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
                return timedOut ? new Error('接口长时间没有响应，请检查网络后重试；本次未自动重复请求。') : cause;
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
            if (!completed && !finishReason) {
                throw new Error('连接在回复完成前中断，本次片段未作为完整剧情保存');
            }
            return { content: fullContent, finishReason, usage };
        } catch (error) {
            error.partialContent = fullContent;
            throw error;
        } finally {
            options.signal?.removeEventListener('abort', cancel);
            if (!reachedEOF) cancel();
            reader.releaseLock();
        }
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
            record(label, elapsedMs, usage, status = 'success') {
                const name=String(label||'其他请求');
                const row=tasks.get(name)||{name,requests:0,successes:0,failures:0,cancelled:0,elapsedMs:0,reported:0,input:0,output:0,cacheHit:0};
                row.requests++; row.elapsedMs+=Math.max(0,Number(elapsedMs)||0);
                if(status==='success')row.successes++;else if(status==='cancelled')row.cancelled++;else row.failures++;
                if(usage&&Number.isFinite(usage.prompt_tokens)&&Number.isFinite(usage.completion_tokens)){
                    row.reported++;row.input+=Math.max(0,usage.prompt_tokens);row.output+=Math.max(0,usage.completion_tokens);
                    row.cacheHit+=Math.min(Math.max(0,Number(usage.prompt_cache_hit_tokens)||0),Math.max(0,usage.prompt_tokens));
                }
                tasks.set(name,row);
            },
            snapshot(){return Array.from(tasks.values(),row=>({...row}));},
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

    return { createRequestScope, readResponseText, readCompletionStream, createUsageTracker, createTaskMetrics, createAuxiliaryCache };
});
