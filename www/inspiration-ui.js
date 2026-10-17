(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StarlightInspirationUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // This controller is deliberately lazy: creating/opening it never asks the
    // model to learn. Only the two explicit generation actions invoke the API.
    function create(options) {
        const { document:doc, core, motion } = options;
        const el = id => doc.getElementById(id);
        const overlay = el('inspirationOverlay');
        const requestInput = el('inspirationRequestInput');
        const results = el('inspirationResults');
        const editor = el('inspirationDraft');
        const notice = el('inspirationNoticeText');
        let ownerId = null;
        let active = null;
        let noticeText = '';
        let diagnostics = '';
        let referenceVisible = false;

        function work() {
            const value = options.getWork();
            return value?.id === ownerId ? value : null;
        }
        function state(value = work()) {
            if (!value) return null;
            value.inspiration ||= core.normalizeState(null);
            return value.inspiration;
        }
        function persist() { options.save(); }
        function currentStamp(value = work()) { return options.fingerprint(value); }
        function setNotice(text, details = '') {
            noticeText = text; diagnostics = details;
            notice.textContent = text;
            el('inspirationNotice').hidden = !text;
            el('inspirationDiagnostics').textContent = details;
            el('inspirationDetails').hidden = !details;
        }
        function stale(kind) {
            const item = state();
            const stamp = item?.[kind === 'draft' ? 'draftStamp' : 'directionsStamp'];
            return Boolean(stamp && stamp !== currentStamp());
        }
        function showStep(step) {
            const item = state();
            if (!item || active) return;
            item.step = step; persist(); render();
            overlay.querySelector('.inspiration-scroll').scrollTop = 0;
            motion.enter(el(step === 'draft' ? 'inspirationDraftPage' : 'inspirationDirectionsPage'));
        }
        function render() {
            const value = work(), item = state(value);
            if (!item) return;
            const busy = Boolean(active);
            overlay.setAttribute('aria-busy', String(busy));
            const draftPage = item.step === 'draft';
            el('inspirationDirectionsPage').hidden = draftPage;
            el('inspirationDraftPage').hidden = !draftPage;
            el('inspirationDirectionsActions').hidden = draftPage;
            el('inspirationDraftActions').hidden = !draftPage;
            el('inspirationStep').textContent = draftPage ? '02 / 完整提示词' : '01 / 选择发展方向';
            el('btnInspirationBack').hidden = !draftPage;
            for (const button of overlay.querySelectorAll('[data-inspiration-generate],#btnRefreshInspirationProfile,#btnInspirationBack,#btnInspirationReferences')) button.disabled = busy;
            requestInput.disabled = busy;
            el('inspirationLength').disabled = busy;
            editor.disabled = busy;
            el('btnCancelInspiration').hidden = !busy;
            el('btnGenerateInspiration').textContent = busy && active.kind === 'directions' ? '正在整理方向…' : item.directions.length ? '换一组方向' : '生成推荐方向';
            el('btnExpandInspiration').textContent = busy && active.kind === 'full' ? '正在写完整提示词…' : '按所选方向生成完整稿';
            el('btnRewriteInspiration').textContent = busy ? '正在生成…' : '按补充要求重新生成';
            el('btnExpandInspiration').disabled = busy || !item.selectedId;
            el('btnCopyInspiration').disabled = busy || !item.draft.trim();
            el('btnUseInspiration').disabled = busy || !item.draft.trim();
            el('inspirationDraftCount').textContent = `${Array.from(item.draft).length.toLocaleString()} 字 · 可直接编辑 · 不自动发送`;
            el('inspirationProfileStatus').textContent = item.forceRefresh
                ? '已标记：下次生成完整稿时重新参考历史，不会单独发起学习请求。'
                : value.inspirationProfile ? '已有本剧情的写法偏好；生成时检查是否可复用。' : '首次生成完整稿时自动参考历史，无需预先添加范例。';
            results.replaceChildren();
            if (!item.directions.length) {
                const empty = doc.createElement('p'); empty.className = 'v2-empty-note';
                empty.textContent = '先看看下一章有哪些自然的发展方向，选好后再展开。也可以跳过这一步，直接生成完整稿。';
                results.appendChild(empty);
            }
            for (const direction of item.directions) {
                const button = doc.createElement('button'); button.type = 'button';
                button.className = 'inspiration-direction'; button.dataset.directionId = direction.id;
                button.setAttribute('aria-pressed', String(item.selectedId === direction.id));
                button.disabled = busy;
                const title = doc.createElement('strong'); title.textContent = direction.title;
                const text = doc.createElement('span'); text.textContent = direction.text;
                const reason = doc.createElement('small'); reason.textContent = direction.reason || '选择后可补充要求，再展开成完整提示词。';
                button.append(title, text, reason);
                button.addEventListener('click', () => {
                    item.selectedId = direction.id; persist(); render();
                    el('btnExpandInspiration').focus({ preventScroll:true });
                });
                results.appendChild(button);
            }
            setNotice(noticeText, diagnostics);
        }
        function cancel() {
            if (!active) return;
            const request = active; active = null; request.controller.abort();
            setNotice('已停止等待本次生成。原有草稿保留；已产生的 API 用量可能仍会计费。');
            render();
        }
        function close() {
            cancel(); referenceVisible = false;
            el('inspirationReferencePanel').hidden = true;
            el('inspirationInsertChoice').hidden = true;
            motion.setVisible(overlay, false);
            options.onClose?.();
        }
        function open() {
            const value = options.getWork();
            if (!value || !options.canGenerate()) return;
            if (active) cancel();
            ownerId = value.id;
            const item = state();
            requestInput.value = item.request;
            editor.value = item.draft;
            el('inspirationLength').value = String(item.targetChars || 0);
            el('inspirationInsertChoice').hidden = true;
            referenceVisible = false;
            el('inspirationReferencePanel').hidden = true;
            setNotice((item.draft && stale('draft')) || (item.directions.length && stale('directions'))
                ? '剧情或设定已变化。旧内容仍保留供回顾，使用前请重新生成或确认已核对。' : '');
            render();
            motion.setVisible(overlay, true, { kind:'page' });
            overlay.querySelector('.inspiration-scroll').scrollTop = 0;
        }
        async function generate(kind, direct = false) {
            const value = work(), item = state(value);
            if (!value || active || !options.canGenerate()) return;
            if (!options.hasKey()) return options.toast('请先在“我的”中设置 API Key', 'error');
            const selected = direct ? null : item.directions.find(direction => direction.id === item.selectedId);
            if (kind === 'full' && !direct && !selected && item.step !== 'draft') return options.toast('请先选择一个方向，或直接生成完整稿', 'info');
            if (selected && stale('directions')) {
                if (!options.confirm('这些方向依据的是较早的剧情。是否保留所选方向，并根据最新剧情重新核对后生成？')) return;
            }
            if (kind === 'full' && item.draft && !options.confirm('将重新生成完整提示词并替换此处草稿。是否继续？')) return;
            const request = { ownerId:value.id, kind, controller:new AbortController(), started:performance.now(), stamp:currentStamp() };
            active = request;
            setNotice(kind === 'directions' ? '正在结合当前剧情整理方向；本步骤不分析提示词写法。' : '正在核对剧情并参考你的提示词写法；学习与完整稿在同一次请求中完成。');
            render();
            let usage = null, status = 'success';
            try {
                const snapshot = options.snapshot(value, { direction:item.request, selectedDirection:selected, targetChars:item.targetChars, forceProfileRefresh:item.forceRefresh });
                request.apiKey = snapshot.apiKey;
                const result = await (kind === 'directions' ? core.requestDirections : core.requestFullPrompt)(snapshot, { signal:request.controller.signal });
                usage = result.usage;
                options.recordUsage?.(usage);
                if (active !== request || work() !== value || !options.sameKey(request.apiKey)) return;
                if (request.stamp !== currentStamp()) {
                    setNotice('生成期间剧情或设定已变化，本次结果未覆盖草稿。请根据最新剧情重新生成。');
                    return;
                }
                if (kind === 'directions') {
                    item.directions = result.directions; item.selectedId = ''; item.directionsStamp = request.stamp; item.step = 'directions';
                    setNotice('选择一个方向后，可补充要求，再生成一份完整提示词。');
                } else {
                    item.draft = result.draft; item.draftStamp = request.stamp; item.step = 'draft';
                    if (direct) item.selectedId = '';
                    value.inspirationProfile = result.profile; item.forceRefresh = false;
                    editor.value = item.draft;
                    setNotice(result.profileReused ? '已参考本剧情保存的写法偏好，完整稿可编辑后使用。' : result.examples?.length ? '已自动参考历史提示词并保存写法偏好；没有额外学习调用。' : '暂未找到合适的长篇历史提示词，已按默认写法生成；可在参考管理中指定范例。');
                }
                persist();
                motion.enter(el(item.step === 'draft' ? 'inspirationDraftPage' : 'inspirationDirectionsPage'));
            } catch (error) {
                status = error.name === 'AbortError' ? 'cancelled' : 'failure';
                if (error.usage) { usage=error.usage; options.recordUsage?.(usage); }
                if (active === request && error.name !== 'AbortError') {
                    setNotice(core.describeError(error) + (item.draft || item.directions.length ? ' 上次成功的内容仍保留。' : ''), JSON.stringify(error.diagnostics || {}, null, 2));
                }
            } finally {
                options.recordTask?.(kind === 'directions' ? '灵感方向' : '灵感完整稿', request.started, usage, status);
                if (active === request) { active = null; render(); }
            }
        }
        function fill(mode) {
            const value = work(), item = state(value);
            if (!item?.draft.trim() || active) return;
            if (stale('draft') && !options.confirm('这份草稿生成后，剧情或设定已变化。请先核对内容。仍然填入输入框吗？')) return;
            if (!mode && options.composerValue().trim()) {
                el('inspirationInsertChoice').hidden = false;
                el('inspirationInsertChoice').scrollIntoView({block:'center',behavior:'instant'});
                el('btnInspirationAppend').focus({ preventScroll:true });
                return;
            }
            options.fillComposer(item.draft, mode !== 'append');
            // Conservatively exclude an adopted (even edited) generated prompt
            // from auto-learning. Explicit reference approval overrides this.
            value.inspirationDraftSource = options.composerValue();
            persist(); close();
        }
        function references() {
            const value = work();
            if (!value || active) return;
            const host = el('inspirationReferenceList');
            referenceVisible = !referenceVisible;
            el('inspirationReferencePanel').hidden = !referenceVisible;
            if (!referenceVisible) return;
            host.replaceChildren();
            const chosen = new Set(core.selectExamples(value.conversations).map(sample => sample.index));
            const eligible = value.conversations.map((message,index)=>({message,index})).filter(({message})=>message.role==='user' && (message.content.length>=60 || message.inspirationExample));
            const recent = eligible.slice(-20);
            for (const selected of eligible.filter(entry=>chosen.has(entry.index))) if (!recent.includes(selected)) recent.unshift(selected);
            if (!recent.length) { host.textContent = '当前剧情还没有合适的长篇用户输入；无需添加也可以先按默认写法生成。'; return; }
            for (const {message,index} of recent) {
                const row = doc.createElement('div'); row.className = 'inspiration-reference';
                const copy = doc.createElement('p'); copy.textContent = `#${index + 1}${chosen.has(index) ? ' · 当前参考' : ''}${message.inspirationGenerated ? ' · 灵感生成' : ''}\n${message.content.slice(0,180)}${message.content.length>180?'…':''}`;
                const select = doc.createElement('select'); select.setAttribute('aria-label', `第 ${index + 1} 条输入的参考方式`);
                for (const [key,label] of [['auto','自动选择'],['pin','指定参考'],['exclude','不作为范例']]) { const option=doc.createElement('option');option.value=key;option.textContent=label;select.appendChild(option); }
                select.value = message.inspirationExcluded ? 'exclude' : message.inspirationExample ? 'pin' : 'auto';
                select.addEventListener('change',()=>{message.inspirationExample=select.value==='pin';message.inspirationExcluded=select.value==='exclude';state().forceRefresh=true;persist();render();});
                row.append(copy,select);host.appendChild(row);
            }
        }
        requestInput.addEventListener('input',()=>{const item=state();if(item){item.request=requestInput.value;persist();}});
        editor.addEventListener('input',()=>{const item=state();if(item){item.draft=editor.value;persist();el('inspirationDraftCount').textContent=`${Array.from(item.draft).length.toLocaleString()} 字 · 可直接编辑 · 不自动发送`;el('btnUseInspiration').disabled=el('btnCopyInspiration').disabled=!item.draft.trim();}});
        el('inspirationLength').addEventListener('change',()=>{state().targetChars=Number(el('inspirationLength').value)||0;persist();});
        el('btnGenerateInspiration').addEventListener('click',()=>generate('directions'));
        el('btnDirectInspiration').addEventListener('click',()=>generate('full',true));
        el('btnExpandInspiration').addEventListener('click',()=>generate('full'));
        el('btnRewriteInspiration').addEventListener('click',()=>generate('full'));
        el('btnInspirationBack').addEventListener('click',()=>showStep('directions'));
        el('btnRefreshInspirationProfile').addEventListener('click',()=>{state().forceRefresh=true;persist();render();});
        el('btnInspirationReferences').addEventListener('click',references);
        el('btnUseInspiration').addEventListener('click',()=>fill());
        el('btnInspirationReplace').addEventListener('click',()=>fill('replace'));
        el('btnInspirationAppend').addEventListener('click',()=>fill('append'));
        el('btnInspirationKeep').addEventListener('click',()=>{el('inspirationInsertChoice').hidden=true;});
        el('btnCopyInspiration').addEventListener('click',()=>options.copy(state().draft));
        el('btnCancelInspiration').addEventListener('click',cancel);
        el('btnCloseInspiration').addEventListener('click',close);
        overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
        doc.addEventListener('visibilitychange',()=>{if(doc.hidden)cancel();});
        return { open,close,cancel,generate, get busy(){return Boolean(active);} };
    }
    return { create };
});
