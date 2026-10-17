(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.StarlightTimeline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function text(value) { return typeof value === 'string' ? value.trim() : ''; }
    function index(value) { return Number.isInteger(value) && value >= 0 ? value : null; }
    function strings(value) { return Array.from(new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean))); }
    function id() { return 'event_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9); }

    function createEvent(input) {
        const source = input && typeof input === 'object' ? input : {};
        const observedBy = strings(source.observedBy);
        const knownAt = {};
        observedBy.forEach(function (characterId) {
            const learnedAt = index(source.knownAt && source.knownAt[characterId]);
            if (learnedAt !== null) Object.defineProperty(knownAt, characterId, { value: learnedAt, enumerable: true, configurable: true, writable: true });
        });
        return {
            id: text(source.id) || id(),
            subject: text(source.subject),
            attribute: text(source.attribute),
            before: text(source.before),
            after: text(source.after),
            note: text(source.note),
            aliases: strings(source.aliases),
            keywords: strings(source.keywords),
            sourceStartIndex: index(source.sourceStartIndex),
            sourceEndIndex: index(source.sourceEndIndex),
            sourceFactId: text(source.sourceFactId),
            knowledgeScope: source.knowledgeScope === 'private' ? 'private' : 'public',
            observedBy: observedBy,
            knownAt: knownAt,
            status: ['active', 'expired', 'corrected'].includes(source.status) ? source.status : 'active',
            validUntilIndex: index(source.validUntilIndex),
            invalidated: source.invalidated === true,
            invalidatedAtIndex: index(source.invalidatedAtIndex),
            locked: source.locked === true,
            userEdited: source.userEdited === true,
            importance: Number.isFinite(Number(source.importance)) ? Math.max(1, Math.min(5, Math.round(Number(source.importance)))) : 3,
            createdAt: Number.isFinite(source.createdAt) ? Math.max(0, source.createdAt) : Date.now(),
            updatedAt: Number.isFinite(source.updatedAt) ? Math.max(0, source.updatedAt) : Date.now(),
        };
    }

    function normalizeEvents(events) {
        const seen = new Set();
        return (Array.isArray(events) ? events : []).filter(Boolean).map(createEvent).filter(function (event) {
            if (!event.subject || !event.attribute || !event.after || seen.has(event.id)) return false;
            seen.add(event.id);
            return true;
        });
    }

    function signature(event) {
        return JSON.stringify([event.subject, event.attribute, event.before, event.after, event.sourceStartIndex,
            event.sourceEndIndex, event.knowledgeScope, event.observedBy.slice().sort(), event.knownAt]);
    }

    // New changes are appended. Repeated summarisation of the same source is
    // idempotent; it cannot overwrite a manually locked event or erase history.
    function mergeEvents(existing, incoming, range) {
        const events = normalizeEvents(existing);
        const byId = new Map(events.map(function (event) { return [event.id, event]; }));
        const bySignature = new Map(events.filter(function (event) { return !event.invalidated; }).map(function (event) { return [signature(event), event]; }));
        normalizeEvents((Array.isArray(incoming) ? incoming : []).map(function (event) {
            return Object.assign({}, event, {
                sourceStartIndex: index(event && event.sourceStartIndex) === null ? index(range && range.startIndex) : event.sourceStartIndex,
                sourceEndIndex: index(event && event.sourceEndIndex) === null ? index(range && range.endIndex) : event.sourceEndIndex,
            });
        })).forEach(function (event) {
            const sameId = byId.get(event.id);
            if ((sameId && (sameId.locked || sameId.invalidated || signature(sameId) === signature(event))) || bySignature.has(signature(event))) return;
            if (sameId) event.id = id();
            events.push(event);
            byId.set(event.id, event);
            bySignature.set(signature(event), event);
        });
        return events;
    }

    // Legacy prose is not parsed heuristically: only explicitly structured
    // facts can become state changes, so migration cannot invent plot events.
    function fromFacts(facts) {
        return normalizeEvents((Array.isArray(facts) ? facts : []).filter(function (fact) {
            return fact && text(fact.subject) && text(fact.attribute) && text(fact.after);
        }).map(function (fact) {
            return Object.assign({}, fact, { id: 'timeline_fact_' + fact.id, sourceFactId: fact.id, note: fact.text || '' });
        }));
    }

    function isVisible(record, options) {
        const settings = options || {};
        const at = index(settings.atMessageIndex);
        if (record.invalidated) return false;
        if (at !== null && !Number.isInteger(record.sourceEndIndex)) return false;
        if (at !== null && Number.isInteger(record.sourceEndIndex) && record.sourceEndIndex > at) return false;
        if (record.knowledgeScope !== 'private') return true;
        const characterId = text(settings.characterId);
        if (!characterId || !(record.observedBy || []).includes(characterId)) return false;
        const learnedAt = index(record.knownAt && record.knownAt[characterId]);
        return at === null || learnedAt === null || learnedAt <= at;
    }

    function order(a, b) {
        // A sourced event belongs at its original message, not at the time it
        // happened to be extracted or edited by the user.
        const aIndex = a.sourceEndIndex === null ? Number.MAX_SAFE_INTEGER : a.sourceEndIndex;
        const bIndex = b.sourceEndIndex === null ? Number.MAX_SAFE_INTEGER : b.sourceEndIndex;
        return aIndex - bIndex || a.createdAt - b.createdAt;
    }

    function selectEvents(events, options) {
        const settings = options || {};
        const at = index(settings.atMessageIndex);
        const visible = normalizeEvents(events).filter(function (event) { return isVisible(event, settings); }).sort(order);
        if (settings.mode === 'history') {
            return visible.filter(function (event) { return event.status !== 'corrected'; });
        }
        const current = new Map();
        visible.forEach(function (event) {
            if (event.status === 'corrected') return;
            const key = JSON.stringify([event.subject, event.attribute]);
            // An expired latest state is a tombstone, not permission to restore
            // an older state. Before its explicit expiry it is still historical.
            const effective = event.status === 'active'
                || (at !== null && event.validUntilIndex !== null && at < event.validUntilIndex);
            current.set(key, effective || settings.includeExpired ? event : null);
        });
        return Array.from(current.values()).filter(Boolean);
    }

    function invalidateFromIndex(events, firstRemovedIndex) {
        const boundary = Math.max(0, Number(firstRemovedIndex) || 0);
        return normalizeEvents(events).map(function (event) {
            const overlaps = (event.sourceEndIndex !== null && event.sourceEndIndex > boundary)
                || (event.sourceStartIndex !== null && event.sourceStartIndex >= boundary);
            return overlaps ? Object.assign({}, event, {
                status: 'corrected', invalidated: true, invalidatedAtIndex: boundary,
            }) : event;
        });
    }

    function buildTimelineContext(events, options) {
        const settings = options || {};
        const selected = selectEvents(events, settings);
        if (!selected.length) return '';
        const heading = Number.isInteger(settings.atMessageIndex)
            ? '【截至原消息 #' + settings.atMessageIndex + ' 的状态｜不是当前状态】'
            : '【当前已确认状态｜按有来源的变化更新，保留人物身份与约束】';
        return heading + '\n' + selected.map(function (event) {
            const source = event.sourceEndIndex !== null ? ' [来源 #' + ((event.sourceStartIndex || 0) + 1) + '—#' + event.sourceEndIndex + ']' : '';
            return '- ' + event.subject + ' · ' + event.attribute + '：' + event.after + source;
        }).join('\n');
    }

    return {
        createEvent: createEvent, normalizeEvents: normalizeEvents, mergeEvents: mergeEvents,
        fromFacts: fromFacts, isVisible: isVisible, selectEvents: selectEvents,
        invalidateFromIndex: invalidateFromIndex, buildTimelineContext: buildTimelineContext,
    };
});
