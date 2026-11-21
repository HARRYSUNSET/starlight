(function (root) {
    'use strict';

    const labels = {
        name:'名称', subtitle:'简介', scenePrompt:'开场场景', userPersona:'用户身份', otherInfo:'其他设定',
        personaPrompt:'角色基础档案', publicProfile:'公开身份', speakingStyle:'说话与行动风格', currentState:'当前状态',
        privateGoal:'私人目标', growthNotes:'成长记录', relationships:'关系网络', knowledgeBoundary:'知识边界与秘密',
        dialogueExamples:'对白示例', baseline:'关系起点', preferences:'偏好', boundaries:'边界', conditions:'关系变化条件', evidence:'原文依据',
    };
    function node(tag, value, className) {
        const el = document.createElement(tag);
        if (value) el.textContent = value;
        if (className) el.className = className;
        return el;
    }
    function fieldList(record, keys, evidence = record?.evidenceByField, prefix = '') {
        const dl = node('dl');
        for (const key of keys) {
            if (typeof record?.[key] === 'string' && record[key].trim()) {
                const value = node('dd',record[key]);
                const quote = evidence?.[prefix + key];
                if (typeof quote === 'string' && quote) {
                    const origin = node('details');
                    origin.append(node('summary','查看这项的原文'),node('blockquote',quote));
                    value.append(origin);
                }
                dl.append(node('dt',labels[key]), value);
            }
        }
        return dl;
    }
    function details(title, content) {
        const card = node('details','','rb-card');
        card.append(node('summary',title),content);
        return card;
    }
    function checkBox(label, checked, change, radio = false) {
        const wrapper = node('label','','rb-choice');
        const box = node('input');
        box.type = radio ? 'radio' : 'checkbox';
        if (radio) box.name = 'room-builder-participant';
        box.checked = checked;
        box.addEventListener('change', () => change(box.checked));
        wrapper.append(box, document.createTextNode(label));
        return wrapper;
    }

    function mergeProposals(parts) {
        const result = {name:'',subtitle:'',scenePrompt:'',userPersona:'',otherInfo:'',participants:[],worldEntries:[],issues:[]};
        const characters = new Map(), seenWorld = new Set(), notes = new Set();
        const info = new Map();
        function append(target,key,value) {
            if (!value) return;
            if (!info.has(target)) info.set(target,new Map());
            const record = info.get(target);
            if (!record.has(key)) record.set(key,new Set());
            const values = record.get(key);
            if (values.has(value)) return;
            values.add(value);
            target[key] = [...values].join('\n');
        }
        for (const part of parts) {
            for (const field of ['name','subtitle','scenePrompt']) {
                if (!result[field]) result[field] = part[field];
                else if (part[field] && result[field] !== part[field]) notes.add(labels[field] + '采用首次提取的内容。');
            }
            append(result,'userPersona',part.userPersona);
            append(result,'otherInfo',part.otherInfo);
            append(result,'evidence',part.evidence);
            for (const [field,quote] of Object.entries(part.evidenceByField || {})) {
                if (['name','subtitle','scenePrompt'].includes(field) && part[field] !== result[field]) continue;
                result.evidenceByField ||= {};
                append(result.evidenceByField,field,quote);
            }
            for (const member of part.participants) {
                const key = member.name.normalize('NFKC').replace(/\s+/gu,' ').trim().toLowerCase();
                if (!characters.has(key)) {
                    const next = {name:member.name,relationshipPolicy:{}};
                    characters.set(key,next);
                    result.participants.push(next);
                }
                const record = characters.get(key);
                for (const [field,value] of Object.entries(member)) {
                    if (field !== 'name' && typeof value === 'string') append(record,field,value);
                }
                for (const [field,value] of Object.entries(member.relationshipPolicy || {})) append(record.relationshipPolicy,field,value);
                for (const [field,quote] of Object.entries(member.evidenceByField || {})) {
                    record.evidenceByField ||= {};
                    append(record.evidenceByField,field,quote);
                }
            }
            for (const entry of part.worldEntries) {
                const signature = JSON.stringify([entry.knowledgeScope,[...(entry.characterNames || [])].sort(),entry.fields]);
                if (seenWorld.has(signature)) continue;
                seenWorld.add(signature);
                result.worldEntries.push(entry);
            }
            for (const issue of part.issues || []) notes.add(issue);
        }
        result.issues = [...notes];
        return result;
    }

    function mount(container, host) {
        container.innerHTML = `
            <details class="room-builder">
                <summary>AI 构建房间设定</summary>
                <div class="room-builder-body">
                    <label class="rb-label">构建方式<select class="rb-mode"><option value="source">从原文提取</option><option value="creative">按创作要求生成</option></select></label>
                    <label class="rb-label"><span class="rb-input-label"></span><textarea class="rb-text" rows="5"></textarea></label>
                    <p class="rb-caption"></p>
                    <p class="rb-count"></p>
                    <div class="rb-actions">
                        <button class="mini-action-btn rb-generate" type="button">生成设定预览</button>
                        <button class="mini-action-btn rb-file-pick" type="button">读取 TXT</button>
                        <input class="rb-file" type="file" accept=".txt,text/plain" hidden>
                        <button class="mini-action-btn rb-stop" type="button" hidden>停止生成</button>
                    </div>
                    <p class="rb-status" role="status" aria-live="polite"></p>
                    <div class="rb-preview"></div>
                    <div class="rb-accept" hidden>
                        <label class="rb-choice rb-growth-label"><input type="checkbox" class="rb-growth" checked>自动记录角色成长</label>
                        <label class="rb-choice rb-book-label"><input type="checkbox" class="rb-book" checked>自动整理后续世界书（额外调用模型）</label>
                        <div class="rb-actions">
                            <button class="mini-action-btn rb-edit" type="button">填入后继续编辑</button>
                            <button class="btn-confirm rb-create" type="button">创建并进入房间</button>
                        </div>
                    </div>
                </div>
            </details>`;
        const $ = selector => container.querySelector(selector);
        const mode = $('.rb-mode'), text = $('.rb-text'), generate = $('.rb-generate'), status = $('.rb-status');
        const stop = $('.rb-stop'), preview = $('.rb-preview'), accept = $('.rb-accept'), pick = $('.rb-file-pick'), file = $('.rb-file');
        const edit = $('.rb-edit'), create = $('.rb-create');
        const selected = new Set(), targets = new Map(), overwrite = new Set();
        let disposed = false, task = null, fileVersion = 0, proposal = null, stamp = '', applying = false, playAsSelf = false;
        if (host.existing) {
            create.hidden = true;
            $('.rb-growth-label').hidden = true;
            $('.rb-book-label').hidden = true;
            edit.textContent = '填入当前设定草稿';
        }
        function setBusy(busy) {
            mode.disabled = busy;
            text.readOnly = busy;
            generate.disabled = busy;
            pick.disabled = busy;
            stop.hidden = !busy;
            container.setAttribute('aria-busy', String(busy));
        }
        function clearPreview() {
            proposal = null;
            playAsSelf = false;
            stamp = '';
            selected.clear();
            targets.clear();
            overwrite.clear();
            preview.replaceChildren();
            accept.hidden = true;
        }
        function reset() {
            fileVersion++;
            task?.abort();
            task = null;
            setBusy(false);
            clearPreview();
            status.textContent = '';
            const source = text.value.trim();
            const count = source ? (mode.value === 'creative' ? 1 : root.StarlightWorldBookAI.splitText(source).filter(p => p.trim()).length) : 0;
            $('.rb-count').textContent = count ? '预计调用模型 ' + count + ' 次' : '';
        }
        function updateMode() {
            const creative = mode.value === 'creative';
            $('.rb-input-label').textContent = creative ? '创作要求' : '设定或作品原文';
            text.placeholder = creative ? '例如：设计一家只在雨夜开门的旅馆，我扮演新来的店员。' : '粘贴包含背景、人物或开场场景的原文';
            $('.rb-caption').textContent = creative ? '可由模型补写世界、人物与关系设定。采纳前可预览。' : '根据原文整理设定。已有栏位默认保留，可在预览中选择替换。';
            pick.hidden = creative;
        }
        function currentOptions() {
            return {selectedIndices:[...selected], overwriteKeys:[...overwrite],
                memberTargets:Object.fromEntries([...selected].map(i => [i,targets.get(i) || 'new']))};
        }
        function snapshot(draft) {
            return JSON.stringify([draft.roomType,draft.name,draft.subtitle,draft.scenePrompt,draft.userPersona,draft.otherInfo,
                draft.participants.map(member => [member.id,...Object.keys(labels).map(key => member[key]),member.relationshipPolicy])]);
        }
        function render() {
            if (!proposal) return;
            const draft = host.getDraft(), double = draft.roomType === 'double';
            for (const [i,id] of targets) {
                if (id !== 'new' && !draft.participants.some(p => p.id === id)) targets.delete(i);
            }
            const fragment = document.createDocumentFragment();
            const roomFields = fieldList(proposal, ['name','subtitle','scenePrompt','userPersona','otherInfo','evidence']);
            if (roomFields.childElementCount) fragment.append(details('房间、开场与用户身份', roomFields));
            if (!draft.userPersona.trim() && !proposal.userPersona) {
                const identity = checkBox('以我自己进入', playAsSelf, value => { playAsSelf = value; render(); });
                identity.classList.add('rb-self');
                fragment.append(identity);
            }
            if (proposal.worldEntries.length) {
                const list = node('dl');
                for (const entry of proposal.worldEntries) {
                    const visibility = entry.knowledgeScope === 'private'
                        ? '私有设定 · ' + ((entry.characterNames || []).join('、') || '仅作者') : '世界设定';
                    list.append(node('dt',visibility),node('dd',entry.fields.map(f => f.label + '：' + f.value).join('\n')));
                    if (entry.evidence) list.append(node('dt','原文依据'),node('dd',entry.evidence));
                }
                fragment.append(details('世界书 · ' + proposal.worldEntries.length + ' 项',list));
            }
            if (proposal.participants.length) fragment.append(node('strong',double ? '选择一名 AI 角色' : '选择参与的 AI 角色'));
            proposal.participants.forEach((member, index) => {
                const row = node('div','','rb-card');
                row.append(checkBox(member.name, selected.has(index), value => {
                    if (double) selected.clear();
                    if (value) selected.add(index); else selected.delete(index);
                    overwrite.clear();
                    render();
                }, double && !draft.participants.length));
                const info = fieldList(member, ['personaPrompt','publicProfile','speakingStyle','privateGoal','knowledgeBoundary','growthNotes','currentState','relationships','dialogueExamples','evidence']);
                const policy = fieldList(member.relationshipPolicy,['baseline','preferences','boundaries','conditions'],
                    member.evidenceByField,'relationshipPolicy.');
                if (info.childElementCount || policy.childElementCount) {
                    const detail = node('details');
                    detail.append(node('summary','查看人物与关系设定'),info,policy);
                    row.append(detail);
                }
                if (selected.has(index) && draft.participants.length) {
                    const label = node('label','填入位置','rb-label'), select = node('select');
                    select.className = 'rb-target';
                    select.add(new Option('新增角色','new'));
                    for (const p of draft.participants) select.add(new Option('现有角色 · ' + p.name,p.id));
                    select.value = targets.get(index) || 'new';
                    select.addEventListener('change', () => { targets.set(index, select.value); overwrite.clear(); render(); });
                    label.append(select);
                    row.append(label);
                }
                fragment.append(row);
            });
            let merged;
            try {
                merged = merge(draft);
                for (const conflict of merged.conflicts) {
                    const item = node('div','','rb-overwrite');
                    item.append(checkBox('替换' + conflict.label,overwrite.has(conflict.key), checked => {
                        if (checked) overwrite.add(conflict.key); else overwrite.delete(conflict.key);
                    }),node('p','当前：' + conflict.before),node('p','建议：' + conflict.after));
                    fragment.append(item);
                }
                const issue = merged.blocker;
                if (merged.issues.length) fragment.append(node('small',merged.issues.join(' ')));
                edit.disabled = !!issue;
                const next = merged.draft;
                const rosterOK = double ? next.participants.length === 1 : next.participants.length >= 2 && next.participants.length <= 8;
                const missing = [!next.name && '房间名称', !next.userPersona && '用户身份',
                    !rosterOK && (double ? '一名 AI 角色' : '二至八名 AI 角色'),
                    next.participants.some(p => !p.name || !p.personaPrompt) && '角色名称与基础档案'].filter(Boolean);
                create.disabled = !!issue || !!missing.length;
                if (issue || (!host.existing && missing.length)) fragment.append(node('small', issue || '创建前请补全' + missing.join('、') + '。可以先填入后编辑。'));
            } catch (error) {
                edit.disabled = create.disabled = true;
                fragment.append(node('small',error.message));
            }
            stamp = snapshot(draft);
            preview.replaceChildren(fragment);
            accept.hidden = false;
        }
        function merge(draft) {
            const options = currentOptions();
            const participantIds = [...selected].map(index => targets.get(index)).filter(id => id && id !== 'new');
            const merged = root.StarlightRoomBuilder.applyDraft(draft,proposal,options);
            if (playAsSelf && !merged.draft.userPersona.trim()) merged.draft.userPersona = '用户扮演自己，身份与行动由用户决定。';
            let blocker = '';
            if (new Set(participantIds).size !== participantIds.length) blocker = '请为每个入场人物选择不同的角色位置。';
            if (draft.roomType === 'double' && selected.size + draft.participants.length - participantIds.length > 1)
                blocker = '双人房间只容纳一名 AI 角色，请选择现有角色作为填入位置。';
            if (draft.roomType === 'group' && selected.size + draft.participants.length - participantIds.length > 8) blocker = '多人房间最多八名 AI 角色，请减少选择。';
            return {...merged,blocker};
        }
        async function apply(save) {
            if (!proposal || applying) return;
            const draft = host.getDraft();
            if (stamp !== snapshot(draft)) {
                overwrite.clear();
                render();
                status.textContent = '下方设定有改动，已按最新内容更新预览。';
                return;
            }
            applying = true;
            edit.disabled = create.disabled = true;
            try {
                const result = merge(draft);
                if (result.blocker) throw new Error(result.blocker);
                await host.apply(result.draft,{save,growth:$('.rb-growth').checked,worldProgress:$('.rb-book').checked});
                if (disposed) return;
                clearPreview();
                status.textContent = '已填入下方设定，可继续编辑并保存。';
            } catch (error) {
                if (!disposed) { render(); status.textContent = error.message; }
            } finally { applying = false; }
        }
        generate.addEventListener('click', async () => {
            if (task || applying) return;
            const input = text.value.trim();
            if (!input) { status.textContent = mode.value === 'creative' ? '请先填写创作要求。' : '请先粘贴或读取原文。'; return; }
            fileVersion++;
            clearPreview();
            const controller = new AbortController();
            task = controller;
            setBusy(true);
            status.textContent = '正在整理房间和人物设定…';
            try {
                const draft = host.getDraft();
                const creative = mode.value === 'creative';
                if (creative && input.length > 30000) throw new Error('请将创作要求精简到三万字以内，较长的作品原文可使用「从原文提取」。');
                const parts = creative ? [input] : root.StarlightWorldBookAI.splitText(input).filter(part => part.trim());
                const proposals = [];
                for (const [i,part] of parts.entries()) {
                    status.textContent = '正在整理设定 · ' + (i+1) + ' / ' + parts.length;
                    const context = {mode:mode.value,text:part,roomType:draft.roomType,
                        participants:draft.participants.map(({id,name}) => ({id,name}))};
                    if (creative) {
                        const existing = {name:draft.name.slice(0,120),subtitle:draft.subtitle.slice(0,300),
                            scenePrompt:draft.scenePrompt.slice(0,1600)};
                        if (Object.values(existing).some(Boolean)) context.existing = existing;
                    }
                    const raw = await host.request(root.StarlightRoomBuilder.buildMessages(context), controller.signal);
                    if (disposed || controller.signal.aborted || task !== controller) return;
                    if (!raw || !Array.isArray(raw.participants) || !Array.isArray(raw.worldEntries))
                        throw new Error('模型返回的房间设定结构不完整，请重试。');
                    proposals.push(root.StarlightRoomBuilder.parseResult(raw,context));
                }
                const result = proposals.length === 1 ? proposals[0] : mergeProposals(proposals);
                if (disposed || controller.signal.aborted || task !== controller) return;
                if (!result.participants.length && !result.worldEntries.length &&
                    !['name','subtitle','scenePrompt','userPersona','otherInfo'].some(k => result[k])) {
                    status.textContent = ['没有可填入的设定。可补充原文或创作要求后重试。',...(result.issues || [])].join(' ');
                    return;
                }
                proposal = result;
                const nameKey = name => name.trim().normalize('NFKC').replace(/\s+/gu,' ').toLowerCase();
                const placeholders = draft.participants.filter(p => /^角色\d+$/u.test(p.name) && !p.personaPrompt && !p.publicProfile);
                let occupied = draft.participants.length;
                proposal.participants.forEach((member,i) => {
                    const matches = draft.participants.filter(p => nameKey(p.name) === nameKey(member.name));
                    if (matches.length === 1) { targets.set(i,matches[0].id); selected.add(i); }
                });
                const used = new Set(targets.values());
                for (const [i,member] of proposal.participants.entries()) {
                    if (selected.has(i) || draft.participants.some(p => nameKey(p.name) === nameKey(member.name))) continue;
                    const empty = placeholders.find(p => !used.has(p.id));
                    if (empty) { targets.set(i,empty.id); used.add(empty.id); selected.add(i); }
                    else if (occupied < (draft.roomType === 'double' ? 1 : 8)) { selected.add(i); occupied++; }
                }
                render();
                status.textContent = ['预览已就绪。请核对入场角色与设定。', ...(result.issues || [])].join(' ');
            } catch (error) {
                if (!disposed && task === controller) status.textContent = controller.signal.aborted ? '已停止生成。' : '构建失败。' + error.message;
            } finally {
                if (!disposed && task === controller) { task = null; setBusy(false); }
            }
        });
        stop.addEventListener('click', () => { reset(); status.textContent = '已停止生成。'; });
        text.addEventListener('input', reset);
        mode.addEventListener('change', () => { reset(); updateMode(); });
        pick.addEventListener('click', () => file.click());
        file.addEventListener('change', async () => {
            const input = file.files[0];
            if (!input) return;
            file.value = '';
            reset();
            const token = fileVersion;
            try {
                const value = root.StarlightWorldBookUI.decodeTextFile(new Uint8Array(await input.arrayBuffer()));
                if (!disposed && token === fileVersion) { text.value = value; reset(); }
            } catch { if (!disposed && token === fileVersion) status.textContent = '文件读取失败，请直接粘贴文本。'; }
        });
        edit.addEventListener('click', () => apply(false));
        create.addEventListener('click', () => apply(true));
        updateMode();
        return {reset, dispose() { disposed = true; task?.abort(); container.replaceChildren(); }};
    }
    root.StarlightRoomBuilderUI = {mount};
})(globalThis);
