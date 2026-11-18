const test = require('node:test');
const assert = require('node:assert/strict');
const WorldBook = require('../www/worldbook.js');
const {mergeDraft, decodeTextFile} = require('../www/worldbook-ui.js');

test('TXT 导入可读取 UTF-8、带字节序标记的 UTF-16 与 GBK 中文原文', () => {
    assert.equal(decodeTextFile(new TextEncoder().encode('中文')), '中文');
    assert.equal(decodeTextFile(Uint8Array.of(0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65)), '中文');
    assert.equal(decodeTextFile(Uint8Array.of(0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87)), '中文');
    assert.equal(decodeTextFile(Uint8Array.of(0xd6, 0xd0, 0xce, 0xc4)), '中文');
});

test('设定页保留同时到达的进展和后台任务状态，手改、手删与开关均按作者意愿保存', () => {
    const opening = WorldBook.normalizeWorldBook();
    for (let index = 0; index < 4; index++) opening.progressEntries.push(WorldBook.createEntry('progress'));
    const draft = structuredClone(opening), latest = structuredClone(opening);
    draft.progressEntries[0].fields[0].value = '手工订正';
    draft.progressEntries.splice(1, 1);
    draft.automation.enabled = true;
    const inserted = WorldBook.createEntry('progress');
    latest.progressEntries[2].fields[0].value = '来源标签已更新';
    latest.progressEntries.splice(3, 1, inserted);
    latest.automation.sources.push({ key: 'chapter', stamp: 'new', status: 'done' });

    const merged = mergeDraft(opening, draft, latest);
    assert.deepEqual(merged.progressEntries.map(entry => entry.id), [
        opening.progressEntries[0].id, opening.progressEntries[2].id, inserted.id,
    ]);
    assert.equal(merged.progressEntries[0].fields[0].value, '手工订正');
    assert.equal(merged.progressEntries[1].fields[0].value, '来源标签已更新');
    assert.deepEqual(merged.automation, { ...latest.automation, enabled: true });
    assert.equal(opening.progressEntries.length, 4);
});

test('新作品无需实时副本即可保存；建档预览加入的条目仍在草稿中', () => {
    const opening = WorldBook.normalizeWorldBook(), draft = structuredClone(opening);
    draft.initialEntries.push(WorldBook.createEntry());
    assert.equal(mergeDraft(null, draft, null), draft);
    assert.deepEqual(mergeDraft(opening, draft, opening).initialEntries, draft.initialEntries);
});
