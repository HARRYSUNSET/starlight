const test = require('node:test');
const assert = require('node:assert/strict');
const Builder = require('../www/room-builder.js');

const SOURCE = '临海镇终年多雾。修灯人沈师傅右眼有疤，脾气倔，只肯在雨天出门。他把地下室的钥匙交给学徒阿岚，低声说：“别告诉别人。”';
const EVIDENCE = {
    shen: '修灯人沈师傅右眼有疤，脾气倔',
    lan: '他把地下室的钥匙交给学徒阿岚',
};

function messages(input) {
    return Builder.buildMessages({ mode: 'source', roomType: 'group', text: SOURCE, participants: [{ id: 'p1', name: '沈师傅' }], ...input });
}

function proposal() {
    return Builder.parseResult({
        name: '临海镇的灯', subtitle: '雾里修灯的人', scenePrompt: '雨天，修灯铺里', userPersona: '学徒阿岚',
        participants: [
            { name: '沈师傅', evidence: EVIDENCE.shen, personaPrompt: '右眼有疤，脾气倔', publicProfile: '修灯人', privateGoal: '守住地下室', knowledgeBoundary: '不知道阿岚偷看账本', speakingStyle: '话少', relationshipPolicy: { baseline: '师徒', preferences: '在意手艺', boundaries: '不提旧伤', conditions: '共同熬过一次夜' } },
            { name: '阿岚', evidence: EVIDENCE.lan, personaPrompt: '手脚勤快', privateGoal: '想学修灯' },
        ],
        worldEntries: [
            { fields: [{ label: '地点', value: '临海镇' }, { label: '规则', value: '终年多雾，靠灯塔导航' }], knowledgeScope: 'public', evidence: '临海镇终年多雾' },
            { fields: [{ label: '秘密', value: '地下室钥匙' }], knowledgeScope: 'private', characterNames: ['沈师傅', '阿岚'], evidence: '他把地下室的钥匙交给学徒阿岚' },
        ],
    }, { mode: 'source', roomType: 'group', text: SOURCE });
}

function draft(extra = {}) {
    return {
        roomType: 'group', name: '旧房间', subtitle: '', scenePrompt: '', userPersona: '', otherInfo: '',
        participants: [{ id: 'm1', name: '沈师傅', avatar: 'data:image/png;base64,AA', color: '#123456', enabled: false, personaPrompt: '手写人设' }],
        worldBook: { version: 2, initialEntries: [], progressEntries: [], automation: { enabled: false, sources: [] } },
        ...extra,
    };
}

test('构建请求包含 JSON 协议、角色 evidence 要求与已有角色，空文本拒绝', () => {
    const [system, user] = messages({ mode: 'creative', text: '想写一个海边修灯铺的日常', roomType: 'double' });
    assert.match(system.content, /只输出一个 JSON 对象/);
    assert.match(system.content, /privateGoal、knowledgeBoundary 只写进角色卡/);
    assert.match(system.content, /只能有一名 AI 角色/);
    assert.match(system.content, /evidence 可为空字符串/);
    const [strictSystem] = messages({ mode: 'source', text: SOURCE });
    assert.match(strictSystem.content, /每个角色、每条 worldEntry 的 evidence/);
    const payload = JSON.parse(user.content);
    assert.equal(payload.mode, 'creative');
    assert.equal(payload.roomType, 'double');
    assert.deepEqual(payload.participants, [{ id: 'p1', name: '沈师傅' }]);
    assert.match(payload.source, /海边修灯铺/);
    assert.throws(() => Builder.buildMessages({ text: '   ' }), /请先提供/);
});

test('source 模式核验角色与条目出处，缺失或错配的角色不提取', () => {
    const result = Builder.parseResult({
        participants: [
            { name: '沈师傅', evidence: EVIDENCE.shen },
            { name: '阿岚', evidence: '原文里没有这句话' },
            { name: '无名' },
            {},
        ],
        worldEntries: [
            { fields: [{ label: '地点', value: '临海镇' }], knowledgeScope: 'public', evidence: '临海镇终年多雾' },
            { fields: [{ label: '假事实', value: '不存在' }], knowledgeScope: 'public', evidence: '这句话不在原文里' },
        ],
    }, { mode: 'source', text: SOURCE });
    assert.deepEqual(result.participants.map(item => item.name), ['沈师傅']);
    assert.equal(result.worldEntries.length, 1);
    assert.ok(result.issues.some(issue => /角色「阿岚」：出处无法/.test(issue)));
    assert.ok(result.issues.some(issue => /缺少名字/.test(issue)));
    assert.ok(result.issues.some(issue => /条目/.test(issue) && /出处无法/.test(issue)));
});

test('创作模式允许空出处，但仍拒绝没有栏位内容的条目', () => {
    const result = Builder.parseResult({
        participants: [{ name: '阿岚' }],
        worldEntries: [
            { fields: [{ label: '氛围', value: '潮湿的雾' }], knowledgeScope: 'public', evidence: '' },
            { fields: [{ label: '空', value: '' }], knowledgeScope: 'public' },
        ],
    }, { mode: 'creative', text: '海边' });
    assert.equal(result.worldEntries.length, 1);
    assert.ok(result.issues.some(issue => /栏名或内容/.test(issue)));
});

test('未知或异常可见性按私密处理，绝不降级为公开', () => {
    const unknown = Builder.parseResult({
        participants: [{ name: '沈师傅' }],
        worldEntries: [
            { fields: [{ label: '秘密', value: '钥匙' }], knowledgeScope: 'team', characterNames: ['沈师傅'] },
            { fields: [{ label: '无收件人', value: '钥匙' }], knowledgeScope: 'unknown', characterNames: [] },
            { fields: [{ label: '格式异常', value: '账本' }], characterNames: { who: '沈师傅' } },
        ],
    }, { mode: 'creative', text: '种子' });
    assert.equal(unknown.worldEntries.length, 1);
    assert.equal(unknown.worldEntries[0].knowledgeScope, 'private');
    assert.ok(unknown.issues.some(issue => /私密或未知可见性/.test(issue) || /格式异常/.test(issue)));
});

test('合并只填空白，保留已有超长原文、id 与头像，不覆盖手写内容', () => {
    const longPersona = '长'.repeat(6000);
    const base = draft();
    base.participants[0].personaPrompt = longPersona;
    base.worldBook.initialEntries = [{ id: 'old', kind: 'initial', fields: [{ id: 'f', label: '旧', value: '旧'.repeat(6000) }], enabled: true, status: 'active', knowledgeScope: 'public', characterIds: [] }];
    const before = JSON.parse(JSON.stringify(base));
    const result = Builder.applyDraft(base, proposal(), { memberTargets: { 0: 'm1' }, createId: prefix => prefix + '_test' });
    const member = result.draft.participants.find(item => item.id === 'm1');
    assert.equal(member.personaPrompt, longPersona, '已有超长字段不得被截断');
    assert.equal(member.avatar, 'data:image/png;base64,AA');
    assert.equal(member.color, '#123456');
    assert.equal(member.enabled, false);
    assert.equal(result.draft.worldBook.initialEntries[0].fields[0].value, '旧'.repeat(6000));
    assert.equal(result.draft.name, '旧房间');
    assert.ok(result.conflicts.some(item => item.key === 'participant.m1.personaPrompt'));
    assert.deepEqual(base, before, '不得修改传入草稿');
});

test('双人房间最多一名 AI 角色，合并已有目标可以但新增被拒绝', () => {
    const base = draft({ roomType: 'double' });
    const result = Builder.applyDraft(base, proposal().participants ? { participants: proposal().participants, worldEntries: [] } : {}, {
        roomType: 'double', selectedIndices: [0, 1], memberTargets: { 0: 'm1', 1: 'new' }, createId: prefix => prefix + '_test',
    });
    assert.equal(result.draft.participants.length, 1);
    assert.ok(result.issues.some(issue => /双人房间只能有一名 AI 角色/.test(issue)));
    const merged = Builder.applyDraft(base, { participants: [proposal().participants[0]] }, { roomType: 'double', memberTargets: { 0: 'm1' } });
    assert.equal(merged.draft.participants.length, 1);
    assert.equal(merged.draft.participants[0].publicProfile, '修灯人');
});

test('显式映射到空白占位会填入名字，真实名字差异列为独立冲突', () => {
    const placeholder = draft();
    placeholder.participants[0].name = '角色1';
    placeholder.participants[0].personaPrompt = '';
    const renamed = Builder.applyDraft(placeholder, proposal(), { memberTargets: { 0: 'm1' }, createId: prefix => prefix + '_test' });
    assert.equal(renamed.draft.participants[0].name, '沈师傅');
    assert.ok(!renamed.conflicts.some(item => item.key === 'participant.m1.name'));

    const realName = draft();
    realName.participants[0].name = '老王';
    const kept = Builder.applyDraft(realName, proposal(), { memberTargets: { 0: 'm1' }, createId: prefix => prefix + '_test' });
    assert.equal(kept.draft.participants[0].name, '老王');
    assert.ok(kept.conflicts.some(item => item.key === 'participant.m1.name'));
    const forced = Builder.applyDraft(realName, proposal(), { memberTargets: { 0: 'm1' }, overwriteKeys: ['participant.m1.name'] });
    assert.equal(forced.draft.participants[0].name, '沈师傅');
});

test('私密条目通过候选到目标的显式映射绑定，未知或错配角色跳过', () => {
    const realName = draft();
    realName.participants[0].name = '老王';
    const single = {
        participants: [proposal().participants[0]],
        worldEntries: [{ fields: [{ label: '秘密', value: '钥匙' }], knowledgeScope: 'private', characterNames: ['沈师傅'], evidence: EVIDENCE.lan }],
    };
    const result = Builder.applyDraft(realName, single, { memberTargets: { 0: 'm1' } });
    const entry = result.draft.worldBook.initialEntries.find(item => item.knowledgeScope === 'private');
    assert.deepEqual(entry.characterIds, ['m1'], '候选名沈师傅应映射到目标 m1，而不是按最终名字匹配');
    assert.equal(entry.origin.evidence, EVIDENCE.lan);
    const mismatch = Builder.applyDraft(draft(), { participants: [proposal().participants[0]], worldEntries: [{ fields: [{ label: '秘密', value: '账本' }], knowledgeScope: 'private', characterNames: ['不存在的人'] }] }, { memberTargets: { 0: 'm1' } });
    assert.equal(mismatch.draft.worldBook.initialEntries.length, 0);
    assert.ok(mismatch.issues.some(issue => /无法匹配/.test(issue)));
});

test('重复导入去重，已有 20 条以上设定不丢失也不截断', () => {
    const base = draft();
    base.worldBook.initialEntries = Array.from({ length: 22 }, (_, index) => ({
        id: 'old' + index, kind: 'initial', fields: [{ id: 'f' + index, label: '旧栏' + index, value: '旧值' + index }],
        enabled: true, status: 'active', knowledgeScope: 'public', characterIds: [],
    }));
    const snapshot = JSON.parse(JSON.stringify(base.worldBook.initialEntries));
    const result = Builder.applyDraft(base, proposal(), { memberTargets: { 0: 'm1' } });
    assert.equal(result.draft.worldBook.initialEntries.length, 24);
    assert.deepEqual(result.draft.worldBook.initialEntries.slice(0,22), snapshot, '已有条目必须原样保留');

    const empty = draft();
    const first = Builder.applyDraft(empty, proposal(), { memberTargets: { 0: 'm1' } });
    const count = first.draft.worldBook.initialEntries.length;
    const second = Builder.applyDraft(first.draft, proposal(), { memberTargets: { 0: 'm1' } });
    assert.equal(second.draft.worldBook.initialEntries.length, count, '重复导入不得新增条目');
    assert.ok(second.issues.some(issue => /已存在相同设定/.test(issue)));
});

test('角色与世界条目上限生效，摘要只做本地计数', () => {
    const many = Builder.parseResult({
        participants: Array.from({ length: 12 }, (_, index) => ({ name: '角色' + index })),
        worldEntries: Array.from({ length: 25 }, (_, index) => ({ fields: [{ label: '栏' + index, value: '值' }], knowledgeScope: 'public' })),
    }, { mode: 'creative', text: '种子' });
    assert.equal(many.participants.length, 8);
    assert.equal(many.worldEntries.length, 20);
    assert.deepEqual(Builder.summarize(proposal()), { participantCount: 2, entryCount: 2, privateCount: 1 });
});

test('严格提取逐栏核对转述依据，未提供有效依据的建议保持空白', () => {
    const parsed = Builder.parseResult({scenePrompt:'无依据的午后',otherInfo:'校对过的转述',evidence:'不存在的证据',
        evidenceByField:{otherInfo:EVIDENCE.shen},participants:[{name:'沈师傅',evidence:EVIDENCE.shen,
            personaPrompt:'右眼有疤',privateGoal:'没有依据的秘密',relationshipPolicy:{baseline:'指导学徒'},
            evidenceByField:{'relationshipPolicy.baseline':EVIDENCE.lan}}]}, {mode:'source',text:SOURCE});
    assert.equal(parsed.scenePrompt,'');
    assert.equal(parsed.otherInfo,'校对过的转述');
    assert.equal(parsed.evidenceByField.otherInfo,EVIDENCE.shen);
    assert.equal(parsed.participants[0].privateGoal,'');
    assert.equal(parsed.participants[0].personaPrompt,'右眼有疤');
    assert.equal(parsed.participants[0].relationshipPolicy.baseline,'指导学徒');
});

test('私密设定仅绑定明确的角色；矛盾的可见性不能放宽接收范围', () => {
    const fields=[{label:'线索',value:'钟楼暗号'}];
    const parsed=Builder.parseResult({worldEntries:[{fields,knowledgeScope:'public',characterNames:['同名']},
        {fields,knowledgeScope:'public',characterNames:{a:'同名'}}]}, {mode:'creative'});
    assert.equal(parsed.worldEntries.length,1);
    assert.equal(parsed.worldEntries[0].knowledgeScope,'private');
    const base=draft({participants:[{id:'a',name:'同名'},{id:'b',name:'同名'}]});
    assert.equal(Builder.applyDraft(base,parsed).draft.worldBook.initialEntries.length,0);
    parsed.participants=[{name:'同名'}];
    const applied=Builder.applyDraft(base,parsed,{memberTargets:{0:'b'}});
    assert.deepEqual(applied.draft.worldBook.initialEntries[0].characterIds,['b']);
});
