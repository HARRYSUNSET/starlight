(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StarlightUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const paths = {
        back: '<path d="m14 6-6 6 6 6"/>',
        more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
        story: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5zm0 13A2.5 2.5 0 0 1 6.5 16H20M8 7h8M8 11h5"/>',
        room: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1V11.5A8.5 8.5 0 0 1 11.5 3H13a8 8 0 0 1 8 8.5Z"/><path d="M7 9h10M7 13h7"/>',
        person: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
        search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
        memory: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 4v16M12 9h4M12 13h4"/>',
        style: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
        history: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2"/>',
        snippets: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h4"/>',
        send: '<path d="m5 12 7-7 7 7M12 5v15"/>',
        stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
        bookmark: '<path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4Z"/>',
        regenerate: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
        undo: '<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 7 7v4"/>',
        delete: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
        edit: '<path d="m16 3 5 5-12 12-6 1 1-6Z M13 6l5 5"/>',
        down: '<path d="m6 9 6 6 6-6"/>',
        close: '<path d="m6 6 12 12M18 6 6 18"/>',
        sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
        moon: '<path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11Z"/>',
    };
    const floatingPanels = new Map();

    function icon(name) {
        return `<span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">${paths[name] || paths.more}</svg></span>`;
    }

    function button(element, name, label, iconOnly) {
        if (!element) return;
        element.innerHTML = icon(name);
        element.setAttribute('aria-label', label);
        if (!iconOnly) {
            const text = element.ownerDocument.createElement('span');
            text.textContent = label;
            element.appendChild(text);
        }
    }

    function viewportMetrics(input) {
        const data = input || {};
        const layoutHeight = Math.max(1, Number(data.innerHeight) || 1);
        const zoomed = Number(data.scale || 1) > 1.05;
        return {
            width: Math.max(1, Number(data.innerWidth) || 1),
            height: zoomed ? layoutHeight : Math.min(layoutHeight, Math.max(1, Number(data.visualHeight) || layoutHeight)),
            top: zoomed ? 0 : Math.max(0, Number(data.offsetTop) || 0),
        };
    }

    function getViewport(win) {
        const target = win || window;
        return viewportMetrics({
            innerHeight: target.innerHeight, innerWidth: target.innerWidth,
            visualHeight: target.visualViewport?.height, offsetTop: target.visualViewport?.offsetTop,
            scale: target.visualViewport?.scale,
        });
    }

    function floatingPosition(anchor, size, viewport, preferAbove) {
        const margin = 12;
        const width = Math.min(size.width, Math.max(1, viewport.width - margin * 2));
        const height = Math.min(size.height, Math.max(1, viewport.height - margin * 2));
        const minTop = viewport.top + margin;
        const maxTop = viewport.top + viewport.height - height - margin;
        const above = anchor.top - height - 8;
        const below = anchor.bottom + 8;
        let top;
        if (preferAbove && above >= minTop) top = above;
        else if (below <= maxTop) top = below;
        else if (above >= minTop) top = above;
        else top = (viewport.top + viewport.height / 2) - height / 2;
        return {
            top: Math.max(minTop, Math.min(maxTop, top)),
            left: Math.max(margin, Math.min(viewport.width - width - margin, anchor.left)),
            width, height,
        };
    }

    function placePanel(panel, anchor, preferAbove) {
        if (!panel || !anchor) return;
        const viewport = getViewport(panel.ownerDocument.defaultView);
        panel.style.maxHeight = Math.max(1, viewport.height - 24) + 'px';
        const position = floatingPosition(anchor.getBoundingClientRect(), panel.getBoundingClientRect(), viewport, preferAbove);
        panel.style.left = position.left + 'px';
        panel.style.top = position.top + 'px';
        // Panels inside the overlay are positioned relative to its visible-viewport top.
        if (panel.parentElement?.classList.contains('sheet-overlay')) panel.style.top = (position.top - viewport.top) + 'px';
        panel.style.width = position.width + 'px';
        floatingPanels.set(panel, { anchor, preferAbove });
    }

    function clearPanel(panel) {
        floatingPanels.delete(panel);
    }

    function resizeComposer(input) {
        if (!input) return;
        input.style.height = 'auto';
        const viewportLimit = Math.min(150, getViewport(input.ownerDocument.defaultView).height * .27);
        const messages = input.ownerDocument.getElementById('messagesContainer');
        // Reserve readable history even when room controls and the keyboard share a short screen.
        const historySpace = messages?.getBoundingClientRect().height;
        const layoutLimit = messages?.getClientRects().length
            ? input.getBoundingClientRect().height + historySpace - 56
            : viewportLimit;
        const maxHeight = Math.max(44, Math.min(viewportLimit, layoutLimit));
        input.style.height = Math.min(input.scrollHeight, maxHeight) + 'px';
        input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }

    function initialize(options) {
        const settings = options || {};
        const win = settings.window || window;
        const doc = settings.document || document;
        let frame = null;
        let baseline = win.innerHeight;
        let baselineWidth = win.innerWidth;
        let lastHeight = 0;
        let lastTop = -1;
        function update() {
            frame = null;
            const viewport = getViewport(win);
            const editing = doc.activeElement?.matches?.('input,textarea,[contenteditable="true"]');
            if (Math.abs(baselineWidth - viewport.width) > 100) {
                baselineWidth = viewport.width;
                baseline = win.innerHeight;
            }
            if (!editing) baseline = Math.max(baseline, win.innerHeight);
            if (lastHeight !== viewport.height) {
                doc.documentElement.style.setProperty('--app-height', viewport.height + 'px');
                lastHeight = viewport.height;
                resizeComposer(doc.getElementById('messageInput'));
            }
            if (lastTop !== viewport.top) {
                doc.documentElement.style.setProperty('--app-top', viewport.top + 'px');
                lastTop = viewport.top;
            }
            doc.body.classList.toggle('keyboard-open', Boolean(editing && baseline - viewport.height > 120));
            for (const [panel, entry] of floatingPanels) {
                if (!entry.anchor.isConnected || panel.hidden || panel.parentElement?.hidden) {
                    floatingPanels.delete(panel);
                } else placePanel(panel, entry.anchor, entry.preferAbove);
            }
        }
        function schedule() {
            if (frame === null) frame = win.requestAnimationFrame(update);
        }
        win.addEventListener('resize', schedule);
        win.visualViewport?.addEventListener('resize', schedule);
        win.visualViewport?.addEventListener('scroll', schedule);
        doc.addEventListener('focusin', schedule);
        doc.addEventListener('focusout', schedule);
        const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(schedule) : null;
        const composer = doc.getElementById('inputArea');
        if (composer) observer?.observe(composer);
        update();
        return function dispose() {
            win.removeEventListener('resize', schedule);
            win.visualViewport?.removeEventListener('resize', schedule);
            win.visualViewport?.removeEventListener('scroll', schedule);
            doc.removeEventListener('focusin', schedule);
            doc.removeEventListener('focusout', schedule);
            observer?.disconnect();
            if (frame !== null) win.cancelAnimationFrame(frame);
        };
    }

    return { icon, button, viewportMetrics, floatingPosition, placePanel, clearPanel, resizeComposer, initialize };
});
