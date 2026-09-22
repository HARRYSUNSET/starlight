const test = require('node:test');
const assert = require('node:assert/strict');

const Memory = require('../www/memory.js');
const Rooms = require('../www/rooms.js');

function createGroupRoom() {
    return Rooms.normalizeRoom({
        id: 'room_test',
        roomType: 'group',
        name: '测试房间',
        participants: [
            { id: 'alice', name: '林澈', personaPrompt: '冷静。', enabled: true },
            { id: 'bob', name: '顾言', personaPrompt: '直率。', enabled: true },
        ],
        messages: [],
    }, Memory, Memory.NATURAL_STYLE_GUIDE);
}

test('角色输出清理会移除常见标签和重复姓名，但保留正文', () => {
    const raw = [
        '### 林澈',
        '【林澈】',
        '林澈：林澈： “回来了。”',
        '- 林澈',
        '林澈 林澈 林澈',
        '',
        '他把门轻轻合上。',
    ].join('\n');

    assert.equal(Rooms.cleanCharacterOutput(raw, '林澈'), '“回来了。”\n\n他把门轻轻合上。');
    assert.equal(Rooms.hasSubstantiveContent(Rooms.cleanCharacterOutput('### 林澈\n【林澈】\n林澈：', '林澈')), false);
    assert.equal(Rooms.hasSubstantiveContent('嗯。'), true);
});

test('只包含房间角色姓名的输出会判为空，称呼后的正文仍保留', () => {
    const room = createGroupRoom();
    assert.equal(Rooms.hasSubstantiveRoomContent(room, '林澈 顾言 林澈'), false);
    assert.equal(Rooms.hasSubstantiveRoomContent(room, '顾言，过来。'), true);
});

test('房间记忆转换保持与原消息一一对应', () => {
    const room = createGroupRoom();
    room.messages = [
        { role: 'user', content: '有人吗？' },
        { role: 'assistant', speakerId: 'alice', content: '### 林澈\n林澈：' },
        { role: 'system', content: '门外开始下雨。' },
        { role: 'assistant', speakerId: 'bob', content: '顾言：我在。' },
    ];

    const converted = Rooms.roomMessagesForMemory(room);
    assert.equal(converted.length, room.messages.length);
    assert.equal(converted[1].role, 'system');
    assert.match(converted[1].content, /忽略/);
    assert.deepEqual(converted[3], { role: 'assistant', content: '顾言的发言或行动：我在。' });
});

test('为单个角色构建历史时不会把其他角色伪装成当前助手', () => {
    const room = createGroupRoom();
    room.messages = [
        { role: 'user', content: '你们怎么看？' },
        { role: 'assistant', speakerId: 'alice', content: '先看看证据。' },
        { role: 'assistant', speakerId: 'bob', content: '我同意。' },
    ];

    const messages = Rooms.buildCharacterMessages(room, 'alice', {}, 100);
    assert.equal(messages[0].role, 'system');
    assert.deepEqual(messages[2], { role: 'assistant', content: '先看看证据。' });
    assert.equal(messages[3].role, 'user');
    assert.match(messages[3].content, /另一位角色“顾言”/);
    assert.doesNotMatch(messages[0].content, /通用模式/);
});

test('@点名优先匹配较长角色名，不会同时误选同名前缀角色', () => {
    const room = Rooms.normalizeRoom({
        roomType: 'group',
        participants: [
            { id: 'short', name: '小明', personaPrompt: '角色一' },
            { id: 'long', name: '小明月', personaPrompt: '角色二' },
        ],
    }, Memory, Memory.NATURAL_STYLE_GUIDE);

    assert.deepEqual(Rooms.detectMentionedMembers(room, '@小明月继续。').map(member => member.id), ['long']);
    assert.deepEqual(Rooms.detectMentionedMembers(room, '@小明 和 @小明月').map(member => member.id), ['short', 'long']);
});

test('亲密度变化始终受上下限和连续上涨保护', () => {
    const room = Rooms.normalizeRoom({
        roomType: 'double',
        participants: [{ id: 'only', name: '林澈', personaPrompt: '冷静。' }],
        intimacy: { value: 199, initialValue: 10, recentDeltas: [1, 1, 1, 1], nodes: [] },
    }, Memory, Memory.NATURAL_STYLE_GUIDE);

    const ordinary = Rooms.applyIntimacyResult(room, { delta: 2, significant: false, reason: '普通互动' });
    assert.equal(ordinary.delta, 0);
    const significant = Rooms.applyIntimacyResult(room, { delta: 2, significant: true, reason: '关键事件' });
    assert.equal(significant.newValue, 200);
});

test('长期记忆切块只在完整助手边界结束', () => {
    const conversations = [];
    for (let index = 0; index < 50; index += 1) {
        conversations.push({ role: 'user', content: `问题${index}` + '细节'.repeat(200) });
        conversations.push({ role: 'assistant', content: `回答${index}` + '内容'.repeat(200) });
    }
    const chunk = Memory.findSummaryChunk(conversations, Memory.createEmptyMemory(), {
        recentTokenBudget: 20000,
        minChunkTokens: 6000,
        maxChunkTokens: 12000,
    });

    assert.ok(chunk);
    assert.equal(chunk.startIndex, 0);
    assert.equal(chunk.messages.at(-1).role, 'assistant');
});

test('单条超长消息也不会让刚发生的两个往返立即进入摘要', () => {
    const conversations = [];
    for (let index = 0; index < 10; index += 1) {
        conversations.push({ role: 'user', content: `问题${index}` + '细节'.repeat(1200) });
        conversations.push({ role: 'assistant', content: `回答${index}` + '内容'.repeat(1200) });
    }
    conversations.push({ role: 'user', content: '请继续刚才的场景。' });
    const chunk = Memory.findSummaryChunk(conversations, Memory.createEmptyMemory(), {
        recentTokenBudget: 20000,
        minChunkTokens: 6000,
        maxChunkTokens: 12000,
    });

    assert.ok(chunk);
    assert.ok(chunk.endIndex <= conversations.length - 4);
    assert.equal(conversations.at(-1).content, '请继续刚才的场景。');
});

test('超长对话窗口按 token 预算保留最近内容而不依赖总消息数', () => {
    const conversations = [];
    for (let index = 0; index < 300; index += 1) {
        conversations.push({ role: index % 2 ? 'assistant' : 'user', content: `消息${index}` + '很长的内容'.repeat(160) });
    }
    const window = Memory.takeRecentMessages(conversations, 0, 12000, 1000);
    assert.ok(window.messages.length < conversations.length);
    assert.equal(window.messages.at(-1).content, conversations.at(-1).content);
    assert.ok(window.startIndex > 0);
});

test('长期记忆注入受独立预算控制并优先保留重要剧情', () => {
    const memory = Memory.createEmptyMemory();
    memory.core = '持续状态'.repeat(5000);
    memory.segments = Array.from({ length: 20 }, (_, index) => ({
        id: `segment_${index}`,
        startIndex: index * 10,
        endIndex: index * 10 + 9,
        title: `篇章${index}`,
        summary: `林澈与钥匙的事件${index}` + '剧情细节'.repeat(1200),
        keywords: ['林澈', '钥匙'],
        importance: index === 3 ? 5 : 2,
        createdAt: Date.now(),
    }));
    const context = Memory.buildMemoryContext(memory, '林澈的钥匙', Memory.normalizeConfig(), { tokenBudget: 5000 });
    assert.ok(Memory.estimateTokens(context) < 6200);
    assert.match(context, /持续状态与关键事实/);
    assert.match(context, /按当前话题召回/);
});

test('结构化角色成长设定和文风示例进入房间提示词', () => {
    const room = Rooms.normalizeRoom({
        roomType: 'double',
        worldPrompt: '现代海边小城',
        styleExamples: '她叼着面包冲下楼，含糊地说了声早。',
        otherInfo: '旧车站的储物柜仍未打开。',
        participants: [{
            id: 'heroine',
            name: '林澈',
            personaPrompt: '平时冷静。',
            growthNotes: '经历雨夜事件后，开始主动求助。',
            currentState: '刚跑完一段路，心情放松。',
            relationships: '开始信任用户。',
            knowledgeBoundary: '不知道储物柜密码。',
            dialogueExamples: '“等一下，我也去。”',
        }],
    }, Memory, Memory.NATURAL_STYLE_GUIDE);
    room.messages = [{ role: 'user', content: '走吧。' }];
    const prompt = Rooms.buildCharacterMessages(room, 'heroine', {}, 100, Memory)[0].content;
    assert.match(prompt, /成长与变化记录/);
    assert.match(prompt, /开始主动求助/);
    assert.match(prompt, /文风示例/);
    assert.match(prompt, /储物柜仍未打开/);
});

test('房间消息收藏状态在标准化后保留', () => {
    const room = Rooms.normalizeRoom({
        roomType: 'double',
        participants: [{ id: 'one', name: '林澈', personaPrompt: '冷静。' }],
        messages: [{ role: 'user', content: '记住这里。', bookmarked: true }],
    }, Memory, Memory.NATURAL_STYLE_GUIDE);
    assert.equal(room.messages[0].bookmarked, true);
});
