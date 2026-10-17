const test = require('node:test');
const assert = require('node:assert/strict');

const Memory = require('../www/memory.js');
const Story = require('../www/story.js');

function fieldsByLabel(character) {
    return Object.fromEntries(character.fields.map(field => [field.label, field.value]));
}

test('新剧情角色默认只有名称、外貌和性格三栏', () => {
    const character = Story.createCharacter();
    assert.deepEqual(character.fields.map(field => field.label), [
        '角色名称',
        '角色外貌',
        '角色性格',
    ]);
    assert.ok(character.fields.every(field => field.value === ''));
});

test('新增角色复制上一角色的栏名和顺序但不复制内容', () => {
    const first = Story.createCharacter(['角色名称', '角色外貌', '角色性格', '角色特殊能力', '角色目标']);
    first.fields.forEach((field, index) => field.value = `内容${index + 1}`);
    const second = Story.cloneCharacterSchema(first);

    assert.deepEqual(second.fields.map(field => field.label), first.fields.map(field => field.label));
    assert.ok(second.fields.every(field => field.value === ''));
    assert.notEqual(second.id, first.id);
    assert.notDeepEqual(second.fields.map(field => field.id), first.fields.map(field => field.id));
});

test('旧版通用智能体会无损迁移为角色1的自定义栏位', () => {
    const story = Story.normalizeAgent({
        id: 'legacy_agent',
        name: '林澈',
        surfacePrompt: '冷静，但会认真回应用户。',
        appearance: '黑色短发。',
        currentState: '刚结束长途旅行。',
        knowledgeBoundary: '不知道储物柜密码。',
        conversations: [
            { role: 'user', content: '记住雨夜。', bookmarked: true },
            { role: 'assistant', content: '好。' },
        ],
    }, Memory);
    const fields = fieldsByLabel(story.characters[0]);

    assert.equal(story.id, 'legacy_agent');
    assert.equal(story.characters.length, 1);
    assert.equal(fields['角色名称'], '林澈');
    assert.equal(fields['角色外貌'], '黑色短发。');
    assert.equal(fields['角色性格'], '冷静，但会认真回应用户。');
    assert.equal(fields['当前状态'], '刚结束长途旅行。');
    assert.equal(fields['知识边界、误解与秘密'], '不知道储物柜密码。');
    assert.equal(story.conversations.length, 2);
    assert.equal(story.conversations[0].bookmarked, true);
    assert.equal(story.memory.version, 4);
});

test('损坏的空角色或空栏位数据会恢复最低可编辑结构', () => {
    const story = Story.normalizeAgent({ name: '测试剧情', characters: [{ id: 'empty', fields: [] }] }, Memory);
    assert.equal(story.characters.length, 1);
    assert.equal(story.characters[0].fields.length, 3);
});

test('剧情提示词明确分隔多名角色及其自定义栏位', () => {
    const story = Story.normalizeAgent({
        name: '车站重逢',
        worldPrompt: '现代海边小城。',
        openingScene: '雨后清晨的旧车站。',
        userPersona: '用户扮演旧友。',
        characters: [
            {
                fields: [
                    { label: '角色名称', value: '林澈' },
                    { label: '角色性格', value: '外冷内热，做事认真。' },
                    { label: '成长与变化记录', value: '已经学会在困难时主动求助。' },
                    { label: '知识边界', value: '不知道储物柜密码。' },
                ],
            },
            {
                fields: [
                    { label: '角色名称', value: '夏遥' },
                    { label: '角色特殊能力', value: '能够听见旧物残留的声音。' },
                    { label: '角色目标', value: '找到失踪的站长。' },
                ],
            },
        ],
        styleExamples: '她把伞一收，鞋尖在水洼边停了停。',
    }, Memory);
    const prompt = Story.buildSystemPrompt(
        story,
        '保持故事连续。',
        Memory.normalizeConfig(),
        Memory.NATURAL_STYLE_GUIDE,
        Memory
    );

    assert.match(prompt, /角色设定区｜各角色资料彼此独立/);
    assert.match(prompt, /【角色1】[\s\S]*角色名称：林澈/);
    assert.match(prompt, /【角色2】[\s\S]*角色名称：夏遥/);
    assert.match(prompt, /角色特殊能力：能够听见旧物残留的声音/);
    assert.match(prompt, /每个角色都是独立人物/);
    assert.match(prompt, /文风示例/);
    assert.doesNotMatch(prompt, /亲密度判定|候选角色/);
});

test('复制到房间时可以准确选择剧情中的某一名角色', () => {
    const story = Story.normalizeAgent({
        name: '双角色剧情',
        characters: [
            { id: 'lin', fields: [{ label: '角色名称', value: '林澈' }, { label: '角色性格', value: '沉静而敏锐。' }] },
            { id: 'xia', fields: [{ label: '角色名称', value: '夏遥' }, { label: '角色目标', value: '找到失踪的站长。' }] },
        ],
    }, Memory);
    const copied = Story.characterToRoomMember(story, 'xia');

    assert.equal(copied.name, '夏遥');
    assert.match(copied.personaPrompt, /角色目标：找到失踪的站长/);
    assert.doesNotMatch(copied.personaPrompt, /林澈|沉静而敏锐/);
});

test('剧情提示词可注入独立文风快照且保留事实优先级', () => {
    const story = Story.normalizeAgent({
        name: '测试剧情',
        styleInfluence: { name: '保留字段', analysis: { factors: [{ name: '节奏', instruction: '自然停顿' }] } },
    }, Memory);
    const influence = '【当前对话独立文风档案】\n文风低于人物事实与历史。';
    const prompt = Story.buildSystemPrompt(story, '', Memory.normalizeConfig(), '', Memory, influence);
    assert.match(prompt, /当前对话独立文风档案/);
    assert.match(prompt, /文风低于人物事实与历史/);
    assert.equal(story.styleInfluence.name, '保留字段');
});

test('世界书替代旧世界观进入剧情系统提示词', () => {
    const story = Story.normalizeAgent({ name: '迁移测试', worldPrompt: '旧版世界设定原文。' }, Memory);
    const prompt = Story.buildStructuredPrompt(story, '');
    assert.match(prompt, /世界书｜初始世界设定/);
    assert.match(prompt, /旧版世界设定原文/);
    assert.doesNotMatch(prompt, /【世界观与背景】/);
});

test('请求一次构建完整规则与原有本轮提醒，完整人设、示例与文风不被删减', () => {
    const story = Story.createAgent({
        storyRules: '只能依据角色知情范围继续剧情。',
        characters: [{ fields: [{ label: '角色名称', value: '夏遥' }, { label: '特殊经历', value: '已经找回站长的信件。' }] }],
        styleExamples: '她把信装回口袋，点了点头。',
    }, Memory);
    const global = '尊重用户的行动决定。';
    const naturalStyle = '普通接话可以短，不为展示人设强行抒情。';
    const influence = '【独立文风】\n自然停顿，保留对白因果。';
    const args = [story, global, Memory.normalizeConfig(), naturalStyle, Memory, influence];
    const expectedSystem = Story.buildSystemPrompt(...args);
    const expectedReminder = Story.buildTurnReminder(...args);
    let settingsReads = 0;
    const stylePrompt = story.stylePrompt;
    Object.defineProperty(story, 'stylePrompt', { get() { settingsReads += 1; return stylePrompt; } });

    const request = Story.buildRequestPrompts(...args);
    assert.equal(settingsReads, 1);
    assert.equal(request.systemPrompt, expectedSystem);
    assert.equal(request.turnReminder, expectedReminder);
    for (const text of [global, story.storyRules, story.styleExamples, naturalStyle, influence, '特殊经历：已经找回站长的信件。']) {
        assert.ok(request.systemPrompt.includes(text), text);
    }
});

test('十万条历史构建提示词只访问末条有效消息，不遍历原文或克隆无关档案', () => {
    const conversations = new Array(100000);
    Object.defineProperty(conversations, '0', { get() { throw new Error('不应读取旧历史'); } });
    conversations[99998] = { role: 'user', content: '今天去旧车站吧。' };
    conversations[99999] = null;
    const source = {
        name: '旧版角色',
        surfacePrompt: '她在旧车站工作。',
        conversations,
        worldBook: { initialEntries: [{
            fields: [{ label: '营业时间', value: '旧车站傍晚六点关闭。' }],
            activationMode: 'keywords', keywords: ['旧车站'],
        }] },
    };
    for (const key of ['styleInfluence', 'memory', 'avatar', 'snippets', 'draft']) {
        Object.defineProperty(source, key, {
            enumerable: true,
            get() { throw new Error(`提示词不应访问 ${key}`); },
        });
    }
    const request = Story.buildRequestPrompts(source, '', Memory.normalizeConfig(), '', Memory);
    assert.match(request.systemPrompt, /营业时间：旧车站傍晚六点关闭。/);
    assert.match(request.stableSystemPrompt, /她在旧车站工作/);
    assert.doesNotMatch(request.turnReminder, /她在旧车站工作/);
});

test('省略空角色栏位只减少请求内容，完整编辑结构与角色分隔仍然保留', () => {
    const story = Story.createAgent({ characters: [
        { fields: [
            { label: '角色名称', value: '林澈' },
            { label: '角色外貌', value: '  \n\t ' },
            { label: '特殊暗号', value: '写着“（未填写）”的纸条。' },
        ] },
        Story.createCharacter(),
    ] }, Memory);
    const before = structuredClone(story);
    const prompt = Story.buildStructuredPrompt(story);
    assert.match(prompt, /【角色1】\n角色名称：林澈\n特殊暗号：写着“（未填写）”的纸条。/);
    assert.match(prompt, /【角色2】\n角色名称：角色2/);
    assert.doesNotMatch(prompt, /角色外貌：|角色性格：/);
    assert.deepEqual(story, before);
});

test('没有记忆模块时，成对提示词构建保持原有兼容输出', () => {
    const source = { name: '林澈', surfacePrompt: '认真回应。' };
    const args = [source, '固定约束', { naturalStyle: true }, '自然表达', null, '独立文风'];
    const request = Story.buildRequestPrompts(...args);
    assert.equal(request.systemPrompt, Story.buildSystemPrompt(...args));
    assert.equal(request.turnReminder, Story.buildTurnReminder(...args));
});

test('剧情固定前缀不随世界书召回变化，完整非空自定义提示仍保留一次', () => {
    const StyleLab = require('../www/style-lab.js');
    const story = Story.createAgent({
        characters: [{ fields: [{ label: '角色名称', value: '夏遥' }, { label: '说话习惯', value: '慢一些，认真听人说完。' }] }],
        stylePrompt: '自定义克制文风原文', styleExamples: '用户完整风格示例原文',
        worldBook: { initialEntries: [{ fields: [{ label: '地点', value: '旧车站已封闭' }], activationMode: 'keywords', keywords: ['车站'] }] },
    }, Memory);
    const influence = StyleLab.buildInfluencePrompt(StyleLab.createAppliedStyle(StyleLab.createProfile({ strength: 100,
        analysis: { factors: [{ name: '克制', instruction: '留下合理的省略' }] },
    })));
    story.conversations = [{ role: 'user', content: '去车站' }];
    const first = Story.buildRequestPrompts(story, '用户完整全局规则', {}, '用户全局表达原文', Memory, influence);
    story.conversations.push({ role: 'user', content: '吃午饭' });
    const next = Story.buildRequestPrompts(story, '用户完整全局规则', {}, '用户全局表达原文', Memory, influence);
    assert.equal(first.stableSystemPrompt, next.stableSystemPrompt);
    assert.match(first.dynamicPrompt, /旧车站已封闭/);
    assert.doesNotMatch(next.dynamicPrompt, /旧车站已封闭/);
    for (const text of ['自定义克制文风原文', '用户完整风格示例原文', '用户完整全局规则', '用户全局表达原文', '慢一些，认真听人说完。']) {
        assert.equal(first.systemPrompt.split(text).length - 1, 1, text);
        assert.doesNotMatch(first.turnReminder, new RegExp(text));
    }
    assert.match(first.stableSystemPrompt, /表达层冲突处理/);
});

test('关闭因子恢复默认表达，而高强度不并列强制默认轻快风格', () => {
    const StyleLab = require('../www/style-lab.js');
    const story = Story.createAgent({}, Memory);
    const applied = StyleLab.createAppliedStyle(StyleLab.createProfile({ strength: 100, analysis: { factors: [{ name: '肃静', instruction: '平静克制' }] } }));
    const on = Story.buildStructuredPrompt(story, StyleLab.buildInfluencePrompt(applied));
    const off = Story.buildStructuredPrompt(story, StyleLab.buildInfluencePrompt({ ...applied, strength: 0 }));
    assert.doesNotMatch(on, /整体接近日常轻小说或泡面番/);
    assert.match(off, /整体接近日常轻小说或泡面番/);
    assert.equal(off, Story.buildStructuredPrompt(story));
});

test('剧情新阅读与修订元数据跨标准化保存且不进入模型提示', () => {
    const source = { chapters: [{ id: 'c', title: '篇章私有标记', messageIndex: 2 }], readingPosition: { index: 3 }, revisionHistory: [{ name: '修订私有标记', data: { x: 1 } }] };
    const normalized = Story.normalizeAgent(source, Memory);
    assert.deepEqual(normalized.chapters, source.chapters);
    assert.deepEqual(normalized.readingPosition, source.readingPosition);
    assert.deepEqual(normalized.revisionHistory, source.revisionHistory);
    assert.doesNotMatch(Story.buildStructuredPrompt(normalized), /篇章私有标记|修订私有标记/);
});
