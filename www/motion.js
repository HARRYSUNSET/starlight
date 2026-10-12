(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StarlightMotion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const running = new WeakMap();
    const visibility = new WeakMap();
    const writes = new WeakMap();
    const jobs = new Set();
    const ease = 'cubic-bezier(.22,1,.36,1)';
    let route = null;

    function windowFor(element) { return element?.ownerDocument?.defaultView || globalThis; }
    function reduced(element) { return Boolean(windowFor(element).matchMedia?.('(prefers-reduced-motion: reduce)').matches); }
    function supported(element) { return typeof element?.animate === 'function' && !reduced(element); }
    function sample(element) {
        return running.has(element) ? windowFor(element).getComputedStyle(element) : null;
    }
    function capture(element) {
        const style = sample(element);
        return style ? { transform:style.transform, opacity:style.opacity } : null;
    }

    function animate(element, frames, options = {}) {
        running.get(element)?.cancel();
        if (!supported(element)) { options.complete?.(); return Promise.resolve(); }
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        let animation;
        let ended = false;
        const job = {
            promise,
            cancel: () => end(false),
            finish: () => end(true),
        };
        function end(complete) {
            if (ended) return;
            ended = true;
            if (running.get(element) === job) {
                running.delete(element);
                element.classList.remove('motion-running');
                if (complete) options.complete?.();
            }
            if (animation) {
                animation.onfinish = animation.oncancel = null;
                animation.cancel();
            }
            jobs.delete(job);
            resolve();
        }
        running.set(element, job);
        jobs.add(job);
        element.classList.add('motion-running');
        try {
            animation = element.animate(frames, { duration:options.duration || 200, easing:ease, fill:'both' });
            animation.onfinish = () => end(true);
            animation.oncancel = () => end(false);
        } catch (error) { end(true); }
        return promise;
    }

    function isOpen(element) {
        if (!element || element.hidden || element.dataset?.motionState === 'closing') return false;
        const win = windowFor(element);
        return win.getComputedStyle ? win.getComputedStyle(element).display !== 'none' : element.style.display !== 'none';
    }

    function setVisible(element, visible, options = {}) {
        if (!element) return Promise.resolve();
        const previous = visibility.get(element);
        if (previous?.visible === visible) return previous.promise;
        const settings = { display:'flex', kind:'panel', ...previous?.options, ...options };
        const surface = settings.surface || (settings.kind === 'page' ? element : element.firstElementChild) || element;
        const rootFrame = capture(element);
        const surfaceFrame = surface === element ? rootFrame : capture(surface);
        const wasOpen = isOpen(element);
        running.get(element)?.cancel();
        if (surface !== element) running.get(surface)?.cancel();
        const state = { visible, options:settings, promise:Promise.resolve() };
        visibility.set(element, state);
        function commit(value) {
            if (settings.hidden) element.hidden = !value;
            else element.style.display = value ? settings.display : 'none';
            if (element.dataset) element.dataset.motionState = value ? 'open' : 'closed';
            element.classList?.remove('motion-exiting');
            element.removeAttribute?.('aria-hidden');
            if ('inert' in element) element.inert = false;
        }
        if (!supported(element) || (!visible && !wasOpen && !rootFrame)) {
            commit(visible);
            return state.promise;
        }
        if (settings.hidden) element.hidden = false;
        else element.style.display = settings.display;
        element.dataset.motionState = visible ? 'opening' : 'closing';
        element.classList.toggle('motion-exiting', !visible);
        if ('inert' in element) element.inert = !visible;
        if (!visible) element.setAttribute('aria-hidden','true');
        else element.removeAttribute('aria-hidden');
        const duration = settings.kind === 'page' ? (visible ? 260 : 220) : (visible ? 180 : 150);
        const animations = [];
        if (settings.kind === 'page') {
            animations.push(animate(element, [
                rootFrame || { transform:visible ? 'translateX(100%)' : 'translateX(0)', opacity:1 },
                { transform:visible ? 'translateX(0)' : 'translateX(100%)', opacity:1 },
            ], { duration }));
        } else {
            if (surface !== element) animations.push(animate(element, [
                { opacity:rootFrame?.opacity || (visible ? 0 : 1) }, { opacity:visible ? 1 : 0 },
            ], { duration }));
            animations.push(animate(surface, [
                surfaceFrame || { opacity:visible ? 0 : 1, transform:visible ? 'translateY(7px) scale(.965)' : 'translateY(0) scale(1)' },
                { opacity:visible ? 1 : 0, transform:visible ? 'translateY(0) scale(1)' : 'translateY(5px) scale(.975)' },
            ], { duration }));
        }
        state.promise = Promise.all(animations).then(() => {
            if (visibility.get(element) === state) commit(visible);
        });
        return state.promise;
    }

    function screens(from, to, direction = 1) {
        if (!from || !to || from === to) return Promise.resolve();
        const fromFrame = capture(from);
        const toFrame = capture(to);
        if (route) {
            running.get(route.from)?.cancel();
            running.get(route.to)?.cancel();
            route.cleanup();
        }
        if (!supported(to)) return Promise.resolve();
        const current = { from, to };
        route = current;
        from.classList.add('motion-route-out');
        to.classList.add('motion-route-in');
        from.style.setProperty('--route-layer', direction > 0 ? '10' : '30');
        to.style.setProperty('--route-layer', direction > 0 ? '30' : '10');
        from.inert = true;
        from.setAttribute('aria-hidden','true');
        current.cleanup = () => {
            from.classList.remove('motion-route-out');
            to.classList.remove('motion-route-in');
            from.style.removeProperty('--route-layer');
            to.style.removeProperty('--route-layer');
            from.inert = false;
            from.removeAttribute('aria-hidden');
            if (route === current) route = null;
        };
        return Promise.all([
            animate(from, [fromFrame || { transform:'translateX(0)' }, { transform:direction > 0 ? 'translateX(-12%)' : 'translateX(100%)' }], { duration:260 }),
            animate(to, [toFrame || { transform:direction > 0 ? 'translateX(100%)' : 'translateX(-12%)' }, { transform:'translateX(0)' }], { duration:260 }),
        ]).then(() => { if (route === current) current.cleanup(); });
    }

    function enter(element, kind = 'tab') {
        if (!element) return Promise.resolve();
        const first = capture(element) || { opacity:0, transform:kind === 'message' ? 'translateY(8px)' : 'translateY(4px)' };
        return animate(element, [first, { opacity:1, transform:'translateY(0)' }], { duration:kind === 'message' ? 200 : 160 });
    }

    function navigation(nav, button, instant = false) {
        if (!nav || !button) return;
        let indicator = nav.querySelector('.nav-indicator');
        if (!indicator) {
            indicator = nav.ownerDocument.createElement('span');
            indicator.className = 'nav-indicator';
            indicator.setAttribute('aria-hidden','true');
            nav.appendChild(indicator);
            instant = true;
        }
        const before = windowFor(nav).getComputedStyle(indicator).transform;
        const target = `translateX(${button.offsetLeft}px)`;
        indicator.style.width = button.offsetWidth + 'px';
        indicator.style.height = button.offsetHeight + 'px';
        indicator.style.top = button.offsetTop + 'px';
        indicator.style.transform = target;
        if (instant) running.get(indicator)?.cancel();
        else animate(indicator, [{ transform:before }, { transform:target }], { duration:220 });
    }

    function writeFrame(element, callback) {
        if (!element) return;
        const win = windowFor(element);
        if (!win.requestAnimationFrame) { callback(); return; }
        let state = writes.get(element);
        if (state) { state.callback = callback; return; }
        state = { callback, frame:null };
        writes.set(element, state);
        state.frame = win.requestAnimationFrame(() => {
            writes.delete(element);
            if (element.isConnected) state.callback();
        });
    }
    function flushWrite(element, discard = false) {
        const state = writes.get(element);
        if (!state) return;
        windowFor(element).cancelAnimationFrame?.(state.frame);
        writes.delete(element);
        if (!discard && element.isConnected) state.callback();
    }
    function finishAll() { for (const job of [...jobs]) job.finish(); }
    async function whenIdle() {
        while (jobs.size) await Promise.all([...jobs].map(job => job.promise));
        await Promise.resolve();
    }

    function initialize(doc) {
        const win = doc.defaultView;
        doc.body.classList.add('motion-ready');
        const nav = doc.querySelector('.bottom-nav');
        const position = () => navigation(nav, nav?.querySelector('button.active'), true);
        const resize = () => { finishAll(); position(); };
        win.addEventListener('resize', resize);
        win.visualViewport?.addEventListener('resize', resize);
        win.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', finishAll);
        const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(position) : null;
        if (nav) observer?.observe(nav);
        position();
    }

    return { animate, setVisible, isOpen, screens, enter, navigation, writeFrame, flushWrite, finishAll, whenIdle, initialize };
});
