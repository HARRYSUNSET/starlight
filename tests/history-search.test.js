const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Search = require('../www/history-search.js');

const speaker = message => message.role === 'user' ? '你' : message.speaker;

test('历史查找同时支持内容、角色、编号及跨分隔符的组合查询', () => {
    const messages = [
        { role: 'assistant', speaker: 'ALICE', content: 'Welcome Home' },
        { role: 'user', content: '晚饭一起去吃吗？' },
        { role: 'assistant', speaker: '林澈', content: '好呀。' },
    ];
    for (const [query, indices] of [
        ['welcome', [0]], ['  ALICE #1 WELCOME  ', [0]], ['你 #2 晚饭', [1]],
        ['#2 晚饭一起', [1]], ['林澈 #3 好呀', [2]], ['#3', [2]], ['missing', []],
    ]) {
        const result = Search.search(messages, { query, getSpeakerLabel: speaker });
        assert.deepEqual(result.entries.map(entry => entry.index), indices, query);
        assert.equal(result.matchedCount, indices.length, query);
        for (const entry of result.entries) assert.equal(entry.message, messages[entry.index]);
    }
});

test('默认打开仅访问末尾 300 条，原始消息索引与全量数量保持正确', () => {
    const messages = new Array(10000);
    for (let index = 0; index < 9700; index += 1) {
        Object.defineProperty(messages, index, { get() { throw new Error('不应读取更早消息'); } });
    }
    let reads = 0;
    for (let index = 9700; index < messages.length; index += 1) {
        const message = { content: `消息 ${index}` };
        Object.defineProperty(messages, index, { get() { reads += 1; return message; } });
    }
    const result = Search.search(messages, {
        query: ' \n ', getSpeakerLabel() { throw new Error('空查询无需生成角色标签'); },
    });
    assert.equal(result.matchedCount, 10000);
    assert.equal(result.entries.length, 300);
    assert.equal(result.entries[0].index, 9700);
    assert.equal(result.entries.at(-1).index, 9999);
    assert.equal(reads, 300);
});

test('搜索遍历一次得到完整计数，只保留最近 500 条并按正序返回', () => {
    let reads = 0;
    const messages = Array.from({ length: 1200 }, (_, index) => ({
        get content() { reads += 1; return index % 2 ? '匹配内容' : '另一段'; },
    }));
    const result = Search.search(messages, { query: '匹配内容' });
    assert.equal(result.matchedCount, 600);
    assert.equal(result.entries.length, 500);
    assert.equal(result.entries[0].index, 201);
    assert.equal(result.entries.at(-1).index, 1199);
    assert.equal(reads, 1200);
    assert.ok(result.entries.every((entry, index) => index === 0 || entry.index > result.entries[index - 1].index));
});

test('收藏与全文筛选组合时只接受 true，并精确统计超过显示上限的匹配', () => {
    const messages = Array.from({ length: 1100 }, (_, index) => ({
        bookmarked: index % 2 === 0,
        content: index % 3 === 0 ? '钥匙' : '地图',
    }));
    messages.push({ bookmarked: 1, content: '钥匙' }, { bookmarked: 'true', content: '钥匙' });
    const bookmarks = Search.search(messages, { bookmarkedOnly: true });
    assert.equal(bookmarks.matchedCount, 550);
    assert.equal(bookmarks.entries.length, 500);
    assert.equal(bookmarks.entries[0].index, 100);
    assert.equal(bookmarks.entries.at(-1).index, 1098);
    const result = Search.search(messages, { query: '钥匙', bookmarkedOnly: true, limit: 3 });
    assert.equal(result.matchedCount, 184);
    assert.deepEqual(result.entries.map(entry => entry.index), [1086, 1092, 1098]);
});

test('收藏筛选不读取正文，全文组合查询跳过未收藏的正文和角色', () => {
    const messages = [
        { bookmarked: false, get content() { throw new Error('无需读取未收藏正文'); } },
        { bookmarked: true, content: '关键事件', speaker: '角色' },
    ];
    assert.equal(Search.search(messages, { bookmarkedOnly: true }).matchedCount, 1);
    let speakerCalls = 0;
    const result = Search.search(messages, {
        bookmarkedOnly: true, query: '角色 #2 关键',
        getSpeakerLabel(message) { speakerCalls += 1; return message.speaker; },
    });
    assert.equal(result.matchedCount, 1);
    assert.equal(speakerCalls, 1);
});

test('显示上限可配置且零上限仍返回准确匹配数量', () => {
    const messages = Array.from({ length: 8 }, (_, index) => ({ content: `消息${index}`, bookmarked: true }));
    assert.deepEqual(Search.search(messages, { limit: 2 }).entries.map(entry => entry.index), [6, 7]);
    assert.deepEqual(Search.search(messages, { query: '消息', limit: 2 }).entries.map(entry => entry.index), [6, 7]);
    assert.deepEqual(Search.search(messages, { query: '消息', limit: 0 }), { entries: [], matchedCount: 8 });
    assert.deepEqual(Search.search(messages, { limit: 0 }), { entries: [], matchedCount: 8 });
    assert.equal(Search.search(messages, { limit: NaN }).entries.length, 8);
    assert.equal(Search.search(messages, { limit: 2.9 }).entries.length, 2);
    assert.deepEqual(Search.search(null), { entries: [], matchedCount: 0 });
});

test('消息内容和收藏修改立即生效，独立会话不会复用另一段历史', () => {
    const first = [{ id: 'same-id', speaker: '甲', content: '秘密钥匙', bookmarked: true }];
    const second = [{ id: 'same-id', speaker: '乙', content: '独立地图', bookmarked: false }];
    const options = { query: '钥匙', getSpeakerLabel: message => message.speaker };
    assert.equal(Search.search(first, options).matchedCount, 1);
    assert.equal(Search.search(second, options).matchedCount, 0);
    first[0].content = '秘密地图';
    assert.equal(Search.search(first, options).matchedCount, 0);
    first[0].bookmarked = false;
    assert.equal(Search.search(first, { bookmarkedOnly: true }).matchedCount, 0);
    Object.freeze(first[0]);
    Object.freeze(first);
    assert.equal(Search.search(first, { query: '地图' }).entries[0].message, first[0]);
});

test('浏览器脚本导出 StarlightHistorySearch，无需 CommonJS 环境', () => {
    const context = {};
    vm.runInNewContext(fs.readFileSync(require.resolve('../www/history-search.js'), 'utf8'), context);
    assert.equal(typeof context.StarlightHistorySearch.search, 'function');
    assert.equal(context.StarlightHistorySearch.search([{ content: 'hello' }], { query: 'hello' }).matchedCount, 1);
});
