(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StarlightWorldProgress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function sourceKey(mode, message, index) {
        if (!message) return '';
        if (mode === 'story') return message.role === 'assistant' ? 'story:' + (message.id || 'index-' + index) : '';
        if (message.kind === 'control' || message.kind === 'intimacy-node') return '';
        if (message.role === 'system' && message.kind !== 'narration') return '';
        return 'room:' + (message.turnId || message.id || 'index-' + index);
    }

    // Compare the actual saved messages. Bookmark changes, settings, previews,
    // author instructions and reading position never create an extraction job.
    function changedKeys(mode, before, after) {
        const field = mode === 'room' ? 'messages' : 'conversations';
        const old = before?.[field] || [];
        const current = after[field] || [];
        const keys = new Set();
        for (let i = 0; i < Math.max(old.length, current.length); i++) {
            const a = old[i], b = current[i];
            if (a === b || (a && b && a.id === b.id && a.kind === b.kind && a.role === b.role &&
                a.turnId === b.turnId && a.speakerId === b.speakerId && a.content === b.content)) continue;
            keys.add(sourceKey(mode, a, i));
            keys.add(sourceKey(mode, b, i));
        }
        keys.delete('');
        return keys;
    }

    function collect(mode, work, wanted) {
        const sources = new Map();
        const list = (mode === 'room' ? work.messages : work.conversations) || [];
        list.forEach((message, index) => {
            const key = sourceKey(mode, message, index);
            if (!key || !wanted.has(key) || !message.content?.trim()) return;
            let source = sources.get(key);
            if (!source) {
                source = {key, index, label: mode === 'room' ? '房间记录 ' + (index + 1) :
                    message.chapterNumber ? '第 ' + message.chapterNumber + ' 章' : '剧情正文 ' + (index + 1),
                    messages:[], confirmed:false};
                sources.set(key, source);
            }
            source.messages.push(message);
            source.endIndex = index;
            if (message.role !== 'user') source.confirmed = true;
        });
        for (const [key, source] of sources) {
            if (!source.confirmed) { sources.delete(key); continue; }
            if (mode === 'room' && source.index !== source.endIndex) source.label += '–' + (source.endIndex + 1);
            // Names can change in the editor without rewriting the historical record.
            let h = 2166136261, h2 = 5381;
            let witnesses;
            for (const msg of source.messages) {
                if (mode === 'room' && msg.role !== 'user') {
                    const observed = new Set(msg.worldWitnessIds || (msg.speakerId ? [msg.speakerId] : []));
                    witnesses = witnesses ? new Set([...witnesses].filter(id => observed.has(id))) : observed;
                }
                const value = JSON.stringify([msg.id || '', msg.role, msg.kind || '', msg.speakerId || '', msg.worldWitnessIds, msg.content]);
                for (let i = 0; i < value.length; i++) {
                    const code = value.charCodeAt(i);
                    h = Math.imul(h ^ code, 16777619);
                    h2 = Math.imul(h2, 33) ^ code;
                }
            }
            source.stamp = (h >>> 0).toString(36) + '-' + (h2 >>> 0).toString(36);
            source.witnesses = witnesses;
            source.text = source.messages.map(message => {
                if (mode === 'story') return message.content;
                const name = message.role === 'user' ? '用户发言／行动' : message.role === 'system' ? '已采纳情景' :
                    work.participants?.find(member => member.id === message.speakerId)?.name || '房间角色';
                return '【' + name + '】\n' + message.content;
            }).join('\n\n');
        }
        return sources;
    }

    // Pass verify=true only for import/recovery. Ordinary commits hash just
    // the changed chapter or turn, even in a novel with years of history.
    function reconcile(ai, mode, work, changed = [], verify = false) {
        let book = work.worldBook;
        const automation = book?.automation;
        if (!automation || (!automation.enabled && !automation.sources.length)) return;
        const tracked = new Map(automation.sources.map(row => [row.key, row]));
        const changedSet = new Set(changed);
        const wanted = new Set(verify ? [...tracked.keys(), ...changedSet] : changedSet);
        if (!wanted.size) return;
        const sources = collect(mode, work, wanted);
        let touched = false;
        const removed = new Set();
        for (const key of wanted) {
            const row = tracked.get(key), source = sources.get(key);
            if (row && row.stamp === source?.stamp) continue;
            if (row) {
                removed.add(key);
                tracked.delete(key);
                touched = true;
            }
            if (source && automation.enabled && (row || changedSet.has(key))) {
                tracked.set(key, {key, stamp:source.stamp, status:'pending', label:source.label});
                touched = true;
            }
        }
        if (removed.size) book = ai.removeSources(book, removed);
        if (touched) work.worldBook = {...book, automation:{...automation, sources:[...tracked.values()]}};
    }

    function failureKind(error) {
        if (['EMPTY_JSON','JSON_WHITESPACE','EMPTY_CONTENT'].includes(error?.code)) return 'empty';
        if (['JSON_TRUNCATED','OUTPUT_LIMIT_EMPTY','REASONING_LIMIT'].includes(error?.code)) return 'truncated';
        if (error?.code === 'WORLD_EVIDENCE') return 'evidence';
        if (['WORLD_FORMAT','JSON_FORMAT'].includes(error?.code)) return 'format';
        if (error?.code === 'LOCAL_WRITE') return 'storage';
        return 'request';
    }
    const failureLabels = {
        empty:'模型返回空白', truncated:'模型输出被截断', evidence:'引文与原文不符',
        format:'模型返回格式不完整', storage:'本地记录尚未保存', request:'请求或服务未完成',
        apply:'进展暂未写入',
    };

    function create(options) {
        const { ai, getWork, works, request, save, blocked, ready } = options;
        const wait = options.wait || (() => new Promise(resolve => setTimeout(resolve, 400)));
        let active = null;
        function pending(job) {
            const work = getWork(job.mode, job.id);
            const settings = work?.worldBook?.automation;
            return settings?.enabled && settings.sources.some(row =>
                row.key === job.key && row.stamp === job.stamp && row.status === 'pending') ? work : null;
        }
        function next() {
            for (const {mode, work} of works()) {
                const settings = work.worldBook?.automation;
                const row = settings?.enabled && settings.sources.find(item => item.status === 'pending');
                if (row) return {mode, id:work.id, key:row.key, stamp:row.stamp};
            }
            return null;
        }
        async function available(job) {
            while (ready() && pending(job) && blocked()) await wait();
            return ready() && pending(job);
        }
        async function extract(input, job) {
            const read = async (text, structured, recovery = false) => {
                if (!await available(job)) throw new Error('整理来源已变化');
                const context={...input,text,recovery};
                const result=await request(ai.buildMessages(context),input.mode,{structured,recovery});
                return ai.parseResult(result,context);
            };
            try {
                return await read(input.text,true);
            } catch (error) {
                const reason=failureKind(error);
                if(reason==='empty') return read(input.text,false,true);
                if(reason==='evidence'||reason==='format') return read(input.text,true,true);
                if(reason!=='truncated') throw error;
                const recovered=[];
                for(const text of ai.splitText(input.text,Math.max(2,Math.ceil(input.text.length/2)))) {
                    recovered.push(...await read(text,true,true));
                }
                return recovered;
            }
        }
        async function process(job) {
            let work = await available(job);
            if (!work) return;
            const source = collect(job.mode, work, new Set([job.key])).get(job.key);
            if (!source || source.stamp !== job.stamp) {
                reconcile(ai, job.mode, work, [job.key]);
                save();
                return;
            }
            const checkpoint=[];
            let status, reason;
            try {
                // Manual chat saves are normally debounced. Complete the write
                // containing both the source and its pending row before billing.
                try { if (options.flush) await options.flush(); }
                catch (error) { throw Object.assign(new Error('未保存归纳来源'), {code:'LOCAL_WRITE',cause:error}); }
                const cached=work.worldBook.automation.sources.find(row=>row.key===job.key)?.checkpoint;
                const parts = ai.splitText(source.text);
                for (const [index,text] of parts.entries()) {
                    work = await available(job);
                    if (!work) return;
                    const participants = (work.participants || []).map(({id,name}) => ({id,name}));
                    const input = {mode:job.mode, kind:'progress', text, book:work.worldBook, participants};
                    if (cached?.[index]) {
                        try { checkpoint.push(ai.parseResult({entries:cached[index]},input)); continue; }
                        catch { /* Re-extract a checkpoint that cannot be verified against the source. */ }
                    }
                    const entries=await extract(input,job);
                    checkpoint.push(entries);
                }
                status = 'done';
            } catch (error) { status = 'failed'; reason=failureKind(error); }
            work = await available(job);
            if (!work) return;
            // A restore, undo, or rewrite can finish while the model is working.
            // Re-read both the source and the latest user-edited book before applying.
            const current = collect(job.mode, work, new Set([job.key])).get(job.key);
            if (current?.stamp !== job.stamp) {
                reconcile(ai, job.mode, work, [job.key]);
                save();
                return;
            }
            let book = work.worldBook;
            if (status === 'done') {
                try {
                    let proposals=checkpoint.flat();
                    if (job.mode === 'room') {
                        const witnesses = (work.participants || []).map(member => member.id).filter(id => current.witnesses.has(id));
                        proposals = proposals.map(entry => {
                            if (entry.knowledgeScope === 'private') return {...entry,
                                characterIds:entry.characterIds.filter(id => witnesses.includes(id))};
                            if (witnesses.length && witnesses.length === work.participants.length) return entry;
                            return {...entry, knowledgeScope:'private', characterIds:witnesses};
                        });
                    }
                    book = ai.applyEntries(book, proposals, {kind:'progress', sourceKey:job.key,
                        sourceIndex:current.index, sourceEndIndex:current.endIndex, sourceLabel:current.label}).book;
                } catch (error) { status = 'failed'; reason='apply'; }
            }
            const sources = book.automation.sources.map(row => row.key === job.key ? {
                key:row.key, stamp:row.stamp, status, label:current.label,
                ...(status==='failed'?{reason,checkpoint:checkpoint.length ? checkpoint : row.checkpoint}:{}),
            } : row);
            work.worldBook = {...book, automation:{...book.automation, sources}};
            save();
            options.onChange?.(work, job.mode);
        }
        function wake() {
            if (active) return active;
            if (!ready() || !next()) return Promise.resolve();
            active = Promise.resolve().then(async () => {
                let job;
                while (ready() && (job = next())) await process(job);
            }).finally(() => { active = null; });
            return active;
        }
        function retry(mode, id, key) {
            const work=getWork(mode,id), book=work?.worldBook;
            if (!book?.automation?.enabled) return;
            book.automation = {...book.automation, sources:book.automation.sources.map(row =>
                row.status === 'failed' && (!key || key===row.key) ? {...row, status:'pending',reason:undefined} : row)};
            save();
            options.onChange?.(work,mode);
            return wake();
        }
        return {wake, retry};
    }
    const locate = (mode,work,key) => work ? collect(mode,work,new Set([key])).get(key) : undefined;
    return {sourceKey, changedKeys, reconcile, create, locate, failureLabels};
});
