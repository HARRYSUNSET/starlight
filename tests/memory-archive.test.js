const test = require('node:test');

test('时间线最新状态已失效时，不从旧结构化事实复活同一状态',()=>{
    const memory={facts:[{id:'f',subject:'小夏',attribute:'装备',after:'银剑',text:'当前持有银剑',sourceStartIndex:0,sourceEndIndex:2}],timeline:[{id:'expired',subject:'小夏',attribute:'装备',after:'银剑',status:'expired',sourceStartIndex:3,sourceEndIndex:4,validUntilIndex:4}]};
    assert.doesNotMatch(Memory.buildMemoryContext(memory,'小夏 装备',{}),/当前持有银剑/);
    assert.match(Memory.buildMemoryContext(memory,'小夏 装备',{}, {atMessageIndex:3}),/当前持有银剑/);
});
const assert = require('node:assert/strict');
const Memory = require('../www/memory.js');
const Timeline = require('../www/timeline.js');

function fact(index, overrides = {}) {
    return Memory.createMemoryFact({ id: 'fact-' + index, text: '档案事实编号' + index, sourceStartIndex: index * 2,
        sourceEndIndex: index * 2 + 2, createdAt: index + 1, updatedAt: index + 1, ...overrides });
}

test('全部事实持续归档，超过 500 条后最早事实和手工编辑仍保留', () => {
    const existing = Array.from({ length: 620 }, (_, index) => fact(index));
    existing[0] = fact(0, { text: '第一章取得银钥匙', locked: true, importance: 5 });
    existing[1] = fact(1, { text: '用户修订的车站约定', userEdited: true });
    const before = JSON.stringify(existing);
    const merged = Memory.mergeMemoryFacts(existing, [
        { text: '第一章取得银钥匙', importance: 1 },
        { id: 'fact-1', text: '整理器不应覆盖用户修订' },
        { text: '新的装备' },
    ], { startIndex: 1240, endIndex: 1250 });
    assert.equal(merged.length, 621);
    assert.equal(merged[0].importance, 5);
    assert.equal(merged[1].text, '用户修订的车站约定');
    assert.equal(merged.at(-1).sourceEndIndex, 1250);
    assert.equal(JSON.stringify(existing), before, '合并不修改传入数据');
});

test('重复整理使用索引去重，并保留第一次的确切来源和不同知识范围', () => {
    const original = fact(0, { text: '钥匙在旧站长手里', sourceStartIndex: 0, sourceEndIndex: 2 });
    const merged = Memory.mergeMemoryFacts([original], [
        { text: original.text }, { text: original.text },
        { text: original.text, knowledgeScope: 'private', observedBy: ['alice'] },
    ], { startIndex: 20, endIndex: 30 });
    assert.equal(merged.length, 2);
    assert.equal(merged[0].sourceEndIndex, 2);
    assert.equal(merged[1].knowledgeScope, 'private');
});

test('昵称召回早期钥匙伏笔，优先于无关的近期高重要性事实', () => {
    const memory = Memory.createEmptyMemory();
    memory.facts = Array.from({ length: 650 }, (_, index) => fact(index, { importance: 5, locked: index > 600 }));
    memory.facts[0] = fact(0, { subject: '林澈', aliases: ['小澈'], category: '伏笔目标', text: '林澈保留了车站的银钥匙，约好雨停后一起去开柜子。', importance: 2 });
    memory.segments = [
        { id: 'old-station', startIndex: 0, endIndex: 10, title: '车站约定', summary: '林澈与用户在车站约好雨停后开柜子。', keywords: ['林澈', '银钥匙'], importance: 2 },
        ...Array.from({ length: 12 }, (_, index) => ({ id: 'new-' + index, startIndex: 100 + index * 10, endIndex: 110 + index * 10, summary: '新的日常活动。', importance: 5 })),
    ];
    assert.equal(Memory.selectMemoryFacts(memory, '小澈还记得那个约定吗')[0].id, 'fact-0');
    const context = Memory.buildMemoryContext(memory, '小澈还记得那个约定吗', {}, { tokenBudget: 1200 });
    assert.match(context, /银钥匙/);
    assert.match(context, /车站约定/);
    assert.ok(Memory.estimateTokens(context) <= 1200);
});

test('核心、事实、往事各有预算，标题/来源/截断说明一起受总预算约束', () => {
    const memory = Memory.createEmptyMemory();
    memory.core = '当前持续状态'.repeat(5000);
    memory.facts = Array.from({ length: 1000 }, (_, index) => fact(index, { text: '钥匙' + '大量背景'.repeat(500) + index, locked: true }));
    memory.segments = [{ id: 'key', startIndex: 0, endIndex: 200, title: '钥匙的来源'.repeat(50), summary: '钥匙的来源是旧站长。' + '早年细节'.repeat(5000), keywords: ['钥匙'], importance: 5 }];
    for (const budget of [0, 40, 200, 600, 1800, 2000, 5000, 8000]) {
        const context = Memory.buildMemoryContext(memory, '钥匙', {}, { tokenBudget: budget });
        assert.ok(Memory.estimateTokens(context) <= budget, `${budget}: ${Memory.estimateTokens(context)}`);
        if (budget >= 1800) {
            assert.match(context, /持续状态与关键事实/);
            assert.match(context, /结构化事实/);
            assert.match(context, /按当前话题召回/);
        }
    }
});

test('公开、私密事实及昵称不会越过角色知识边界', () => {
    const memory = Memory.createEmptyMemory();
    memory.facts = [
        fact(0, { text: '公开：车站大门已经打开' }),
        fact(1, { text: '秘密：密码是银杏', knowledgeScope: 'private', observedBy: ['alice'], knownAt: { alice: 20 }, subject: '密码', aliases: ['小叶子'] }),
    ];
    for (const options of [{}, { characterId: 'bob' }, { characterId: 'alice', atMessageIndex: 10 }]) {
        const context = Memory.buildMemoryContext(memory, '小叶子', {}, { tokenBudget: 2000, ...options });
        assert.match(context, /车站大门已经打开/);
        assert.doesNotMatch(context, /银杏/);
    }
    assert.match(Memory.buildMemoryContext(memory, '密码', {}, { characterId: 'alice', atMessageIndex: 20 }), /银杏/);
});

test('回顾早期时不注入未来事实、当前核心、未来篇章和无来源手工状态', () => {
    const memory = Memory.createEmptyMemory();
    memory.core = '未来已经成为站长';
    memory.facts = [fact(0, { text: '早期不会开锁' }), fact(20, { text: '未来学会了开锁' }), { text: '没有来源的新设定' }];
    memory.segments = [{ id: 'future', startIndex: 20, endIndex: 30, summary: '未来车站改建了' }];
    memory.timeline = [Timeline.createEvent({ subject: '林澈', attribute: '职位', after: '未来站长' })];
    const context = Memory.buildMemoryContext(memory, '林澈', {}, { atMessageIndex: 10 });
    assert.match(context, /早期不会开锁/);
    assert.doesNotMatch(context, /未来|没有来源/);
});

test('撤回只失效受影响档案，重新摘要不会复活撤回剧情', () => {
    let memory = Memory.createEmptyMemory();
    memory.summarizedUntil = 20;
    memory.core = '银剑已经损坏';
    memory.facts = [fact(0, { text: '得到银剑', locked: true }), fact(6, { text: '银剑损坏', locked: true })];
    memory.segments = [
        { id: 'early', startIndex: 0, endIndex: 10, summary: '得到银剑' },
        { id: 'late', startIndex: 10, endIndex: 20, summary: '银剑损坏' },
    ];
    memory = Memory.mergeTimelineEvents(memory, [{ subject: '银剑', attribute: '状态', before: '完好', after: '损坏', locked: true }], { startIndex: 10, endIndex: 20 });
    const undone = Memory.invalidateMemoryFromIndex(memory, 12);
    assert.equal(undone.facts.length, 2, '失效档案保留可查看');
    assert.equal(undone.facts[0].status, 'active');
    assert.equal(undone.facts[1].invalidated, true, '来源被撤回时锁定也不能继续当真');
    assert.equal(undone.core, '');
    assert.equal(undone.summarizedUntil, 10);
    assert.equal(undone.timeline.length, 1);
    assert.doesNotMatch(Memory.buildMemoryContext(undone, '银剑'), /损坏/);
    assert.match(Memory.buildMemoryContext(undone, '银剑'), /得到银剑/);
    const normalized = Memory.normalizeMemory(Memory.normalizeMemory(undone, 12), 12);
    assert.equal(normalized.timeline.length, 1, '重复标准化不复制失效档案');
    const regenerated = Memory.mergeTimelineEvents(normalized, [{ subject: '银剑', attribute: '状态', after: '完好' }], { startIndex: 10, endIndex: 20 });
    assert.deepEqual(Timeline.selectEvents(regenerated.timeline).map(event => event.after), ['完好']);
});

test('标准化被缩短的对话不把来源强行钳到新长度，受影响记忆失效', () => {
    const memory = Memory.normalizeMemory({ summarizedUntil: 30, core: '未来内容', facts: [fact(10)], segments: [{ startIndex: 10, endIndex: 30, summary: '未来内容' }] }, 15);
    assert.equal(memory.segments[0].endIndex, 30);
    assert.equal(memory.segments[0].invalidated, true);
    assert.equal(memory.facts[0].invalidated, true);
    assert.equal(memory.core, '');
});

test('仅显式结构化事实迁移状态，旧自由文本不推断事件', () => {
    const memory = Memory.normalizeMemory({ version: 3, facts: [
        { id: 'plain', text: '林澈似乎终于可以使用魔法了' },
        { id: 'structured', text: '林澈学会照明术', subject: '林澈', attribute: '技能', before: '无', after: '照明术', sourceStartIndex: 10, sourceEndIndex: 20 },
    ] });
    assert.equal(memory.version, 4);
    assert.equal(memory.timeline.length, 1);
    assert.equal(memory.timeline[0].sourceFactId, 'structured');
    assert.equal(Memory.normalizeMemory(memory).timeline.length, 1);
});
