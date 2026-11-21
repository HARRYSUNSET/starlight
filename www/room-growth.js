(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.StarlightRoomGrowth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function normalizeEdits(input) {
        const edits = new Map();
        for (const item of Array.isArray(input) ? input : []) {
            if (!item || typeof item.key !== 'string' || !/^(relation|world):/.test(item.key)) continue;
            const edit = {key:item.key};
            if (typeof item.text === 'string' && item.text.trim()) edit.text = item.text.trim();
            if (item.section === 'growth' || item.section === 'state') edit.section = item.section;
            if (item.hidden === true) edit.hidden = true;
            if (Object.keys(edit).length > 1) edits.set(item.key,edit);
        }
        return [...edits.values()];
    }

    function changeFor(entry, room, member) {
        if (Array.isArray(entry.origin.characterChanges)) {
            return entry.origin.characterChanges.find(change => change.memberId === member.id)?.section;
        }
        // Older books have no subject IDs. Use a named subject, or a
        // directly witnessed, unambiguous change in both summary and source.
        if (!member.name || room.participants.filter(person => person.name === member.name).length !== 1) return;
        const named = entry.fields.find(field => /^(角色姓名|角色名称|变化主体)$/.test(field.label));
        if (named) return named.value.trim() === member.name ? 'growth' : undefined;
        const fact = entry.fields.find(field => field.label === '具体变化')?.value?.trim() || '';
        if (!fact.startsWith(member.name) || !entry.origin.evidence.includes(member.name)) return;
        const action = fact.slice(member.name.length);
        if (/^(学会|掌握|克服|改掉|领悟)/.test(action)) return 'growth';
        if (/^(捡到|拿到|交还|归还|遗失|受伤|痊愈|搬回|搬进)/.test(action)) return 'state';
    }

    function meaningful(event) {
        if (!['action','shared_event','repair','disclosure','boundary'].includes(event.kind)) return false;
        const change = Math.max(Math.abs(Number(event.delta?.trust)||0), Math.abs(Number(event.delta?.affection)||0));
        if (change >= 2) return true;
        if (change && (event.significant || ['repair','disclosure','boundary'].includes(event.kind))) return true;
        return (event.after?.grantedNodes || []).some(id => !event.before?.grantedNodes?.includes(id));
    }

    function records(room, member, query) {
        const result = [], messages = room.messages || [];
        const edits = new Map(normalizeEdits(member.developmentEdits).map(edit => [edit.key,edit]));
        function add(key, section, text, evidence, label, index, time) {
            if (!text || !evidence) return;
            const edit = edits.get(key) || {};
            result.push({key, section:edit.section || section, text:edit.text || text, originalText:text,
                originalSection:section, evidence, label, index, time, hidden:!!edit.hidden});
        }
        for (const entry of room.worldBook?.progressEntries || []) {
            if (!entry.origin?.sourceKey?.startsWith('room:') || !entry.id || !entry.enabled || entry.status !== 'active') continue;
            if (entry.knowledgeScope === 'private' && !entry.characterIds.includes(member.id)) continue;
            if (query !== undefined && entry.activationMode === 'keywords' && !entry.keywords.some(word => word &&
                query.toLowerCase().includes(word.toLowerCase()))) continue;
            const section = changeFor(entry, room, member);
            if (!section) continue;
            const start = entry.sourceStartIndex, end = entry.sourceEndIndex;
            if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= messages.length) continue;
            const sourceMessage = messages[end];
            if ('room:' + (sourceMessage.turnId || sourceMessage.id || 'index-' + end) !== entry.origin.sourceKey) continue;
            const text = entry.fields.find(field => /^(具体变化|角色成长|成长变化|当前状态|变化内容)$/.test(field.label))?.value ||
                entry.fields.filter(field => field.value?.trim()).map(field => field.value).join('；');
            add('world:'+entry.id, section, text, entry.origin.evidence, entry.origin.sourceLabel || '世界书进展', end, entry.createdAt);
        }
        const events = (room.experience?.relationHistory || []).filter(event => event.memberId === member.id && event.id && meaningful(event));
        if (events.length) {
            const refs = new Map();
            for (const event of events) for (const source of event.sources || []) refs.set(source.id,null);
            messages.forEach((msg,index) => {
                if (msg.role === 'user' && msg.kind !== 'control' && refs.has(msg.id)) refs.set(msg.id,{msg,index});
            });
            for (const event of events) {
                const source = (event.sources || []).find(item => {
                    const ref = refs.get(item.id);
                    return ref && ref.msg.turnId === event.turnId && item.quote?.trim() && ref.msg.content.includes(item.quote);
                });
                if (!source) continue;
                const index = refs.get(source.id).index;
                add('relation:'+event.id, 'growth', event.reason || event.tag, source.quote, '关系档案', index, event.createdAt);
            }
        }
        return result.sort((a,b) => b.index-a.index || b.time-a.time);
    }

    function prompt(room, member, query) {
        if (member.developmentEnabled === false) return '';
        const list = records(room, member, query).filter(item => !item.hidden);
        if (!list.length) return '';
        const lines = ['【这一角色已确认的发展｜近期在前】','结合最新处境行动。原有经历保留；同一状态有后续变化时承接较近的一项。'];
        const seen = new Set();
        for (const item of list) {
            if (seen.has(item.text)) continue;
            seen.add(item.text);
            lines.push((item.section === 'state' ? '当前状态' : '成长变化') + '：' + item.text.slice(0,300));
            if (seen.size >= 6) break;
        }
        return lines.join('\n');
    }

    function edit(member, row, change) {
        const edits = normalizeEdits(member.developmentEdits);
        const prior = edits.find(item => item.key === row.key) || {key:row.key};
        const next = {...prior, ...change};
        if (next.text === row.originalText) delete next.text;
        if (next.section === row.originalSection) delete next.section;
        member.developmentEdits = normalizeEdits([...edits.filter(item => item.key !== row.key),next]);
    }
    return {records, prompt, edit, normalizeEdits};
});
