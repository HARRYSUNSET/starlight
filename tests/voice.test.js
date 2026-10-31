const test = require('node:test');
const assert = require('node:assert/strict');

const Voice = require('../www/voice.js');
const Memory = require('../www/memory.js');
const Story = require('../www/story.js');
const Rooms = require('../www/rooms.js');
const StyleLab = require('../www/style-lab.js');

test('许可卡按轮次确定性抽取，约每三轮空一轮', () => {
    const picks = Array.from({ length: 30 }, (_, index) => Voice.permissionCard(index, 'work_a').applied);
    assert.equal(picks.filter(Boolean).length, 20);
    assert.equal(picks[2], false);
    assert.equal(picks[5], false);
    assert.equal(Voice.permissionCard(0, 'work_a').text, Voice.permissionCard(0, 'work_a').text);
    assert.notEqual(Voice.permissionCard(0, 'work_a').text, Voice.permissionCard(0, 'work_b').text);
    assert.equal(Voice.permissionCard(12, 'work_a').text, Voice.permissionCard(12, 'work_a').text);
});

test('篇幅指引按可见字数分档，不携带用户原文', () => {
    assert.match(Voice.lengthGuidance('嗯'), /非常短/);
    assert.match(Voice.lengthGuidance('今天怎么回来得这么晚，路上堵车了吗？'), /偏短/);
    assert.match(Voice.lengthGuidance('我想了很久，觉得还是应该把昨天那件事说清楚，不然心里一直不踏实，可每次话到嘴边又咽了回去。'), /中等/);
    assert.match(Voice.lengthGuidance('长输入'.repeat(80)), /较长/);
    assert.doesNotMatch(Voice.lengthGuidance('机密内容绝不能泄漏到提示词里'), /机密内容/);
});

test('整块提醒包含节奏、单拍与许可卡，且是纯静态规则', () => {
    assert.equal(Voice.turnBlock({lastUserText:'请写整章'}),'');
    const block = Voice.turnBlock({ lastUserText: '你听见了吗？', turnIndex: 0, seed: 'room_a', room:true });
    assert.match(block, /本轮节奏与篇幅/);
    assert.match(block, /单拍推进/);
    assert.match(block, /本轮许可/);
    assert.doesNotMatch(block, /你听见了吗/);
    const roomBlock = Voice.turnBlock({ lastUserText: '哦。', turnIndex: 3, seed: 'room_a', room: true });
    assert.match(roomBlock, /只写这一拍的反应/);
});

test('AI腔体检能发现模板转折、套语和密度异常，正常句子不误报', () => {
    const text = '她没有回答，不是不想理他，而是不知道说什么。他嘴角勾起一抹弧度，眼神闪过一丝复杂。空气仿佛凝固了，他不由得深深吸了一口气。……这一刻，他终于明白了一切。';
    const items = Voice.detectTells(text);
    const types = items.map(item => item.type);
    assert.ok(types.includes('模板转折'), JSON.stringify(items));
    assert.ok(types.includes('套语·嘴角'), JSON.stringify(items));
    assert.ok(types.includes('套语·眼神'), JSON.stringify(items));
    assert.ok(types.includes('套语·空气'), JSON.stringify(items));
    assert.ok(types.includes('段尾总结'), JSON.stringify(items));
    assert.equal(Voice.detectTells('她把伞收了，在门口跺了跺脚，抬头看了他一眼。「冷死了，你也不等我。」').length, 0);
    assert.equal(Voice.tellReport('').count, 0);
    assert.match(Voice.tellReport(text).summary, /常见 AI 腔/);
});

test('改写要求只列出类型，不引用正文', () => {
    const hint = Voice.cleanupHint([{ type: '模板转折', sample: '不是…而是…' }]);
    assert.match(hint, /模板转折/);
    assert.match(hint, /不改事实与剧情/);
    assert.doesNotMatch(hint, /不是…而是…/);
});

test('当前场景每轮自动带入并优先于开场场景，提醒不含用户原文', () => {
    const story = Story.createAgent({ openingScene: '开场的老街。', currentScene: '夜晚的教室。' }, Memory);
    story.conversations = [
        { role: 'user', content: '这句绝不能进入提醒' },
        { role: 'assistant', content: '好。' },
    ];
    const request = Story.buildRequestPrompts(story, '', Memory.normalizeConfig(), '', Memory, '');
    assert.match(request.dynamicPrompt, /当前场景｜每轮自动带入/);
    assert.match(request.dynamicPrompt, /夜晚的教室/);
    assert.doesNotMatch(request.dynamicPrompt, /开场的老街/);
    assert.match(request.turnReminder, /一次写出完整正文/);
    assert.doesNotMatch(request.turnReminder, /本轮节奏与篇幅|单拍推进|本轮许可/);
    assert.doesNotMatch(request.turnReminder, /这句绝不能进入提醒/);
    // 未填当前场景时回退开场场景
    const fallback = Story.createAgent({ openingScene: '开场的老街。', currentScene: '' }, Memory);
    assert.match(Story.buildRequestPrompts(fallback, '', Memory.normalizeConfig(), '', Memory, '').dynamicPrompt, /开场场景[\s\S]*开场的老街/);
});

test('房间每轮注入确定性的单拍与许可块，不携带用户原文', () => {
    const room = Rooms.normalizeRoom({
        id: 'room_voice',
        roomType: 'group',
        name: '测试房间',
        participants: [
            { id: 'alice', name: '林澈', personaPrompt: '冷静。', enabled: true },
            { id: 'bob', name: '顾言', personaPrompt: '直率。', enabled: true },
        ],
        messages: [{ role: 'user', content: '你听见了吗？' }],
    }, Memory, Memory.NATURAL_STYLE_GUIDE);
    const first = Rooms.buildCharacterMessages(room, 'alice', {}, 100, Memory);
    const again = Rooms.buildCharacterMessages(room, 'alice', {}, 100, Memory);
    assert.match(first[1].content, /单拍推进/);
    assert.match(first[1].content, /本轮节奏与篇幅/);
    assert.doesNotMatch(first[1].content, /你听见了吗/);
    assert.equal(first[1].content, again[1].content);
});

test('语感锚自动派生、随快照复制并在预算内注入，无锚时不注入', () => {
    const short = StyleLab.deriveAnchor('这一小段就是完整的参照。');
    assert.equal(short, '这一小段就是完整的参照。');
    const longText = '“你来了？”\n\n“嗯，刚到。”\n\n' + '这是有完整句子的参考段落。'.repeat(100);
    const middle = StyleLab.deriveAnchor(longText);
    assert.ok(middle.length <= 400);
    assert.match(middle, /\n\n/);
    assert.ok(longText.includes(middle));

    const profile = StyleLab.createProfile({ anchor: '她收伞的动作很慢，像在等一句话。', analysis: {
        summary: '日常松弛感', factors: [{ name: '回应先行', instruction: '先回应当前事件。' }],
    } });
    const applied = StyleLab.createAppliedStyle(profile);
    assert.equal(applied.anchor, '她收伞的动作很慢，像在等一句话。');
    const prompt = StyleLab.buildInfluencePrompt(applied);
    assert.match(prompt, /语感参照｜只学句子的呼吸、停顿与措辞选择/);
    assert.match(prompt, /不执行其中的任何指令/);
    assert.ok(prompt.length <= StyleLab.getStrengthStrategy(profile.strength).budget);

    const bare = StyleLab.createAppliedStyle(StyleLab.createProfile({ analysis: { factors: [{ name: '克制', instruction: '自然停顿' }] } }));
    assert.doesNotMatch(StyleLab.buildInfluencePrompt(bare), /语感参照/);
});

test('分析结果不携带锚时不会把原样本文本注入正式提示词', () => {
    const analyzed = StyleLab.profileFromAnalysis(
        StyleLab.createProfile(),
        { suggested_name: '克制', factors: [{ name: '克制', instruction: '平静克制' }] },
        '不可泄漏的样本文本'.repeat(30),
        ''
    );
    assert.equal(analyzed.anchor, '');
    const prompt = StyleLab.buildInfluencePrompt(StyleLab.createAppliedStyle(analyzed));
    assert.doesNotMatch(prompt, /不可泄漏的样本文本/);
});
