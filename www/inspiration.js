(function (root, factory) {
    const Memory = typeof module === 'object' && module.exports
        ? require('./memory.js') : root.StarlightMemory;
    const api = factory(Memory);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StarlightInspiration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Memory) {
    'use strict';

    const CHAT_URL = 'https://api.deepseek.com/v1/chat/completions';
    const BALANCE_URL = 'https://api.deepseek.com/user/balance';
    const BUDGETS = Object.freeze({
        standard: { settings: 3200, memory: 1600, recent: 3000, direction: 500, output: 1800 },
        compact: { settings: 1600, memory: 800, recent: 1100, direction: 400, output: 1200 },
    });

    function clip(text, budget, tail) {
        const value = String(text || '');
        if (Memory.estimateTokens(value) <= budget) return value;
        let low = 0;
        let high = value.length;
        while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            const candidate = tail ? value.slice(-middle) : value.slice(0, middle);
            if (Memory.estimateTokens(candidate) <= budget - 35) low = middle;
            else high = middle - 1;
        }
        return tail ? '（省略较早部分）\n' + value.slice(-low) : value.slice(0, low) + '\n（省略超出预算部分）';
    }

    function recentContext(conversations, budget) {
        const source = Array.isArray(conversations) ? conversations : [];
        // Share the recent budget across multiple turns, including a very long latest reply.
        const selected = source.filter(message => message?.role === 'user' || message?.role === 'assistant').slice(-12);
        const perMessage = Math.max(100, Math.floor(budget / Math.min(4, Math.max(1, selected.length))));
        const parts = [];
        for (let index = selected.length - 1; index >= 0; index -= 1) {
            const message = selected[index];
            const label = message.role === 'user' ? '用户' : '剧情';
            const part = label + '：' + clip(message.content, perMessage, message.role === 'assistant');
            if (Memory.estimateTokens([part, ...parts].join('\n\n')) > budget) break;
            parts.unshift(part);
        }
        return parts.join('\n\n');
    }

    function settingsContext(text, budget) {
        const sections = String(text || '').split(/(?=^【[^】]+】)/m).filter(section => section.trim());
        if (!sections.length) return '';
        const allowance = Math.max(35, Math.floor(budget / sections.length) - 6);
        return clip(sections.map(section => clip(section, allowance)).join('\n\n'), budget);
    }

    function buildRequest(snapshot, compact) {
        const source = snapshot || {};
        const budget = compact ? BUDGETS.compact : BUDGETS.standard;
        const messages = [
            { role: 'system', content: [
                '你是剧情创作的候选输入助手，只为用户草拟下一条可以发送给剧情AI的提示词。',
                '候选只是沙盒草稿，不代表已经发生的事件，不得假装它已进入剧情。',
                '遵守既有人设、世界书、时间线、角色知识边界和因果，不强行制造反转。',
                '只输出合法JSON，给出三个彼此不同的候选，每条提示词约60至150字。',
                '{"suggestions":[{"title":"自然延续","text":"用户可编辑的提示词"},{"title":"人物互动","text":"..."},{"title":"主线推进","text":"..."}]}',
            ].join('\n') },
            { role: 'user', content: [
                '【只读剧情设定】\n' + settingsContext(source.settings, budget.settings),
                '【只读长期记忆】\n' + (clip(source.memory, budget.memory) || '（尚无）'),
                '【最近对话】\n' + (recentContext(source.conversations, budget.recent) || '（尚未开始）'),
                '【用户希望的方向】\n' + (clip(source.direction, budget.direction) || '请给出自然、克制且彼此有差异的候选。'),
            ].join('\n\n') },
        ];
        return {
            model: source.model,
            messages,
            stream: false,
            thinking: { type: 'disabled' },
            response_format: { type: 'json_object' },
            max_tokens: budget.output,
            temperature: 0.72,
        };
    }

    function normalizeSuggestions(input) {
        return (Array.isArray(input) ? input : []).slice(0, 3).map((item, index) => ({
            title: String((typeof item === 'object' && item?.title) || `候选 ${index + 1}`).slice(0, 80),
            text: String(typeof item === 'string' ? item : item?.text || item?.prompt || '').trim().slice(0, 3000),
        })).filter(item => item.text);
    }

    function apiError(status, payload, headers) {
        const raw = String(payload?.error?.message || payload?.message || `API请求失败 (${status})`);
        const error = new Error(raw.slice(0, 500));
        error.status = status;
        error.code = payload?.error?.code || '';
        error.requestId = payload?.request_id || payload?.error?.request_id
            || headers?.get?.('x-request-id') || raw.match(/request_id:\s*([\w-]+)/i)?.[1] || '';
        error.balanceInsufficient = status === 402 || /insufficient\s*balance/i.test(raw);
        return error;
    }

    async function fetchJson(url, options, dependencies) {
        const deps = dependencies || {};
        const requestController = new AbortController();
        const externalSignal = options.signal;
        const cancel = () => requestController.abort();
        let timedOut = false;
        if (externalSignal?.aborted) cancel();
        else externalSignal?.addEventListener('abort', cancel, { once: true });
        const timeout = setTimeout(() => {
            timedOut = true;
            cancel();
        }, deps.timeoutMs || (url === BALANCE_URL ? 15000 : 90000));
        try {
            const response = await (deps.fetch || fetch)(url, { ...options, signal: requestController.signal });
            let payload;
            try { payload = await response.json(); }
            catch (error) {
                if (requestController.signal.aborted) throw error;
                if (!response.ok) throw apiError(response.status, null, response.headers);
                throw new Error('接口返回内容无法解析，请稍后重试');
            }
            if (!response.ok) throw apiError(response.status, payload, response.headers);
            if (payload?.error) throw apiError(response.status, payload, response.headers);
            return payload;
        } catch (error) {
            if (timedOut) throw new Error('请求超时，请检查网络后重新生成');
            if (externalSignal?.aborted) throw new DOMException('请求已取消', 'AbortError');
            throw error;
        } finally {
            clearTimeout(timeout);
            externalSignal?.removeEventListener('abort', cancel);
        }
    }

    async function checkBalance(apiKey, options) {
        const settings = options || {};
        const key = String(apiKey || '').trim();
        if (!key) throw new Error('请先在“我的”中设置 API Key');
        const result = await fetchJson(BALANCE_URL, {
            method: 'GET', headers: { Authorization: `Bearer ${key}` }, signal: settings.signal,
        }, settings);
        if (typeof result?.is_available !== 'boolean' || !Array.isArray(result.balance_infos)) {
            throw new Error('余额接口返回了无法识别的数据');
        }
        return {
            available: result.is_available,
            balances: result.balance_infos.map(item => ({
                currency: String(item.currency || ''),
                total: String(item.total_balance || '0'),
            })),
        };
    }

    async function requestRecommendations(snapshot, options) {
        const settings = options || {};
        const key = String(snapshot?.apiKey || '').trim();
        if (!key) throw new Error('请先在“我的”中设置 API Key');
        const attempts = [];
        let balance = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const body = buildRequest(snapshot, attempt > 0);
            const diagnostic = {
                model: body.model,
                inputTokensEstimate: Memory.estimateMessagesTokens(body.messages),
                maxOutputTokens: body.max_tokens,
                compact: attempt > 0,
            };
            attempts.push(diagnostic);
            try {
                const result = await fetchJson(CHAT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
                    body: JSON.stringify(body), signal: settings.signal,
                }, settings);
                const content = result.choices?.[0]?.message?.content;
                if (!content) throw new Error('这次返回了空候选，请重新生成');
                let parsed;
                try {
                    const text = String(content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
                    parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
                } catch (error) {
                    throw new Error('这次候选格式不完整，请重新生成');
                }
                const suggestions = normalizeSuggestions(parsed.suggestions);
                if (!suggestions.length) throw new Error('这次没有有效候选，请重新生成');
                return { suggestions, balance, compact: attempt > 0, usage: result.usage || null };
            } catch (error) {
                diagnostic.status = error.status || null;
                diagnostic.requestId = error.requestId || '';
                // A rejected payment request has not generated candidates. Only try once more
                // with a smaller payload after the account independently reports availability.
                if (error.balanceInsufficient && attempt === 0 && !settings.signal?.aborted) {
                    try { balance = await checkBalance(key, settings); }
                    catch (balanceError) {
                        if (balanceError.name === 'AbortError') throw balanceError;
                        error.balanceCheckError = describeError(balanceError);
                    }
                    if (balance?.available) {
                        settings.onCompactRetry?.(balance);
                        continue;
                    }
                }
                error.balance = balance;
                error.diagnostics = attempts;
                throw error;
            }
        }
    }

    function describeError(error) {
        if (error?.balanceInsufficient) {
            if (error.balance?.available) return '账户查询显示仍可调用 API，但本次灵感请求仍被 DeepSeek 以余额不足拒绝。请查看请求详情，核对开放平台用量或联系接口支持。';
            if (error.balance?.available === false) return '当前 API Key 对应账户没有可调用余额，请在 DeepSeek 开放平台核对余额。';
            return 'DeepSeek 返回余额不足，但尚未核实账户状态。请点击“查询余额”核对当前 API Key 对应账户。';
        }
        if (error?.status === 401) return 'API Key 验证失败，请在“我的”中检查密钥。';
        if (error?.status === 429) return '请求过于频繁，请稍后重新生成。';
        if (error?.status >= 500) return 'DeepSeek 服务暂时异常，请稍后重新生成。';
        if (error instanceof TypeError) return '网络连接失败，请检查网络后重新生成。';
        return String(error?.message || '生成失败，请重新生成').replace(/sk-[\w-]+/g, '[已隐藏密钥]');
    }

    return { BUDGETS, buildRequest, normalizeSuggestions, checkBalance, requestRecommendations, describeError };
});
