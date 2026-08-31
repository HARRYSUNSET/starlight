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
