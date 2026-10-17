'use strict';

// Run: node scripts/benchmark-performance.js [baseline-git-ref]
// Fixtures are generated below; this script never reads saved conversations or calls an API.
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const Memory = require('../www/memory.js');
const Story = require('../www/story.js');
const WorldBook = require('../www/worldbook.js');
const HistorySearch = require('../www/history-search.js');

const repository = path.resolve(__dirname, '..');
const requestedRef = process.argv[2] || 'a367e5e';
const baselineRef = execFileSync('git', ['rev-parse', '--verify', `${requestedRef}^{commit}`], {
    cwd: repository, encoding: 'utf8',
}).trim();
const baselineContext = vm.createContext({});
const baselineModules = new Map();

function readBaseline(relativePath) {
    return execFileSync('git', ['show', `${baselineRef}:${relativePath}`], {
        cwd: repository, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
    });
}

function loadBaseline(relativePath) {
    const normalizedPath = path.posix.normalize(relativePath);
    if (!normalizedPath.startsWith('www/') || !normalizedPath.endsWith('.js')) {
        throw new Error(`Unsupported baseline module: ${normalizedPath}`);
    }
    if (baselineModules.has(normalizedPath)) return baselineModules.get(normalizedPath).exports;
    const module = { exports: {} };
    baselineModules.set(normalizedPath, module);
    const factory = vm.runInContext(`(function (module, exports, require) {\n${readBaseline(normalizedPath)}\n})`, baselineContext, {
        filename: `${baselineRef}:${normalizedPath}`,
    });
    factory(module, module.exports, dependency => {
        if (!dependency.startsWith('.')) throw new Error(`Baseline dependency must be local: ${dependency}`);
        let target = path.posix.join(path.posix.dirname(normalizedPath), dependency);
        if (!path.posix.extname(target)) target += '.js';
        return loadBaseline(target);
    });
    return module.exports;
}

const BeforeMemory = loadBaseline('www/memory.js');
const BeforeWorldBook = loadBaseline('www/worldbook.js');
const BeforeStory = loadBaseline('www/story.js');

function loadBaselineNavigatorSearch() {
    const html = readBaseline('www/index.html');
    const signature = /function renderConversationNavigator\(\)\s*\{/;
    const match = signature.exec(html);
    if (!match) throw new Error('Baseline navigator function was not found. Choose a compatible baseline ref.');
    const start = match.index + match[0].length;
    const end = html.indexOf('$navigatorSummary.textContent', start);
    if (end < 0) throw new Error('Baseline navigator search boundary was not found.');
    // Run the actual baseline selection code, excluding DOM rendering in both versions.
    const selection = html.slice(start, end);
    if (/HistorySearch\.search/.test(selection)) {
        baselineContext.HistorySearch = loadBaseline('www/history-search.js');
    }
    return vm.runInContext(`(function (input, options) {
        const getActiveMessages = () => input;
        const $navigatorSearchInput = { value: options.query || '' };
        const navigatorBookmarkedOnly = options.bookmarkedOnly === true;
        const getMessageSpeakerLabel = options.getSpeakerLabel;
        ${selection}
        return { entries, matchedCount };
    })`, baselineContext, { filename: `${baselineRef}:navigator-search` });
}

const BeforeSearch = loadBaselineNavigatorSearch();
const warmups = 4;
const samples = 21;

function median(values) {
    const sorted = values.slice().sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)];
}

function benchmark(name, fixture, before, after) {
    for (let index = 0; index < warmups; index += 1) { before(); after(); }
    const beforeTimes = [];
    const afterTimes = [];
    const measure = (operation, times) => {
        const start = performance.now();
        operation();
        times.push(performance.now() - start);
    };
    // Alternate order to reduce bias from warmup, GC and changing CPU frequency.
    for (let index = 0; index < samples; index += 1) {
        if (index % 2) { measure(after, afterTimes); measure(before, beforeTimes); }
        else { measure(before, beforeTimes); measure(after, afterTimes); }
    }
    return {
        task: name, fixture,
        beforeMedianMs: Number(median(beforeTimes).toFixed(4)),
        afterMedianMs: Number(median(afterTimes).toFixed(4)),
    };
}

function field(id, label, value) { return { id, label, value }; }

const world = {
    version: 1,
    initialEntries: [{
        id: 'benchmark-world', kind: 'initial', createdAt: 1, updatedAt: 1,
        fields: [
            field('world-name', '世界名称', '海边的小城'),
            field('world-era', '时代与环境', '现代校园，步行可以到达旧车站。'),
            field('world-rules', '核心规则', '沿用已经建立的现实生活规则。'),
        ],
    }],
    progressEntries: [],
};
const storyMessages = Array.from({ length: 20000 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `合成消息 ${index}：林澈与同学在放学后讨论旧车站的地图。`,
    createdAt: index + 1, bookmarked: index % 11 === 0,
}));
const story = {
    id: 'benchmark-story', name: '基准测试剧情', createdAt: 1, updatedAt: 1,
    worldBook: world,
    openingScene: '放学后的教室，两人准备收拾书包。',
    userPersona: '同班同学。',
    characters: [{
        id: 'benchmark-character',
        fields: [
            field('name', '角色名称', '林澈'),
            field('appearance', '角色外貌', '穿着整齐的校服，头发随意扎起。'),
            field('personality', '角色性格', '外向但会认真听朋友说话。'),
        ],
    }],
    conversations: storyMessages,
    memory: { version: 3, summarizedUntil: 0, core: '', facts: [], segments: [], updatedAt: 0 },
};
const promptSettings = { naturalStyle: true };
const globalPrompt = '遵循角色设定，保持故事连续，不替用户决定行为。';
const naturalStyle = '语言自然，回应当前情境，避免无来由的比喻。';
const styleInfluence = '【参考文风】允许简短的接话，细节来自具体生活。';
const promptArgs = [story, globalPrompt, promptSettings, naturalStyle];
const beforePrompts = () => ({
    systemPrompt: BeforeStory.buildSystemPrompt(...promptArgs, BeforeMemory, styleInfluence),
    turnReminder: BeforeStory.buildTurnReminder(...promptArgs, BeforeMemory, styleInfluence),
});
const afterPrompts = () => Story.buildRequestPrompts(...promptArgs, Memory, styleInfluence);
// v2.2 intentionally splits stable/dynamic sections and shortens duplicated
// reminders. Check retention of authored settings, not byte-identical templates.
for(const value of [globalPrompt,naturalStyle,story.openingScene,story.userPersona,...world.initialEntries[0].fields.map(f=>f.value),...story.characters[0].fields.map(f=>f.value)]) {
    assert.ok(beforePrompts().systemPrompt.includes(value));
    assert.ok(afterPrompts().systemPrompt.includes(value),'Authored setting missing: '+value);
}

const summaryMessages = Array.from({ length: 4000 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `合成消息 ${index}：` + '剧情内容与角色对话。'.repeat(150),
}));
const summaryMemory = { version: 3, summarizedUntil: 0, core: '', facts: [], segments: [], updatedAt: 0 };
const summaryConfig = { recentTokenBudget: 20000, minChunkTokens: 6000, maxChunkTokens: 12000 };
const beforeChunk = () => BeforeMemory.findSummaryChunk(summaryMessages, summaryMemory, summaryConfig);
const afterChunk = () => Memory.findSummaryChunk(summaryMessages, summaryMemory, summaryConfig);
assert.equal(JSON.stringify(afterChunk()), JSON.stringify(beforeChunk()), 'Summary selection must remain identical.');

const recallMemory = {
    ...summaryMemory,
    segments: Array.from({ length: 400 }, (_, index) => ({
        id: `segment-${index}`, startIndex: index * 10, endIndex: index * 10 + 10,
        summary: `合成篇章 ${index}：` + '角色讨论学校生活与天台的钥匙，随后决定到车站查看地图。'.repeat(15),
        keywords: ['学校', '天台', '钥匙'], importance: index % 5 + 1, createdAt: 1,
    })),
};
const recallQuery = '学校 天台 钥匙';
const recallConfig = { recentSegmentCount: 8, relevantSegmentCount: 10 };
const beforeRecall = () => BeforeMemory.selectMemorySegments(recallMemory, recallQuery, recallConfig);
const afterRecall = () => Memory.selectMemorySegments(recallMemory, recallQuery, recallConfig);
assert.equal(JSON.stringify(afterRecall().map(s=>s.id)), JSON.stringify(beforeRecall().map(s=>s.id)), 'Fixture recalled segment identities must remain identical.');

const navigatorMessages = Array.from({ length: 100000 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user', content: `合成消息 ${index}`, bookmarked: index % 5 === 0,
}));
const navigatorOptions = { query: '', bookmarkedOnly: false, getSpeakerLabel: message => message.role === 'user' ? '你' : '林澈' };
const beforeNavigator = () => BeforeSearch(navigatorMessages, navigatorOptions);
const afterNavigator = () => HistorySearch.search(navigatorMessages, navigatorOptions);
assert.equal(JSON.stringify(afterNavigator().entries), JSON.stringify(beforeNavigator().entries), 'Navigator entries and indexes must remain identical.');

console.log(`Baseline: ${baselineRef} (${requestedRef}); current: working tree`);
console.log(`Runtime: ${process.version} ${process.platform}/${process.arch}; warmups: ${warmups}; timed samples: ${samples}`);
console.log('本地合成数据、热缓存、中位耗时；不调用 API，不读取用户数据。');
console.log('仅衡量这些本地函数，不含 DOM 渲染、网络及模型生成；结果不代表手机或模型速度，也不设绝对速度断言。');
console.table([
    benchmark('剧情 system + reminder', `${storyMessages.length} 条消息；同参数、已填设定保留；模板有意调整`, beforePrompts, afterPrompts),
    benchmark('摘要切块', `${summaryMessages.length} 条消息，每条约 ${summaryMessages[0].content.length} 字符`, beforeChunk, afterChunk),
    benchmark('篇章召回', `${recallMemory.segments.length} 篇章，每篇约 ${recallMemory.segments[0].summary.length} 字符`, beforeRecall, afterRecall),
    benchmark('定位窗口空查询', `${navigatorMessages.length} 条消息，均返回最近 300 条（不含渲染）`, beforeNavigator, afterNavigator),
]);

const sparseWorld = {
    version: 1,
    initialEntries: Array.from({ length: 8 }, (_, index) => ({
        id: `sparse-world-${index}`, kind: 'initial', createdAt: index + 1, updatedAt: index + 1,
        fields: [
            field(`sparse-name-${index}`, '世界名称', index === 0 ? '海边的小城' : ''),
            field(`sparse-era-${index}`, '时代与环境', index === 0 ? '现代校园，步行可以到达旧车站。' : ''),
            field(`sparse-rule-${index}`, '核心规则', ''),
        ],
    })),
    progressEntries: [],
};
const sparseStory = { ...story, worldBook: sparseWorld };
const beforeWorldText = BeforeWorldBook.buildWorldBookPrompt(sparseWorld, '旧车站', { maxCharacters: 24000 });
const afterWorldText = WorldBook.buildWorldBookPrompt(sparseWorld, '旧车站', { maxCharacters: 24000 });
const sparseArgs = [sparseStory, globalPrompt, promptSettings, naturalStyle];
const beforeSparsePrompts = {
    systemPrompt: BeforeStory.buildSystemPrompt(...sparseArgs, BeforeMemory, styleInfluence),
    turnReminder: BeforeStory.buildTurnReminder(...sparseArgs, BeforeMemory, styleInfluence),
};
const afterSparsePrompts = Story.buildRequestPrompts(...sparseArgs, Memory, styleInfluence);
for (const entry of sparseWorld.initialEntries) {
    for (const item of entry.fields) {
        if (!item.value) continue;
        assert.ok(beforeWorldText.includes(item.value) && afterWorldText.includes(item.value), 'Populated worldbook values must survive omission.');
    }
}

function inputSize(task, beforeTexts, afterTexts) {
    const characters = texts => texts.reduce((sum, text) => sum + text.length, 0);
    const tokens = texts => Memory.estimateMessagesTokens(texts.map(content => ({ role: 'system', content })));
    const beforeTokens = tokens(beforeTexts);
    const afterTokens = tokens(afterTexts);
    return {
        task,
        beforeCharacters: characters(beforeTexts), afterCharacters: characters(afterTexts),
        beforeEstimatedTokens: beforeTokens, afterEstimatedTokens: afterTokens,
        estimatedReductionPercent: Number(((beforeTokens - afterTokens) / beforeTokens * 100).toFixed(1)),
    };
}

console.log('输入量样例：8 个世界书条目、每条 3 栏，只有 2 栏有内容；两版均保留所有已填写内容。');
console.log('字符数采用 JS string.length；两版 token 均用同一个本地估算器，计入消息开销，并非服务商真实计费或整次请求节省率。');
console.table([
    inputSize('世界书段落', [beforeWorldText], [afterWorldText]),
    inputSize('完整 system + reminder（仅这两段）', Object.values(beforeSparsePrompts), [afterSparsePrompts.systemPrompt,afterSparsePrompts.turnReminder]),
]);
console.log('通过：已填写设定保留检查；摘要块、召回来源和定位条目等价检查。文风指令有意调整，生成质量仍需实际使用评价。');
