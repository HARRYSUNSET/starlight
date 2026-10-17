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

test('未填写的世界书不占用请求内容，编辑器仍保留全部空栏位', () => {
    const book = WorldBook.normalizeWorldBook(null);
    const before = structuredClone(book);
    assert.equal(WorldBook.buildWorldBookPrompt(book), '');
    assert.deepEqual(book, before);
    assert.deepEqual(book.initialEntries[0].fields.map(field => field.label), ['世界名称', '时代与环境', '核心规则']);
    assert.match(WorldBook.entryText(book.initialEntries[0]), /核心规则：（未填写）/);
});

test('请求省略空栏及空条目，但保留非空自定义内容与原始世界书数据', () => {
    const entry = WorldBook.createEntry('initial', ['城镇', '空栏', '特别说明']);
    entry.fields[0].value = '青叶镇\n街道旁种着银杏。';
    entry.fields[1].value = ' \n\t ';
    entry.fields[2].value = '档案上的“（未填写）”是一个暗号。';
    const empty = WorldBook.createEntry('initial');
    const book = { initialEntries: [empty, entry], progressEntries: [WorldBook.createEntry('progress')] };
    const before = structuredClone(book);
    assert.equal(WorldBook.buildWorldBookPrompt(book),
        '【世界书｜初始世界设定】\n〔设定1〕\n城镇：青叶镇\n街道旁种着银杏。\n特别说明：档案上的“（未填写）”是一个暗号。');
    assert.deepEqual(book, before);
});

test('旧世界观迁移内容与编辑栏位不变，稀疏模板显著减少请求字符', () => {
    const book = WorldBook.normalizeWorldBook(null, '城镇里的魔法只能在雨天使用。');
    book.initialEntries.push(...Array.from({ length: 8 }, () => WorldBook.createEntry('initial')));
    const before = structuredClone(book);
    const oldPrompt = '【世界书｜初始世界设定】\n' + book.initialEntries
        .map((entry, index) => `〔设定${index + 1}〕\n${WorldBook.entryText(entry)}`).join('\n\n');
    const prompt = WorldBook.buildWorldBookPrompt(book);
    assert.match(prompt, /原有世界观背景：城镇里的魔法只能在雨天使用。/);
    assert.ok(prompt.length < oldPrompt.length * 0.2, `${oldPrompt.length} → ${prompt.length} 字符`);
    assert.deepEqual(book, before);
});

test('超长初始设定不能挤掉已确认进展，截断提示也计入预算', () => {
    const initial = WorldBook.createEntry('initial', ['设定']);
    initial.fields[0].value = '古老传说'.repeat(1000);
    const progress = WorldBook.createEntry('progress', ['近况']);
    progress.fields[0].value = '角色甲已经获得银色钥匙。';
    const book = { initialEntries: [initial], progressEntries: [progress] };
    const prompt = WorldBook.buildWorldBookPrompt(book, '', { maxCharacters: 1000 });
    assert.ok(prompt.length <= 1000);
    assert.match(prompt, /世界书本节已按本轮预算截断/);
    assert.match(prompt, /【世界书｜已经确认的后续进展】\n〔进展1〕\n近况：角色甲已经获得银色钥匙。/);
});

test('双方内容均超长时保留两节，公开请求不泄漏私密或失效进展', () => {
    const initial = WorldBook.createEntry('initial', ['公开世界']);
    initial.fields[0].value = '云城'.repeat(1000);
    const progress = WorldBook.createEntry('progress', ['公开近况']);
    progress.fields[0].value = '节庆'.repeat(1000);
    const secret = WorldBook.createEntry('progress', ['秘密']);
    secret.fields[0].value = '甲的秘密身份';
    secret.knowledgeScope = 'private';
    secret.characterIds = ['a'];
    secret.priority = 5;
    const expired = WorldBook.createEntry('progress', ['旧消息']);
    expired.fields[0].value = '过时传闻';
    expired.status = 'expired';
    const book = { initialEntries: [initial], progressEntries: [secret, expired, progress] };
    const before = structuredClone(book);
    for (const characterId of ['', 'b']) {
        const prompt = WorldBook.buildWorldBookPrompt(book, '', { characterId, maxCharacters: 1000 });
        assert.ok(prompt.length <= 1000);
        assert.match(prompt, /公开世界：云城/);
        assert.match(prompt, /公开近况：节庆/);
        assert.doesNotMatch(prompt, /甲的秘密身份|过时传闻/);
    }
    const allowedPrompt = WorldBook.buildWorldBookPrompt(book, '', { characterId: 'a', maxCharacters: 1000 });
    assert.match(allowedPrompt, /甲的秘密身份/);
    assert.doesNotMatch(allowedPrompt, /过时传闻/);
    assert.ok(allowedPrompt.length <= 1000);
    assert.deepEqual(book, before);
});
