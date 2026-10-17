(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StarlightMotion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const running = new WeakMap();
    const visibility = new WeakMap();
    const writes = new WeakMap();
    const installations = new WeakMap();
    const dismissals = new WeakMap();
    const jobs = new Set();
    const curves = Object.freeze({ enter:'cubic-bezier(.2,.8,.2,1)', exit:'cubic-bezier(.4,0,.8,.2)', settle:'cubic-bezier(.16,1,.3,1)' });
    let route = null;

    function windowFor(element) { return element?.ownerDocument?.defaultView || globalThis; }
    function reduced(element) {
        const win = windowFor(element);
        return win.__starlightNativeMotion?.animationScale === 0 || Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    }
    function supported(element) { return typeof element?.animate === 'function' && !reduced(element); }
    function sample(element) {
        return running.has(element) || element?.dataset?.motionDragging ? windowFor(element).getComputedStyle?.(element) : null;
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
            progress: () => animation?.effect?.getComputedTiming?.().progress,
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
            animation = element.animate(frames, { duration:options.duration ?? 200, easing:options.easing || curves.enter, fill:'both' });
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
        const interruptedProgress = running.get(surface)?.progress();
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
        const contextual = settings.kind === 'context' || surface.classList?.contains('action-sheet') || surface.classList?.contains('v2-card-menu');
        const baseDuration = settings.duration ?? (settings.kind === 'page' ? (visible ? 300 : 260) : (visible ? 230 : 170));
        // A reversal covers only the distance already travelled, rather than restarting a full transition.
        const duration = Number.isFinite(interruptedProgress) && previous?.visible !== visible
            ? Math.max(90, baseDuration * Math.max(0, Math.min(1, interruptedProgress))) : baseDuration;
        const easing = visible || rootFrame || surfaceFrame ? curves.enter : curves.exit;
        const animations = [];
        if (settings.kind === 'page') {
            animations.push(animate(element, [
                rootFrame || { transform:visible ? 'translateX(100%)' : 'translateX(0)', opacity:1 },
                { transform:visible ? 'translateX(0)' : 'translateX(100%)', opacity:1 },
            ], { duration, easing }));
        } else {
            if (surface !== element) animations.push(animate(element, [
                { opacity:rootFrame?.opacity || (visible ? 0 : 1) }, { opacity:visible ? 1 : 0 },
            ], { duration, easing }));
            animations.push(animate(surface, [
                surfaceFrame || { opacity:visible ? 0 : 1, transform:visible ? (contextual ? 'translateY(4px) scale(.92)' : 'translateY(14px) scale(.98)') : 'translateY(0) scale(1)' },
                { opacity:visible ? 1 : 0, transform:visible ? 'translateY(0) scale(1)' : (contextual ? 'translateY(3px) scale(.96)' : 'translateY(9px) scale(.985)') },
            ], { duration, easing }));
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
            animate(from, [fromFrame || { transform:'translateX(0)', opacity:1 }, { transform:direction > 0 ? 'translateX(-16%)' : 'translateX(100%)', opacity:direction > 0 ? .82 : 1 }], { duration:300 }),
            animate(to, [toFrame || { transform:direction > 0 ? 'translateX(100%)' : 'translateX(-16%)', opacity:direction > 0 ? 1 : .82 }, { transform:'translateX(0)', opacity:1 }], { duration:300 }),
        ]).then(() => { if (route === current) current.cleanup(); });
    }

    function enter(element, kind = 'tab') {
        if (!element) return Promise.resolve();
        const first = capture(element) || { opacity:0, transform:kind === 'message' ? 'translateY(8px)' : 'translateY(4px)' };
        return animate(element, [first, { opacity:1, transform:'translateY(0)' }], { duration:kind === 'message' ? 240 : 200 });
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

    // Feedback never captures a pointer or prevents its default: scrolling, selection and
    // the application's long-press recognizer retain ownership of their gestures.
    function bindPressFeedback(doc) {
        const win = doc.defaultView;
        const selector = 'button,.v2-work-card,[data-motion-press]';
        let active = null;
        function clear() {
            active?.element.classList.remove('motion-pressed');
            active = null;
        }
        function target(event) {
            const element = event.target?.closest?.(selector);
            return element && !element.disabled && element.getAttribute?.('aria-disabled') !== 'true'
                && !element.closest?.('[inert]') ? element : null;
        }
        function down(event) {
            clear();
            if (event.isPrimary === false || (event.button != null && event.button !== 0)) return;
            const element = target(event);
            if (!element) return;
            active = { element, id:event.pointerId, x:event.clientX, y:event.clientY };
            element.classList.add('motion-pressed');
        }
        function move(event) {
            if (!active || event.pointerId !== active.id) return;
            if (Math.hypot(event.clientX - active.x, event.clientY - active.y) > 9) clear();
        }
        function release(event) { if (event.pointerId == null || active?.id === event.pointerId) clear(); }
        function keydown(event) {
            if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
            const element = target(event);
            if (!element) return;
            clear();
            active = { element };
            element.classList.add('motion-pressed');
        }
        function keyup(event) { if (event.key === 'Enter' || event.key === ' ') clear(); }
        const listeners = [
            [doc,'pointerdown',down], [doc,'pointermove',move], [doc,'pointerup',release],
            [doc,'pointercancel',release], [doc,'keydown',keydown], [doc,'keyup',keyup],
            [doc,'visibilitychange',clear], [doc,'focusout',clear], [win,'blur',clear],
        ];
        doc.body.classList.add('motion-press-ready');
        for (const [host, name, callback] of listeners) host.addEventListener(name, callback, { passive:true });
        return () => {
            clear();
            doc.body.classList.remove('motion-press-ready');
            for (const [host, name, callback] of listeners) host.removeEventListener(name, callback);
        };
    }

    function shouldDismiss(distance, velocity, height) {
        return distance >= Math.min(120, Math.max(64, height * .24)) || (distance >= 32 && velocity >= .55);
    }

    // Opt-in only. The dedicated handle must not contain editable content or controls;
    // no gesture starts from the message body, a scrolling list or a system edge.
    function bindDismiss(element, options = {}) {
        if (!element) return () => {};
        dismissals.get(element)?.();
        const surface = options.surface || element.firstElementChild || element;
        const handle = options.handle || '[data-motion-drag-handle]';
        const doc = element.ownerDocument;
        const win = doc.defaultView;
        let gesture = null;
        let suppressClick = false;
        let suppressTimer = null;
        function clearStyles(state) {
            surface.style.transform = state.transform;
            surface.style.opacity = state.opacity;
            delete surface.dataset.motionDragging;
            element.classList.remove('motion-dragging');
        }
        function stop(cancelled = false) {
            const state = gesture;
            if (!state) return;
            gesture = null;
            flushWrite(surface);
            try { surface.releasePointerCapture?.(state.id); } catch (_) { /* pointer already released */ }
            if (!state.started) return;
            const frame = capture(surface) || { transform:`translateY(${state.distance}px)`, opacity:1 };
            suppressClick = true;
            if (suppressTimer !== null) win.clearTimeout(suppressTimer);
            suppressTimer = win.setTimeout(() => { suppressClick = false; suppressTimer = null; }, 400);
            const dismiss = !cancelled && shouldDismiss(state.distance, state.velocity, state.height)
                && options.canDismiss?.() !== false;
            try {
                if (dismiss) options.onDismiss?.();
            } finally {
                clearStyles(state);
                // The callback is the authoritative close operation, including its busy guards.
                // If closing was refused (or no callback supplied), return smoothly to rest.
                if (isOpen(element)) animate(surface, [frame, { transform:state.transform || 'none', opacity:state.opacity || 1 }], { duration:260, easing:curves.settle });
            }
        }
        function down(event) {
            if (gesture || reduced(element) || !isOpen(element) || event.isPrimary === false || (event.button != null && event.button !== 0)) return;
            if (options.canDismiss?.() === false || event.clientX <= 24 || event.clientX >= win.innerWidth - 24) return;
            const grip = event.target?.closest?.(handle);
            if (!grip || !surface.contains(grip) || event.target?.closest?.('button,a,input,textarea,select,[contenteditable="true"]')) return;
            const now = Number(event.timeStamp) || 0;
            gesture = { id:event.pointerId, x:event.clientX, y:event.clientY, lastY:event.clientY, time:now,
                distance:0, velocity:0, height:surface.offsetHeight, started:false,
                transform:surface.style.transform, opacity:surface.style.opacity };
        }
        function move(event) {
            const state = gesture;
            if (!state || state.id !== event.pointerId) return;
            const dx = event.clientX - state.x;
            const dy = event.clientY - state.y;
            if (!state.started) {
                if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) || dy < -10) { gesture = null; return; }
                if (dy < 7) return;
                state.started = true;
                running.get(surface)?.finish();
                surface.dataset.motionDragging = 'true';
                element.classList.add('motion-dragging');
                try { surface.setPointerCapture?.(state.id); } catch (_) { /* synthetic pointer */ }
            }
            const elapsed = Number(event.timeStamp) - state.time;
            if (elapsed > 0) state.velocity = Math.max(0, (event.clientY - state.lastY) / elapsed);
            state.time = Number(event.timeStamp) || state.time;
            state.lastY = event.clientY;
            state.distance = Math.max(0, Math.min(dy, state.height + 80));
            event.preventDefault?.();
            writeFrame(surface, () => { surface.style.transform = `translateY(${state.distance}px)`; });
        }
        function up(event) {
            if (gesture?.id !== event.pointerId) return;
            // A paused hold at the release point is not a fast fling.
            if (Number(event.timeStamp) - gesture.time > 100) gesture.velocity = 0;
            stop(false);
        }
        function cancel(event) { if (event?.pointerId == null || gesture?.id === event.pointerId) stop(true); }
        function click(event) {
            if (!suppressClick) return;
            suppressClick = false;
            event.preventDefault();
            event.stopImmediatePropagation();
        }
        function visibilityChange() { if (doc.hidden) cancel(); }
        function motionPreference() { if (reduced(element)) cancel(); }
        const media = win.matchMedia?.('(prefers-reduced-motion: reduce)');
        element.classList.add('motion-dismiss-ready');
        surface.addEventListener('pointerdown', down, { passive:true });
        doc.addEventListener('pointermove', move, { passive:false });
        doc.addEventListener('pointerup', up, { passive:true });
        doc.addEventListener('pointercancel', cancel, { passive:true });
        surface.addEventListener('lostpointercapture', cancel);
        element.addEventListener('click', click, true);
        win.addEventListener('blur', cancel);
        doc.addEventListener('visibilitychange', visibilityChange);
        win.addEventListener('starlight:native-motion', motionPreference);
        media?.addEventListener?.('change', motionPreference);
        const dispose = () => {
            if (gesture) {
                const state = gesture; gesture = null;
                flushWrite(surface, true); clearStyles(state);
                try { surface.releasePointerCapture?.(state.id); } catch (_) { /* detached surface */ }
            }
            if (suppressTimer !== null) win.clearTimeout(suppressTimer);
            element.classList.remove('motion-dismiss-ready');
            surface.removeEventListener('pointerdown', down);
            doc.removeEventListener('pointermove', move);
            doc.removeEventListener('pointerup', up);
            doc.removeEventListener('pointercancel', cancel);
            surface.removeEventListener('lostpointercapture', cancel);
            element.removeEventListener('click', click, true);
            win.removeEventListener('blur', cancel);
            doc.removeEventListener('visibilitychange', visibilityChange);
            win.removeEventListener('starlight:native-motion', motionPreference);
            media?.removeEventListener?.('change', motionPreference);
            if (dismissals.get(element) === dispose) dismissals.delete(element);
        };
        dismissals.set(element, dispose);
        return dispose;
    }

    function initialize(doc) {
        if (installations.has(doc)) return installations.get(doc);
        const win = doc.defaultView;
        doc.body.classList.add('motion-ready');
        const nav = doc.querySelector('.bottom-nav');
        const position = () => navigation(nav, nav?.querySelector('button.active'), true);
        let frame = null;
        const resize = () => {
            if (frame !== null) return;
            frame = win.requestAnimationFrame(() => { frame = null; position(); });
        };
        const preference = () => { if (reduced(doc.body)) finishAll(); };
        const visibilityChange = () => { if (doc.hidden) finishAll(); };
        const media = win.matchMedia?.('(prefers-reduced-motion: reduce)');
        win.addEventListener('resize', resize);
        win.visualViewport?.addEventListener('resize', resize);
        media?.addEventListener?.('change', preference);
        win.addEventListener('starlight:native-motion', preference);
        doc.addEventListener('visibilitychange', visibilityChange);
        const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(resize) : null;
        const disposePress = bindPressFeedback(doc);
        if (nav) observer?.observe(nav);
        position();
        const dispose = () => {
            win.removeEventListener('resize', resize);
            win.visualViewport?.removeEventListener('resize', resize);
            media?.removeEventListener?.('change', preference);
            win.removeEventListener('starlight:native-motion', preference);
            doc.removeEventListener('visibilitychange', visibilityChange);
            observer?.disconnect();
            if (frame !== null) win.cancelAnimationFrame(frame);
            disposePress();
            installations.delete(doc);
        };
        installations.set(doc, dispose);
        return dispose;
    }

    return { animate, setVisible, isOpen, screens, enter, navigation, writeFrame, flushWrite, finishAll, whenIdle, initialize, bindPressFeedback, bindDismiss, shouldDismiss, reduced, curves };
});
