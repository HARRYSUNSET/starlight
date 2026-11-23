(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StarlightWorldBook = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const INITIAL_FIELD_LABELS = Object.freeze(['世界名称', '时代与环境', '核心规则']);
    const PROGRESS_FIELD_LABELS = Object.freeze(['进展名称', '具体变化', '影响范围']);
    const VALID_STATUS = new Set(['active', 'expired', 'replaced']);

    function asString(value, fallback = '') {
        return typeof value === 'string' ? value : fallback;
    }

    function createId(prefix = 'world') {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    }

    function createField(label, value = '') {
        return {
            id: createId('worldfield'),
            label: asString(label, '新栏位').trim() || '新栏位',
            value: asString(value),
        };
    }

    function normalizeField(field, index) {
        const source = field && typeof field === 'object' ? field : {};
        return {
            id: asString(source.id) || createId('worldfield'),
            label: asString(source.label || source.name, `栏位${index + 1}`).trim() || `栏位${index + 1}`,
            value: asString(source.value ?? source.content),
        };
    }

    function createEntry(kind = 'initial', fieldLabels) {
        const type = kind === 'progress' ? 'progress' : 'initial';
        const defaults = type === 'progress' ? PROGRESS_FIELD_LABELS : INITIAL_FIELD_LABELS;
        const labels = Array.isArray(fieldLabels) && fieldLabels.length ? fieldLabels : defaults;
        return {
            id: createId(type === 'progress' ? 'progress' : 'world'),
            kind: type,
            fields: labels.map(label => createField(label)),
            enabled: true,
            activationMode: 'always',
            keywords: [],
            priority: 3,
            knowledgeScope: 'public',
            characterIds: [],
            status: 'active',
            sourceStartIndex: null,
            sourceEndIndex: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
    }

    function normalizeEntry(entry, kind = 'initial') {
        const source = entry && typeof entry === 'object' ? entry : {};
        const normalizedKind = kind === 'progress' || source.kind === 'progress' ? 'progress' : 'initial';
        const fields = Array.isArray(source.fields) && source.fields.length
            ? source.fields.map(normalizeField)
            : (normalizedKind === 'progress' ? PROGRESS_FIELD_LABELS : INITIAL_FIELD_LABELS).map(label => createField(label));
        return {
            id: asString(source.id) || createId(normalizedKind === 'progress' ? 'progress' : 'world'),
            kind: normalizedKind,
            fields,
            enabled: source.enabled !== false,
            activationMode: source.activationMode === 'keywords' ? 'keywords' : 'always',
            keywords: Array.isArray(source.keywords)
                ? source.keywords.map(String).map(item => item.trim()).filter(Boolean).slice(0, 40)
                : asString(source.keywords).split(/[,，\n]/).map(item => item.trim()).filter(Boolean).slice(0, 40),
            priority: Math.max(1, Math.min(5, Math.round(Number(source.priority) || 3))),
            knowledgeScope: source.knowledgeScope === 'private' ? 'private' : 'public',
            characterIds: Array.isArray(source.characterIds) ? source.characterIds.map(String).filter(Boolean) : [],
            status: VALID_STATUS.has(source.status) ? source.status : 'active',
            sourceStartIndex: Number.isInteger(source.sourceStartIndex) ? Math.max(0, source.sourceStartIndex) : null,
            sourceEndIndex: Number.isInteger(source.sourceEndIndex) ? Math.max(0, source.sourceEndIndex) : null,
            createdAt: Number(source.createdAt) || Date.now(),
            updatedAt: Number(source.updatedAt) || Number(source.createdAt) || Date.now(),
            ...(source.origin && typeof source.origin.sourceKey === 'string' && source.origin.sourceKey
                ? { origin: {
                    sourceKey: source.origin.sourceKey,
                    sourceLabel: asString(source.origin.sourceLabel),
                    evidence: asString(source.origin.evidence),
                    signature: asString(source.origin.signature),
                    ...(Array.isArray(source.origin.characterChanges) ? {characterChanges:normalizeCharacterChanges(source.origin.characterChanges)} : {}),
                } } : {}),
        };
    }

    function normalizeCharacterChanges(input) {
        const byMember = new Map();
        for (const change of Array.isArray(input) ? input : []) {
            if (typeof change?.memberId !== 'string' || !change.memberId || !['growth','state'].includes(change.section)) continue;
            byMember.set(change.memberId, {memberId:change.memberId, section:change.section});
        }
        return [...byMember.values()];
    }

    function normalizeAutomation(input) {
        const source = input || {};
        const records = new Map();
        for (const item of Array.isArray(source.sources) ? source.sources : []) {
            if (!asString(item?.key) || !asString(item.stamp) ||
                !['pending', 'done', 'failed'].includes(item.status)) continue;
            const row = { key: item.key, stamp: item.stamp, status: item.status };
            if (asString(item.label)) row.label = item.label.slice(0,120);
            if (asString(item.reason)) row.reason = item.reason.slice(0,80);
            if (item.status !== 'done' && Array.isArray(item.checkpoint)) row.checkpoint = item.checkpoint;
            records.set(item.key, row);
        }
        return { enabled: source.enabled === true, sources: [...records.values()] };
    }

    function normalizeSections(worldBook, legacyPrompt) {
        const source = worldBook && typeof worldBook === 'object' ? worldBook : {};
        let initialEntries = Array.isArray(source.initialEntries)
            ? source.initialEntries.filter(Boolean).map(entry => normalizeEntry(entry, 'initial'))
            : [];
        const progressEntries = Array.isArray(source.progressEntries)
            ? source.progressEntries.filter(Boolean).map(entry => normalizeEntry(entry, 'progress'))
            : [];

        if (!initialEntries.length) {
            const first = createEntry('initial');
            const legacy = asString(legacyPrompt).trim();
            if (legacy) {
                first.fields.push(createField('原有世界观背景', legacy));
            }
            initialEntries = [first];
        }

        return {
            initialEntries,
            progressEntries,
        };
    }

    function normalizeWorldBook(worldBook, legacyPrompt = '') {
        return {
            version: 2,
            ...normalizeSections(worldBook, legacyPrompt),
            automation: normalizeAutomation(worldBook?.automation),
            updatedAt: Number(worldBook?.updatedAt) || 0,
        };
    }

    function cloneEntrySchema(entry, kind) {
        const source = normalizeEntry(entry, kind);
        return createEntry(kind || source.kind, source.fields.map(field => field.label));
    }

    function entryText(entry) {
        return normalizeEntry(entry, entry?.kind).fields
            .map(field => `${field.label}：${field.value.trim() || '（未填写）'}`)
            .join('\n');
    }

    function promptEntryText(entry) {
        // Entries have already been normalized. Empty editor fields are not facts.
        return entry.fields
            .filter(field => field.value.trim())
            .map(field => `${field.label}：${field.value.trim()}`)
            .join('\n');
    }

    function matchesQuery(entry, query) {
        if (entry.activationMode !== 'keywords') return true;
        const source = asString(query).toLowerCase();
        if (!source) return false;
        return entry.keywords.some(keyword => source.includes(keyword.toLowerCase()));
    }

    function isVisibleTo(entry, characterId) {
        if (entry.knowledgeScope !== 'private') return true;
        if (!characterId) return false;
        return entry.characterIds.includes(String(characterId));
    }

    function buildWorldBookPrompt(worldBook, query = '', options = {}) {
        const book = normalizeSections(worldBook, options.legacyPrompt);
        const characterId = asString(options.characterId);
        const maxCharacters = Math.max(1000, Number(options.maxCharacters) || 24000);
        const select = (entries, newestFirst = false) => entries
            .filter(entry => entry.enabled && entry.status === 'active')
            .filter(entry => matchesQuery(entry, query))
            .filter(entry => isVisibleTo(entry, characterId))
            .sort((a, b) => b.priority - a.priority || (newestFirst
                ? (b.sourceEndIndex ?? -1) - (a.sourceEndIndex ?? -1) || b.createdAt - a.createdAt
                : a.createdAt - b.createdAt));
        const sections = [];
        function addSection(entries, title, label, guide = '') {
            let section = '';
            let count = 0;
            for (const entry of entries) {
                const body = promptEntryText(entry);
                if (!body) continue;
                const position = entry.kind === 'progress' && entry.origin && entry.sourceEndIndex !== null
                    ? `｜来源序号 ${entry.sourceEndIndex + 1}` : '';
                section += (count ? '\n\n' : title + '\n' + guide) + `〔${label}${++count}${position}〕\n` + body;
                // No section can receive more than the whole round's budget.
                // Keep one extra character so final allocation can detect truncation.
                if (section.length > maxCharacters) {
                    section = section.slice(0, maxCharacters + 1);
                    break;
                }
            }
            if (section) sections.push(section);
        }
        addSection(select(book.initialEntries), '【世界书｜初始世界设定】', '设定');
        const progress = select(book.progressEntries, true);
        const guide = progress.some(entry => entry.origin && entry.sourceEndIndex !== null)
            ? '同一人物或事物的相同状态以来源序号较大的明确变化为准，先前状态属于当时的历史。\n' : '';
        addSection(progress, '【世界书｜已经确认的后续进展】', '进展', guide);
        const output = sections.join('\n\n');
        if (output.length <= maxCharacters) return output;
        // Include truncation notices in the budget and retain confirmed progress
        // even when initial world settings alone exceed the entire budget.
        const notice = '\n……（世界书本节已按本轮预算截断）';
        const available = maxCharacters - notice.length * sections.length - (sections.length - 1) * 2;
        const firstBudget = sections.length === 1
            ? available
            : Math.min(sections[0].length, Math.max(Math.floor(available / 2), available - sections[1].length));
        return sections.map((section, index) => {
            const budget = index === 0 ? firstBudget : available - firstBudget;
            if (section.length <= budget) return section;
            const end = /[\uD800-\uDBFF]/.test(section[budget - 1]) ? budget - 1 : budget;
            return section.slice(0, end).trimEnd() + notice;
        }).join('\n\n');
    }

    function createProgressFromMemory(memoryItem) {
        const source = memoryItem && typeof memoryItem === 'object' ? memoryItem : {};
        const entry = createEntry('progress');
        entry.fields[0].value = asString(source.title || source.category, '剧情进展');
        entry.fields[1].value = asString(source.text || source.summary);
        entry.fields[2].value = asString(source.scope || source.impact, '当前剧情');
        entry.sourceStartIndex = Number.isInteger(source.sourceStartIndex)
            ? source.sourceStartIndex
            : (Number.isInteger(source.startIndex) ? source.startIndex : null);
        entry.sourceEndIndex = Number.isInteger(source.sourceEndIndex)
            ? source.sourceEndIndex
            : (Number.isInteger(source.endIndex) ? source.endIndex : null);
        entry.priority = Math.max(1, Math.min(5, Math.round(Number(source.importance) || 3)));
        if (source.knowledgeScope === 'private' || source.visibility === 'private') {
            entry.knowledgeScope = 'private';
            const recipients = source.observedBy ?? source.characterIds;
            entry.characterIds = Array.isArray(recipients)
                ? [...new Set(recipients.filter(id => typeof id === 'string' && id.trim()))] : [];
        }
        return entry;
    }

    return {
        INITIAL_FIELD_LABELS,
        PROGRESS_FIELD_LABELS,
        createId,
        createField,
        normalizeField,
        createEntry,
        normalizeEntry,
        normalizeCharacterChanges,
        normalizeWorldBook,
        cloneEntrySchema,
        entryText,
        buildWorldBookPrompt,
        createProgressFromMemory,
    };
});
