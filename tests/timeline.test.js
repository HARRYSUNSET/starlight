const test = require('node:test');
const assert = require('node:assert/strict');
const Timeline = require('../www/timeline.js');
const Memory = require('../www/memory.js');

function equipment() {
    let events = Timeline.mergeEvents([], [{ subject: '银剑', attribute: '状态', after: '完好', before: '未持有' }], { startIndex: 10, endIndex: 12 });
    events = Timeline.mergeEvents(events, [{ subject: '银剑', attribute: '状态', before: '完好', after: '损坏' }], { startIndex: 20, endIndex: 22 });
    return Timeline.mergeEvents(events, [{ subject: '银剑', attribute: '状态', before: '损坏', after: '修复' }], { startIndex: 30, endIndex: 32 });
}

test('成长时间线保留全部事件，当时/当前按来源选择正确状态', () => {
    const events = equipment();
    assert.equal(events.length, 3);
    assert.equal(Timeline.selectEvents(events, { atMessageIndex: 5 }).length, 0);
    assert.deepEqual(Timeline.selectEvents(events, { atMessageIndex: 15 }).map(event => event.after), ['完好']);
    assert.deepEqual(Timeline.selectEvents(events, { atMessageIndex: 25 }).map(event => event.after), ['损坏']);
    assert.deepEqual(Timeline.selectEvents(events).map(event => event.after), ['修复']);
    assert.equal(Timeline.selectEvents(events, { mode: 'history' }).length, 3);
    assert.match(Timeline.buildTimelineContext(events, { atMessageIndex: 25 }), /损坏/);
    assert.doesNotMatch(Timeline.buildTimelineContext(events, { atMessageIndex: 25 }), /修复/);
});

test('事件发生和角色得知时间分别记录，公开旁白看不到私密状态', () => {
    const events = Timeline.mergeEvents([], [{ subject: '密室', attribute: '密码', after: '银杏', knowledgeScope: 'private', observedBy: ['alice', 'bob'], knownAt: { alice: 12, bob: 30 } }], { startIndex: 10, endIndex: 12 });
    assert.equal(Timeline.selectEvents(events).length, 0);
    assert.equal(Timeline.selectEvents(events, { characterId: 'stranger' }).length, 0);
    assert.equal(Timeline.selectEvents(events, { characterId: 'alice', atMessageIndex: 20 }).length, 1);
    assert.equal(Timeline.selectEvents(events, { characterId: 'bob', atMessageIndex: 20 }).length, 0);
    assert.equal(Timeline.selectEvents(events, { characterId: 'bob', atMessageIndex: 30 }).length, 1);
});

test('失效的最新状态不会使旧状态复活，明确过期点之前仍可回忆', () => {
    const events = equipment();
    events[2].status = 'expired';
    events[2].validUntilIndex = 40;
    assert.equal(Timeline.selectEvents(events).length, 0);
    assert.deepEqual(Timeline.selectEvents(events, { atMessageIndex: 35 }).map(event => event.after), ['修复']);
    assert.equal(Timeline.selectEvents(events, { atMessageIndex: 40 }).length, 0);
});

test('撤回/重新生成失效被删除消息的事件，先前真实状态可继续使用', () => {
    const events = Timeline.invalidateFromIndex(equipment(), 20);
    assert.equal(events.length, 3);
    assert.equal(events.filter(event => event.invalidated).length, 2);
    assert.deepEqual(Timeline.selectEvents(events).map(event => event.after), ['完好']);
    assert.deepEqual(Timeline.selectEvents(events, { atMessageIndex: 40 }).map(event => event.after), ['完好']);
    assert.equal(Timeline.selectEvents(events, { mode: 'history' }).length, 1);
});

test('同一来源重复整理不复制事件，锁定历史不会被重写', () => {
    const events = equipment();
    events[0].locked = true;
    const merged = Timeline.mergeEvents(events, [
        { ...events[0], after: '自动整理误改' },
        { ...events[1], id: 'new-summary-id' },
    ]);
    assert.equal(merged.length, 3);
    assert.equal(merged[0].after, '完好');
});

test('当前状态已被替代时，不在事实区重复注入同属性旧状态', () => {
    const memory = Memory.normalizeMemory({ facts: [
        { id: 'a', subject: '银剑', attribute: '状态', after: '完好', text: '银剑完好无损', sourceStartIndex: 10, sourceEndIndex: 12 },
        { id: 'b', subject: '银剑', attribute: '状态', after: '损坏', text: '银剑已被损坏', sourceStartIndex: 20, sourceEndIndex: 22 },
    ] });
    const current = Memory.buildMemoryContext(memory, '银剑');
    assert.match(current, /损坏/);
    assert.doesNotMatch(current, /完好无损/);
    const past = Memory.buildMemoryContext(memory, '银剑', {}, { atMessageIndex: 15 });
    assert.match(past, /完好/);
    assert.doesNotMatch(past, /损坏/);
});
