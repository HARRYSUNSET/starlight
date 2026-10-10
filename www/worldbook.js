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
        const fallback = createEntry(normalizedKind);
        const fields = Array.isArray(source.fields) && source.fields.length
            ? source.fields.map(normalizeField)
            : fallback.fields;
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
        };
    }

    function normalizeWorldBook(worldBook, legacyPrompt = '') {
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
            version: 1,
            initialEntries,
            progressEntries,
            updatedAt: Number(source.updatedAt) || 0,
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
        const book = normalizeWorldBook(worldBook);
        const characterId = asString(options.characterId);
        const maxCharacters = Math.max(1000, Number(options.maxCharacters) || 24000);
        const select = entries => entries
            .filter(entry => entry.enabled && entry.status === 'active')
            .filter(entry => matchesQuery(entry, query))
            .filter(entry => isVisibleTo(entry, characterId))
            .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
        const initial = select(book.initialEntries);
        const progress = select(book.progressEntries);
        const sections = [];
        if (initial.length) {
            sections.push('【世界书｜初始世界设定】\n' + initial.map((entry, index) => `〔设定${index + 1}〕\n${entryText(entry)}`).join('\n\n'));
        }
        if (progress.length) {
            sections.push('【世界书｜已经确认的后续进展】\n' + progress.map((entry, index) => `〔进展${index + 1}〕\n${entryText(entry)}`).join('\n\n'));
        }
        const output = sections.join('\n\n');
        if (output.length <= maxCharacters) return output;
        return output.slice(0, maxCharacters).trimEnd() + '\n……（世界书已按本轮预算截断）';
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
        normalizeWorldBook,
        cloneEntrySchema,
        entryText,
        buildWorldBookPrompt,
        createProgressFromMemory,
    };
});
