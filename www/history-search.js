(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.StarlightHistorySearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function search(input, options) {
        const messages = Array.isArray(input) ? input : [];
        const settings = options && typeof options === 'object' ? options : {};
        const query = String(settings.query == null ? '' : settings.query).trim().toLowerCase();
        const bookmarkedOnly = settings.bookmarkedOnly === true;
        const defaultLimit = query || bookmarkedOnly ? 500 : 300;
        const limit = typeof settings.limit === 'number' && Number.isFinite(settings.limit)
            ? Math.max(0, Math.floor(settings.limit))
            : defaultLimit;
        const getSpeakerLabel = typeof settings.getSpeakerLabel === 'function'
            ? settings.getSpeakerLabel
            : function () { return ''; };
        const entries = [];

        if (!query && !bookmarkedOnly) {
            // Opening the navigator must not inspect the whole conversation.
            for (let index = Math.max(0, messages.length - limit); index < messages.length; index += 1) {
                entries.push({ message: messages[index], index: index });
            }
            return { entries: entries, matchedCount: messages.length };
        }

        let matchedCount = 0;
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index];
            if (bookmarkedOnly && (!message || message.bookmarked !== true)) continue;
            if (query) {
                const speaker = getSpeakerLabel(message, index);
                const content = message && message.content || '';
                const haystack = `${speaker} #${index + 1} ${content}`.toLowerCase();
                if (!haystack.includes(query)) continue;
            }
            matchedCount += 1;
            if (entries.length < limit) entries.push({ message: message, index: index });
        }
        entries.reverse();
        return { entries: entries, matchedCount: matchedCount };
    }

    return { search: search };
});
