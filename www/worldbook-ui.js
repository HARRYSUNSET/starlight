(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StarlightWorldBookUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function decodeTextFile(bytes) {
        if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
        if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
        try {
            return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
            return new TextDecoder('gb18030', { fatal: true }).decode(bytes);
        }
    }

    // A background extraction can finish while settings are open. Preserve its
    // additions and removals, as well as the author's edits to the open draft.
    function mergeDraft(base, draft, latest) {
        if (!base || !latest) return draft;
        const result = { ...draft, automation: { ...latest.automation, enabled: draft.automation.enabled } };
        for (const key of ['initialEntries', 'progressEntries']) {
            const opened = new Map(base[key].map(entry => [entry.id, entry]));
            const current = new Map(latest[key].map(entry => [entry.id, entry]));
            const entries = [];
            for (const edited of draft[key]) {
                const original = opened.get(edited.id);
                if (!original || JSON.stringify(original) !== JSON.stringify(edited)) entries.push(edited);
                else if (current.has(edited.id)) entries.push(current.get(edited.id));
            }
            const seen = new Set(entries.map(entry => entry.id));
            for (const entry of current.values()) {
                if (!opened.has(entry.id) && !seen.has(entry.id)) entries.push(entry);
            }
            result[key] = entries;
        }
        return result;
    }

    function mount(container, options) {
        const { mode, ai, getBook, getParticipants, request, replaceBook } = options;
        const room = mode === 'room';
        container.className = 'wb-tools';
        container.innerHTML = `
            <details class="wb-import">
                <summary>从文本构建世界书</summary>
                <div class="wb-import-body">
                    <label class="wb-source-label">设定或小说原文<textarea class="wb-source" rows="5" placeholder="粘贴原文，提取背景、人物与世界规则"></textarea></label>
                    <p class="wb-hint">勾选所需条目并加入初始设定，随后保存。${room ? '每条设定均可指定知情角色。' : ''}离开编辑页会停止分析。</p>
                    <div class="wb-actions">
                        <button type="button" class="mini-action-btn wb-analyze">分析文本</button>
                        <button type="button" class="mini-action-btn wb-pick">读取 TXT</button>
                        <input type="file" accept=".txt,text/plain" class="wb-file" hidden>
                        <button type="button" class="mini-action-btn wb-cancel" hidden>停止分析</button>
                    </div>
                    <p class="wb-status" role="status" aria-live="polite"></p>
                    <div class="wb-results"></div>
                    <button type="button" class="mini-action-btn wb-apply" hidden>将所选条目加入初始设定</button>
                </div>
            </details>
            <label class="wb-auto-label"><input type="checkbox" class="wb-auto"><span>自动整理后续进展<small>${room ? '从新保存的角色回复和已采纳情景提取变化。' : '从新保存的剧情正文提取装备、能力、关系等变化。'}开启后将额外调用模型。</small></span></label>
            <div class="wb-retry-row" hidden><button type="button" class="mini-action-btn wb-retry">重试未完成的整理</button><span role="status"></span></div>`;
        const $ = selector => container.querySelector(selector);
        const source = $('.wb-source'), status = $('.wb-status'), results = $('.wb-results');
        const analyze = $('.wb-analyze'), stop = $('.wb-cancel'), apply = $('.wb-apply');
        const pick = $('.wb-pick'), file = $('.wb-file'), auto = $('.wb-auto'), retry = $('.wb-retry');
        auto.checked = getBook().automation.enabled;
        auto.addEventListener('change', () => {
            getBook().automation.enabled = auto.checked;
            retry.disabled = !auto.checked;
        });
        let retryOnSave = false;
        if (getBook().automation.sources.some(row => row.status === 'failed')) {
            $('.wb-retry-row').hidden = false;
            retry.disabled = !auto.checked;
            retry.addEventListener('click', () => {
                retryOnSave = true;
                retry.disabled = true;
                $('.wb-retry-row span').textContent = '保存设定后开始重试';
            });
        }

        let disposed = false, controller = null, fileRevision = 0, run = null;
        function clearResults() {
            run = null;
            results.replaceChildren();
            apply.hidden = true;
            status.textContent = '';
            analyze.textContent = '分析文本';
            analyze.disabled = false;
        }
        function busy(value) {
            source.readOnly = value;
            analyze.disabled = value;
            pick.disabled = value;
            stop.hidden = !value;
            container.setAttribute('aria-busy', String(value));
        }
        function showEstimate() {
            const count = ai.splitText(source.value).length;
            if (count) status.textContent = `原文共 ${count} 段，点击分析后每段调用模型一次。`;
        }
        source.addEventListener('input', () => { fileRevision++; clearResults(); showEstimate(); });
        pick.addEventListener('click', () => file.click());
        file.addEventListener('change', async () => {
            const selected = file.files[0];
            file.value = '';
            if (!selected) return;
            const revision = ++fileRevision;
            clearResults();
            analyze.disabled = true;
            status.textContent = '正在读取原文…';
            try {
                const value = decodeTextFile(new Uint8Array(await selected.arrayBuffer()));
                if (disposed || fileRevision !== revision) return;
                clearResults();
                source.value = value;
                showEstimate();
                status.textContent = '已读取 ' + selected.name + '。' + status.textContent;
            } catch {
                if (!disposed && fileRevision === revision) status.textContent = '读取失败，可以直接粘贴原文。';
            } finally {
                if (!disposed && fileRevision === revision) analyze.disabled = false;
            }
        });

        function element(tag, text, cls) {
            const node = document.createElement(tag);
            if (cls) node.className = cls;
            if (text) node.textContent = text;
            return node;
        }
        function updateApply() {
            const count = run.items.filter(item => item.selected).length;
            apply.disabled = !count;
            apply.textContent = `将所选 ${count} 条加入初始设定`;
        }
        function renderCandidate(item) {
            const entry = item.entry;
            const card = element('div', '', 'wb-candidate');
            const label = element('label', '', 'wb-select-entry');
            const check = element('input');
            check.type = 'checkbox';
            check.checked = item.selected;
            check.addEventListener('change', () => { item.selected = check.checked; updateApply(); });
            label.append(check, element('strong', entry.fields[0].value));
            const details = element('details');
            details.append(element('summary', '栏位与原文依据'));
            const fields = element('dl');
            for (const field of entry.fields) fields.append(element('dt', field.label), element('dd', field.value));
            details.append(fields, element('blockquote', entry.evidence));
            card.append(label, details);
            if (room) {
                const scopeLabel = element('label', '知识范围', 'wb-visibility');
                const scope = element('select');
                scope.add(new Option('房间公开', 'public'));
                scope.add(new Option('仅指定角色知道', 'private'));
                scope.value = entry.knowledgeScope;
                scopeLabel.append(scope);
                const recipients = element('div', '', 'wb-recipients');
                const participants = getParticipants();
                for (const member of participants) {
                    const memberLabel = element('label'), box = element('input');
                    box.type = 'checkbox';
                    box.checked = entry.characterIds.includes(member.id);
                    box.addEventListener('change', () => {
                        entry.characterIds = entry.characterIds.filter(id => id !== member.id);
                        if (box.checked) entry.characterIds.push(member.id);
                    });
                    memberLabel.append(box, document.createTextNode(member.name || '未命名角色'));
                    recipients.append(memberLabel);
                }
                recipients.append(element('small', '未指定知情角色时，仅作者可见。'));
                scope.addEventListener('change', () => {
                    entry.knowledgeScope = scope.value;
                    recipients.hidden = scope.value !== 'private';
                });
                recipients.hidden = scope.value !== 'private';
                card.append(scopeLabel, recipients);
            }
            results.append(card);
        }
        analyze.addEventListener('click', async () => {
            if (controller) return;
            if (!source.value.trim()) { status.textContent = '请先粘贴原文或读取 TXT 文件。'; return; }
            fileRevision++;
            const task = new AbortController();
            controller = task;
            busy(true);
            try {
                if (!run) run = { chunks: ai.splitText(source.value), index: 0, items: [] };
                for (; run.index < run.chunks.length; run.index++) {
                    const context = { mode, kind: 'initial', text: run.chunks[run.index], book: getBook(), participants: getParticipants() };
                    status.textContent = `正在分析第 ${run.index + 1} / ${run.chunks.length} 段…`;
                    const raw = await request(ai.buildMessages(context), task.signal);
                    if (disposed || task.signal.aborted) return;
                    const entries = ai.parseResult(raw, context);
                    run.items.push(...entries.map(entry => ({ entry, selected: true })));
                }
                results.replaceChildren();
                run.items.forEach(renderCandidate);
                status.textContent = run.items.length ? `提取到 ${run.items.length} 条候选设定，请核对后加入。` : '原文中没有提取到有依据的设定。可以修改原文再次分析。';
                apply.hidden = !run.items.length;
                updateApply();
            } catch (error) {
                if (!disposed && !task.signal.aborted) status.textContent = '分析未完成。' + error.message;
            } finally {
                if (!disposed) {
                    busy(false);
                    if (task.signal.aborted) status.textContent = '分析已停止，可以接着分析。';
                    if (run && run.index < run.chunks.length) analyze.textContent = '继续分析';
                    else if (run) analyze.disabled = true;
                    controller = null;
                }
            }
        });
        stop.addEventListener('click', () => controller?.abort());
        apply.addEventListener('click', () => {
            if (!run || controller || !run.items.some(item => item.selected)) return;
            const entries = run.items.filter(item => item.selected).map(item => item.entry);
            try {
                const result = ai.applyEntries(getBook(), entries, {
                    kind: 'initial', sourceKey: options.makeKey(), sourceLabel: '导入原文',
                });
                replaceBook(result.book);
                clearResults();
                status.textContent = result.added ? `已加入 ${result.added} 条初始设定。保存当前设定后生效。` : '所选设定已存在。';
            } catch (error) {
                status.textContent = error.message;
            }
        });
        return {
            shouldRetry: () => retryOnSave && auto.checked,
            dispose() {
                disposed = true;
                controller?.abort();
                container.replaceChildren();
            },
        };
    }
    return { mount, mergeDraft, decodeTextFile };
});
