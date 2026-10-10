const test = require('node:test');
const assert = require('node:assert/strict');

const WorldBook = require('../www/worldbook.js');

test('旧世界观文本无损迁移到世界书且至少保留一个初始条目', () => {
    const book = WorldBook.normalizeWorldBook(null, '旧世界观的完整内容');
    assert.equal(book.initialEntries.length, 1);
    assert.match(WorldBook.entryText(book.initialEntries[0]), /旧世界观的完整内容/);
});

test('新增世界条目复制栏名顺序但不复制内容', () => {
    const first = WorldBook.createEntry('initial', ['名称', '规则', '势力']);
    first.fields.forEach((field, index) => field.value = `内容${index}`);
    const next = WorldBook.cloneEntrySchema(first, 'initial');
    assert.deepEqual(next.fields.map(field => field.label), ['名称', '规则', '势力']);
    assert.deepEqual(next.fields.map(field => field.value), ['', '', '']);
});

test('关键词、状态和角色知识范围共同控制世界书注入', () => {
    const publicEntry = WorldBook.createEntry('initial', ['规则']);
    publicEntry.fields[0].value = '公开规则';
    const privateEntry = WorldBook.createEntry('progress', ['秘密']);
    privateEntry.fields[0].value = '只有角色甲知道';
    privateEntry.knowledgeScope = 'private';
    privateEntry.characterIds = ['a'];
    privateEntry.activationMode = 'keywords';
    privateEntry.keywords = ['钥匙'];
    const book = WorldBook.normalizeWorldBook({ initialEntries: [publicEntry], progressEntries: [privateEntry] });
    assert.doesNotMatch(WorldBook.buildWorldBookPrompt(book, '钥匙', { characterId: 'b' }), /只有角色甲知道/);
    assert.match(WorldBook.buildWorldBookPrompt(book, '钥匙', { characterId: 'a' }), /只有角色甲知道/);
    assert.doesNotMatch(WorldBook.buildWorldBookPrompt(book, '别的话题', { characterId: 'a' }), /只有角色甲知道/);
});
