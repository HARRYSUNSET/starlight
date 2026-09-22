const test = require('node:test');
const assert = require('node:assert/strict');

const Memory = require('../www/memory.js');
const Story = require('../www/story.js');

test('旧版通用智能体会无损迁移为剧情智能体', () => {
    const story = Story.normalizeAgent({
        id: 'legacy_agent',
        name: '林澈',
        surfacePrompt: '冷静，但会认真回应用户。',
        conversations: [
            { role: 'user', content: '记住雨夜。', bookmarked: true },
            { role: 'assistant', content: '好。' },
        ],
    }, Memory);

    assert.equal(story.id, 'legacy_agent');
    assert.equal(story.characterPrompt, '冷静，但会认真回应用户。');
    assert.equal(story.conversations.length, 2);
    assert.equal(story.conversations[0].bookmarked, true);
    assert.equal(story.memory.version, 2);
});

test('剧情提示词包含结构化人设、成长优先级和知识边界', () => {
    const story = Story.normalizeAgent({
        name: '林澈',
        worldPrompt: '现代海边小城。',
        openingScene: '雨后清晨的旧车站。',
        userPersona: '用户扮演旧友。',
        characterPrompt: '外冷内热，做事认真。',
        currentState: '刚结束长途旅行，有些疲惫。',
        growthNotes: '已经学会在困难时主动求助。',
        relationships: '信任用户，但还不习惯坦率表达。',
        knowledgeBoundary: '不知道储物柜密码。',
        speakingStyle: '短句，偶尔轻声吐槽。',
        dialogueExamples: '“你先别笑……我只是没睡醒。”',
        styleExamples: '她把伞一收，鞋尖在水洼边停了停。',
    }, Memory);
    const prompt = Story.buildSystemPrompt(
        story,
        '保持故事连续。',
        Memory.normalizeConfig(),
        Memory.NATURAL_STYLE_GUIDE,
        Memory
    );

    assert.match(prompt, /剧情模式固定规则/);
    assert.match(prompt, /成长与变化｜高于早期静态标签/);
    assert.match(prompt, /主动求助/);
    assert.match(prompt, /不知道储物柜密码/);
    assert.match(prompt, /文风示例/);
    assert.doesNotMatch(prompt, /亲密度判定|候选角色/);
});

test('剧情角色复制到房间时只生成一次性人物设定文本', () => {
    const story = Story.normalizeAgent({
        name: '林澈',
        characterPrompt: '沉静而敏锐。',
        currentState: '正在寻找遗失的钥匙。',
        growthNotes: '开始愿意相信别人。',
        knowledgeBoundary: '不知道车站已经停用。',
    }, Memory);
    const copied = Story.composePersonaForRoom(story);
    assert.match(copied, /沉静而敏锐/);
    assert.match(copied, /正在寻找遗失的钥匙/);
    assert.match(copied, /不知道车站已经停用/);
});
