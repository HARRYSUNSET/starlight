(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StarlightMessageView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const states = new WeakMap();
    function equalSignature(a, b) {
        return Array.isArray(a) && Array.isArray(b)
            ? a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
            : Object.is(a, b);
    }

    // Reuse unchanged rows. Descriptors build HTML lazily, only when their signature changes.
    function reconcile(container, owner, items, total, onNew) {
        const previous = states.get(container);
        const sameOwner = previous?.owner === owner;
        const available = new Map();
        if (sameOwner) {
            for (const child of container.children) {
                if (child.dataset.viewKey) available.set(child.dataset.viewKey, child);
            }
        }
        const next = { owner, total, rows:new Map() };
        const newRows = [];
        let cursor = container.firstElementChild;
        for (const item of items) {
            const old = sameOwner ? previous.rows.get(item.key) : null;
            let node = available.get(item.key);
            const created = !node;
            if (!node) node = container.ownerDocument.createElement(item.tag || 'div');
            if (!old || !equalSignature(old.signature, item.signature) || old.node !== node) {
                node.className = item.className;
                node.innerHTML = item.html();
                if (item.index !== undefined) {
                    node.dataset.messageIndex = String(item.index);
                    node.id = `message-${item.index}`;
                }
                if (item.action) { node.type = 'button'; node.dataset.action = item.action; }
            }
            node.dataset.viewKey = item.key;
            if (node === cursor) cursor = cursor.nextElementSibling;
            else container.insertBefore(node, cursor);
            next.rows.set(item.key, { node, signature:item.signature });
            if (created && sameOwner && item.index >= previous.total) newRows.push(node);
        }
        const keep = new Set([...next.rows.values()].map(row => row.node));
        for (const child of [...container.children]) if (!keep.has(child)) child.remove();
        states.set(container, next);
        for (const node of newRows) onNew?.(node);
        return next;
    }
    return { reconcile, equalSignature };
});
