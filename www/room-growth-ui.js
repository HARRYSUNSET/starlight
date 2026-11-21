(function (root) {
    'use strict';
    const Growth = root.StarlightRoomGrowth;
    function mount(host, getRoom, member) {
        const doc = host.ownerDocument;
        function element(type, value) {
            const node = doc.createElement(type);
            if (value) node.textContent = value;
            return node;
        }
        const toggleLabel = element('label'), toggle = element('input');
        toggle.type = 'checkbox';
        toggle.checked = member.developmentEnabled !== false;
        toggleLabel.className = 'room-check';
        toggleLabel.append(toggle,' 使用剧情发展补充人物设定');
        toggle.onchange = () => { member.developmentEnabled = toggle.checked; };
        const details = element('details'), summary = element('summary','查看与编辑发展记录'), list = element('div');
        details.append(summary,list);
        host.replaceChildren(toggleLabel,details);
        let shown = 6;
        function render() {
            const rows = Growth.records(getRoom(),member);
            list.replaceChildren(element('p',rows.length
                ? '可调整此角色使用的设定。来源保留在世界书或关系档案，撤回来源后对应补充会自动移除。'
                : '重大关系变化会在这里留痕；开启本房间的世界书自动整理后，也会归入与此人物有关的装备、能力和处境变化。'));
            for (const row of rows.slice(0,shown)) {
                const card = element('section'), label = row.label + ' · 消息 '+(row.index+1);
                const heading = element('strong',label), action = element('button', row.hidden ? '恢复使用' : '从角色设定移除');
                action.type = 'button';
                action.className = 'mini-action-btn';
                action.onclick = () => { Growth.edit(member,row,{hidden:!row.hidden}); render(); };
                card.append(heading);
                if (!row.hidden) {
                    const type = element('select');
                    for (const [value,caption] of [['growth','成长变化'],['state','当前状态']]) {
                        const option = element('option',caption);
                        option.value = value;
                        type.append(option);
                    }
                    type.setAttribute('aria-label',label+'的类别');
                    type.value = row.section;
                    type.onchange = () => Growth.edit(member,row,{section:type.value});
                    const content = element('textarea');
                    content.setAttribute('aria-label',label+'的设定内容');
                    content.rows = 2;
                    content.value = row.text;
                    content.oninput = () => Growth.edit(member,row,{text:content.value});
                    content.onblur = () => { if (!content.value.trim()) content.value = row.originalText; };
                    const source = element('details');
                    source.append(element('summary','查看原文依据'),element('blockquote',row.evidence));
                    card.append(type,content,source);
                }
                card.append(action);
                list.append(card);
            }
            if (rows.length > shown) {
                const more = element('button','继续查看');
                more.type = 'button';
                more.className = 'mini-action-btn';
                more.onclick = () => { shown += 12; render(); };
                list.append(more);
            }
        }
        details.ontoggle = () => { if (details.open) render(); };
    }
    root.StarlightRoomGrowthUI = {mount};
})(globalThis);
