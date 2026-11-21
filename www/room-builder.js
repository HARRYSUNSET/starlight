(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StarlightRoomBuilder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const MAX_PARTICIPANTS = 8;
    const MAX_ENTRIES = 20;
    const MAX_SOURCE = 30000;
    // validateRoomDraft requires exactly one AI member in a double room.
    const MAX_DOUBLE_PARTICIPANTS = 1;

    const TOP_FIELDS = ['name', 'subtitle', 'scenePrompt', 'userPersona', 'otherInfo'];
    const PARTICIPANT_FIELDS = ['personaPrompt', 'publicProfile', 'privateGoal', 'knowledgeBoundary', 'speakingStyle', 'relationships', 'currentState', 'growthNotes', 'dialogueExamples'];
    const POLICY_FIELDS = ['baseline', 'preferences', 'boundaries', 'conditions'];
    const FIELD_LABELS = {
        name: '角色名称', roomName: '房间名称', subtitle: '简介', scenePrompt: '当前场景', userPersona: '用户角色', otherInfo: '其他信息',
        personaPrompt: '人设', publicProfile: '公开身份', privateGoal: '私人目标', knowledgeBoundary: '知识边界',
        speakingStyle: '说话方式', relationships: '关系', currentState: '当前状态', growthNotes: '成长记录', dialogueExamples:'对白示例',
        baseline: '关系基线', preferences: '在意的偏好', boundaries: '界限', conditions: '关系转折条件',
    };

    const text = (value, max = 4000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
    const keep = value => typeof value === 'string' ? value : '';
    const blank = value => !String(value ?? '').trim();
    const normalizeName = value => text(value, 80).normalize('NFKC').replace(/\s+/gu, ' ').toLowerCase();
    const isPlaceholderName = value => !String(value ?? '').trim() || /^角色\s*\d+$/.test(String(value).trim());

    function defaultId(prefix) {
        return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    function emptyWorldBook() {
        return { version: 2, initialEntries: [], progressEntries: [], automation: { enabled: false, sources: [] }, updatedAt: 0 };
    }

    function uniqueNames(value, issues) {
        if (value === undefined) return [];
        if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v.trim() || v.length > 80)) {
            issues.push('知情角色格式异常，已跳过该条目');
            return null;
        }
        return [...new Set(value.map(v=>v.trim()))];
    }

    function entryKey(entry) {
        const fields = (entry.fields || []).map(f => JSON.stringify([keep(f.label).trim(),keep(f.value).trim()])).sort();
        return JSON.stringify([entry.knowledgeScope, [...(entry.characterIds || [])].sort(), fields]);
    }

    function buildMessages(input = {}) {
        const mode = input.mode === 'creative' ? 'creative' : 'source';
        const roomType = input.roomType === 'double' ? 'double' : 'group';
        const source = text(input.text, MAX_SOURCE);
        if (!source) throw new Error('请先提供原文或创作种子');
        const participants = (Array.isArray(input.participants) ? input.participants : [])
            .map(item => ({ id: text(item?.id, 120), name: text(item?.name, 80) }))
            .filter(item => item.name);
        const existing = input.existing && typeof input.existing === 'object'
            ? {
                name: keep(input.existing.name), subtitle: keep(input.existing.subtitle),
                scenePrompt: keep(input.existing.scenePrompt), userPersona: keep(input.existing.userPersona),
                otherInfo: keep(input.existing.otherInfo),
            } : null;
        const rules = [
            '你是房间设定整理员。只输出一个 JSON 对象，不要 Markdown 或解释。',
            '字段：{"name":"房间名","subtitle":"一句话简介","scenePrompt":"当前场景","userPersona":"用户所扮演角色","otherInfo":"其他必要信息","evidence":"房间级设定的连续原文","participants":[{"name":"角色名","evidence":"该角色描写的连续原文","personaPrompt":"人设","publicProfile":"公开身份","privateGoal":"私人目标","knowledgeBoundary":"知识边界","speakingStyle":"说话方式","relationships":"关系","currentState":"当前状态","growthNotes":"成长记录","relationshipPolicy":{"baseline":"既有关系基线","preferences":"在意什么","boundaries":"界限与顾虑","conditions":"关系转折需要什么经历"}}],"worldEntries":[{"fields":[{"label":"栏名","value":"内容"}],"knowledgeScope":"public|private","characterNames":["角色名"],"evidence":"连续原文"}]}',
            'privateGoal、knowledgeBoundary 只写进角色卡，绝不能出现在 worldEntries；worldEntries 里只放世界、地点、组织、物件与已确认的公共状态。',
            roomType === 'double'
                ? '这是双人房间：只能有一名 AI 角色。用户身份单列在 userPersona。原文或创作要求明确给出用户身份、或明确委托你设计时才填写。'
                : '这是多人房间：参与者 2 至 8 人，只提取原文明确出现或创意种子要求的角色，不要为凑人数新增。',
            mode === 'source'
                ? '严格核对原文：每个角色、每条 worldEntry 的 evidence 都必须是原文里的连续片段（尽量 10 至 100 字）。房间及角色的每个栏位，优先直接摘录原文；概括或转述时必须在同层 evidenceByField 提供栏位的连续原文，如 {"personaPrompt":"原文","relationshipPolicy.baseline":"原文"}。原文没有的留空。'
                : '这是创作种子：可按种子补全空白设定，但不得与已有设定冲突，不得虚构未要求的角色；evidence 可为空字符串。',
            '人物按名字匹配已有角色；已有角色不要重复创建。若原文的私密信息只被个别角色知道，worldEntry 用 private 并列出知情角色名；知情者不明确就不要生成该条目。',
            'knowledgeScope 只允许 public 或 private；无法判断的一律 private，不要用其他写法。',
            '角色实际说过的典型对白可以放进 dialogueExamples。创作模式可以依人设拟定关系起点、偏好、界限、转折条件和说话示例。用户未指定身份时可留空。',
            existing ? 'existing 是当前草稿的已有内容，只用于避免重复与判断冲突，不得覆盖。' : '',
        ].filter(Boolean);
        return [
            { role: 'system', content: rules.join('\n') },
            { role: 'user', content: JSON.stringify({ mode, roomType, participants, existing, source }) },
        ];
    }

    function parseResult(raw, input = {}) {
        const mode = input.mode === 'creative' ? 'creative' : 'source';
        const source = text(input.text, MAX_SOURCE);
        const issues = [];
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return { name: '', subtitle: '', scenePrompt: '', userPersona: '', otherInfo: '', participants: [], worldEntries: [], issues: ['模型返回的不是 JSON 对象'] };
        }

        const result = { name: '', subtitle: '', scenePrompt: '', userPersona: '', otherInfo: '', participants: [], worldEntries: [], issues };
        function verifiedQuote(value) {
            const quote = text(value, 2000);
            return quote && source.includes(quote) ? quote : '';
        }
        function fieldValue(owner,key,value,target) {
            const proposed = text(value);
            if (!proposed || mode === 'creative') return proposed;
            const supplied = owner.evidenceByField?.[key];
            const quote = supplied === undefined
                ? (target.evidence?.includes(proposed) ? target.evidence : verifiedQuote(proposed))
                : verifiedQuote(supplied);
            if (!quote) {
                issues.push('已跳过缺少原文依据的栏位：' + (FIELD_LABELS[key.split('.').pop()] || key));
                return '';
            }
            target.evidenceByField[key] = quote;
            return proposed;
        }
        result.evidence = verifiedQuote(raw.evidence);
        result.evidenceByField = {};
        for (const field of TOP_FIELDS) result[field] = fieldValue(raw,field,raw[field],result);

        const seen = new Set();
        for (const item of Array.isArray(raw.participants) ? raw.participants : []) {
            const name = text(item?.name, 80);
            const key = normalizeName(name);
            if (!name) { issues.push('跳过缺少名字的角色'); continue; }
            if (mode === 'source') {
                const evidence = text(item?.evidence, 1000);
                if (!evidence || !source.includes(evidence)) {
                    issues.push(`跳过角色「${name}」：出处无法在原文中核对`);
                    continue;
                }
            }
            if (seen.has(key)) { issues.push(`角色「${name}」重复，已合并`); continue; }
            if (result.participants.length >= MAX_PARTICIPANTS) { issues.push('角色数量超过 8 人上限，其余已跳过'); break; }
            seen.add(key);
            const policy = item?.relationshipPolicy && typeof item.relationshipPolicy === 'object' ? item.relationshipPolicy : {};
            const card = {name,evidence:verifiedQuote(item.evidence),evidenceByField:{},relationshipPolicy:{}};
            for (const key of PARTICIPANT_FIELDS) card[key] = fieldValue(item,key,item[key],card);
            for (const key of POLICY_FIELDS) card.relationshipPolicy[key] = fieldValue(item,'relationshipPolicy.'+key,policy[key],card);
            result.participants.push(card);
        }

        for (const item of Array.isArray(raw.worldEntries) ? raw.worldEntries : []) {
            if (result.worldEntries.length >= MAX_ENTRIES) { issues.push('世界书条目超过 20 条上限，其余已跳过'); break; }
            const fields = (Array.isArray(item?.fields) ? item.fields : [])
                .map(field => ({ label: text(field?.label, 80), value: text(field?.value, 4000) }))
                .filter(field => field.label && field.value);
            if (!fields.length) { issues.push('跳过没有栏名或内容的条目'); continue; }
            const evidence = text(item?.evidence, 1000);
            if (mode === 'source' && (!evidence || !source.includes(evidence))) {
                issues.push('跳过出处无法在原文中核对的条目');
                continue;
            }
            // Unknown or malformed visibility is treated as private, never public.
            const characterNames = uniqueNames(item?.characterNames, issues);
            if (!characterNames) continue;
            const privateEntry = item?.knowledgeScope !== 'public' || characterNames.length > 0;
            if (privateEntry && !characterNames.length) {
                issues.push('跳过没有知情角色的私密或未知可见性条目');
                continue;
            }
            result.worldEntries.push({
                fields,
                knowledgeScope: privateEntry ? 'private' : 'public',
                characterNames: privateEntry ? characterNames : [],
                evidence,
            });
        }
        return result;
    }

    function ensureDraft(draft) {
        const value = draft && typeof draft === 'object' ? JSON.parse(JSON.stringify(draft)) : {};
        // Existing text is never trimmed or truncated: only incoming proposals are capped.
        for (const field of TOP_FIELDS) value[field] = keep(value[field]);
        value.participants = Array.isArray(value.participants) ? value.participants : [];
        if (!value.worldBook || typeof value.worldBook !== 'object') value.worldBook = emptyWorldBook();
        for (const key of ['initialEntries', 'progressEntries']) if (!Array.isArray(value.worldBook[key])) value.worldBook[key] = [];
        if (!value.worldBook.automation) value.worldBook.automation = { enabled: false, sources: [] };
        return value;
    }

    // Fill blanks, never overwrite handwriting unless the caller lists the exact key.
    function applyDraft(draft, proposal, options = {}) {
        const result = ensureDraft(draft);
        const conflicts = [];
        const issues = [];
        const overwrite = new Set((Array.isArray(options.overwriteKeys) ? options.overwriteKeys : []).map(String));
        const makeId = typeof options.createId === 'function' ? options.createId : defaultId;
        const roomType = options.roomType || result.roomType || draft?.roomType || 'group';
        const participantLimit = roomType === 'double' ? MAX_DOUBLE_PARTICIPANTS : MAX_PARTICIPANTS;
        const participants = Array.isArray(proposal?.participants) ? proposal.participants : [];
        const entries = Array.isArray(proposal?.worldEntries) ? proposal.worldEntries : [];

        for (const field of TOP_FIELDS) {
            const next = text(proposal?.[field], 4000);
            if (!next) continue;
            if (blank(result[field]) || overwrite.has(field)) result[field] = next;
            else if (result[field] !== next) conflicts.push({ key: field, label: FIELD_LABELS[field === 'name' ? 'roomName' : field] || field, before: result[field], after: next });
        }

        const selected = new Set((Array.isArray(options.selectedIndices) ? options.selectedIndices : participants.map((_, index) => index))
            .map(Number).filter(index => Number.isInteger(index) && index >= 0 && index < participants.length));
        const targets = options.memberTargets && typeof options.memberTargets === 'object' ? options.memberTargets : {};
        // candidate name -> member id, so private entries follow explicit renames.
        const candidateMembers = new Map();
        const candidateNames = new Set(participants.map(p=>normalizeName(p?.name)));

        for (const index of [...selected].sort((a, b) => a - b)) {
            const candidate = participants[index];
            if (!candidate || !text(candidate.name, 80)) continue;
            const candidateName = text(candidate.name, 80);
            const nameKey = normalizeName(candidateName);
            const requested = String(targets[index] || '');
            const matches = result.participants.filter(member => normalizeName(member.name) === nameKey);
            if (!requested && matches.length > 1) {
                issues.push('同名角色需要明确选择填入位置：' + candidateName);
                continue;
            }
            let existing = requested ? result.participants.find(member => member.id === requested) : matches[0];
            if (requested && requested !== 'new' && !existing) {
                issues.push('原来选择的角色已移除：' + candidateName);
                continue;
            }
            if (!existing && requested === 'new' && result.participants.some(member => normalizeName(member.name) === nameKey)) {
                issues.push(`已有同名角色「${candidateName}」，未重复创建`);
                continue;
            }
            if (!existing && result.participants.length >= participantLimit) {
                issues.push(roomType === 'double'
                    ? '双人房间只能有一名 AI 角色，已跳过新增角色'
                    : `角色数量已达 ${MAX_PARTICIPANTS} 人上限，跳过「${candidateName}」`);
                continue;
            }
            if (!existing) {
                existing = {
                    id: makeId('member'), name: candidateName, personaPrompt: '', publicProfile: '', privateGoal: '',
                    knowledgeBoundary: '', speakingStyle: '', relationships: '', currentState: '', growthNotes: '',
                    dialogueExamples: '', relationshipPolicy: { enabled: true, baseline: '', preferences: '', boundaries: '', conditions: '' },
                    avatar: '', color: '', enabled: true, createdAt: Date.now(),
                };
                result.participants.push(existing);
            } else if (candidateName && candidateName !== existing.name) {
                // A blank placeholder is not handwriting: fill it. A real name is a
                // separate conflict that only an explicit overwrite may replace.
                if (isPlaceholderName(existing.name) && !PARTICIPANT_FIELDS.some(key => !blank(existing[key]))) existing.name = candidateName;
                else {
                    const nameKeyId = `participant.${existing.id}.name`;
                    if (overwrite.has(nameKeyId)) existing.name = candidateName;
                    else conflicts.push({ key: nameKeyId, label: '角色名称', before: existing.name, after: candidateName });
                }
            }
            candidateMembers.set(nameKey, existing.id);

            for (const field of PARTICIPANT_FIELDS) {
                const next = text(candidate[field], 4000);
                if (!next) continue;
                const key = `participant.${existing.id}.${field}`;
                if (blank(existing[field]) || overwrite.has(key)) existing[field] = next;
                else if (existing[field] !== next) conflicts.push({ key, label: `${existing.name} · ${FIELD_LABELS[field] || field}`, before: existing[field], after: next });
            }
            const policy = candidate.relationshipPolicy && typeof candidate.relationshipPolicy === 'object' ? candidate.relationshipPolicy : {};
            existing.relationshipPolicy = existing.relationshipPolicy && typeof existing.relationshipPolicy === 'object'
                ? existing.relationshipPolicy : { enabled: true, baseline: '', preferences: '', boundaries: '', conditions: '' };
            for (const field of POLICY_FIELDS) {
                const next = text(policy[field], 800);
                if (!next) continue;
                const key = `participant.${existing.id}.relationshipPolicy.${field}`;
                if (blank(existing.relationshipPolicy[field]) || overwrite.has(key)) existing.relationshipPolicy[field] = next;
                else if (existing.relationshipPolicy[field] !== next) conflicts.push({ key, label: `${existing.name} · ${FIELD_LABELS[field] || field}`, before: existing.relationshipPolicy[field], after: next });
            }
        }

        const selectedEntries = new Set((Array.isArray(options.selectedEntryIndices) ? options.selectedEntryIndices : entries.map((_, index) => index))
            .map(Number).filter(index => Number.isInteger(index) && index >= 0 && index < entries.length));
        const existingKeys = new Set(result.worldBook.initialEntries.map(entryKey));
        for (const index of [...selectedEntries].sort((a, b) => a - b)) {
            const entry = entries[index];
            if (!entry || !Array.isArray(entry.fields) || !entry.fields.length) continue;
            const names = uniqueNames(entry.characterNames,issues);
            if (!names) continue;
            const privateEntry = entry.knowledgeScope !== 'public' || names.length > 0;
            const unresolved = [];
            const ids = [];
            for (const name of names) {
                const nameKey = normalizeName(name);
                const matches = result.participants.filter(member=>normalizeName(member.name)===nameKey);
                const id = candidateNames.has(nameKey) ? candidateMembers.get(nameKey) : matches.length===1 && matches[0].id;
                if (!id) { unresolved.push(name); continue; }
                if (!ids.includes(id)) ids.push(id);
            }
            if (privateEntry && unresolved.length) {
                issues.push(`私密条目的知情角色无法匹配（${unresolved.join('、')}），已跳过`);
                continue;
            }
            if (privateEntry && !ids.length) {
                issues.push('私密条目没有可匹配的知情角色，已跳过');
                continue;
            }
            const key = entryKey({...entry,knowledgeScope:privateEntry ? 'private':'public',characterIds:ids});
            if (existingKeys.has(key)) { issues.push('已存在相同设定，未重复添加'); continue; }
            result.worldBook.initialEntries.push({
                id: makeId('world'), kind: 'initial',
                fields: entry.fields.map(field => ({ id: makeId('worldfield'), label: text(field.label, 80), value: text(field.value, 4000) })),
                enabled: true, activationMode: 'always', keywords: [], priority: 3,
                knowledgeScope: privateEntry ? 'private' : 'public', characterIds: privateEntry ? ids : [],
                status: 'active', sourceStartIndex: null, sourceEndIndex: null,
                origin: { sourceKey: 'builder-import', sourceLabel: 'AI 建房', evidence: text(entry.evidence, 1000), signature: '' },
                createdAt: Date.now(), updatedAt: Date.now(),
            });
            existingKeys.add(key);
        }
        result.worldBook.updatedAt = Date.now();
        return { draft: result, conflicts, issues };
    }

    function summarize(proposal) {
        const participants = Array.isArray(proposal?.participants) ? proposal.participants.length : 0;
        const entries = Array.isArray(proposal?.worldEntries) ? proposal.worldEntries : [];
        return { participantCount: participants, entryCount: entries.length, privateCount: entries.filter(entry => entry.knowledgeScope === 'private').length };
    }

    return { MAX_PARTICIPANTS, MAX_ENTRIES, MAX_DOUBLE_PARTICIPANTS, buildMessages, parseResult, applyDraft, summarize };
});
