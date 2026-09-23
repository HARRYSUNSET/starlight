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
    assert.equal(story.memory.version, 2);
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
