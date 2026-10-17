const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../www/persistence.js');

const image = 'data:image/png;base64,YWJj';
function fixture() {
    return { apiKey: 'local-key', agents: [{ id: 's', name: '剧情', avatar: image, draft: '', conversations: [{ role: 'user', content: '第一条' }, { role: 'assistant', content: '第二条' }], memory: { core: '核心', facts: [{ id: 'f', content: '事实' }], segments: [{ summary: '摘要' }] } }], rooms: [{ id: 'r', name: '房间', backgroundImage: image, participants: [{ id: 'p', avatar: image }], messages: [{ role: 'system', content: '旁白' }], sharedMemory: { facts: [] }, characterMemories: { p: { core: '私密', facts: [{ content: '秘密' }], segments: [] } } }], styleProfiles: [] };
}

test('记录拆分完整往返作品、消息、分层记忆及共享图片', () => {
    const source = fixture();
    const records = P.splitState(source);
    assert.equal(records.works.size, 2);
    assert.equal(records.messages.size, 3);
    assert.equal(records.assets.size, 1);
    assert.equal(records.memories.size, 6);
    assert.deepEqual(P.joinState(records), source);
    assert.equal(JSON.stringify([...records.works.values()]).includes('data:image'), false);
    assert.equal(JSON.stringify([...records.works.values()]).includes('秘密'), false);
});

test('只改草稿不重写消息、记忆和图片，追加消息仅新增一条记录', () => {
    const source = fixture();
    const old = P.signatures(P.splitState(source));
    source.agents[0].draft = '下一章';
    let diff = P.diffRecords(P.splitState(source), old);
    assert.equal(diff.works.puts.length, 1);
    for (const name of ['messages', 'memories', 'assets']) assert.equal(diff[name].puts.length, 0);
    source.agents[0].conversations.push({ role: 'user', content: '新消息' });
    diff = P.diffRecords(P.splitState(source), old);
    assert.equal(diff.messages.puts.length, 1);
    assert.equal(diff.messages.deletes.length, 0);
});

test('撤回及事实修改准确删除或更新相应记录', () => {
    const source = fixture();
    const old = P.signatures(P.splitState(source));
    source.agents[0].conversations.pop();
    source.agents[0].memory.facts[0].content = '纠正事实';
    const diff = P.diffRecords(P.splitState(source), old);
    assert.equal(diff.messages.deletes.length, 1);
    assert.equal(diff.messages.puts.length, 0);
    assert.equal(diff.memories.puts.length, 1);
    assert.equal(diff.assets.puts.length, 0);
});

test('删除作品清理其记录，仍被其他作品引用的图片继续保留', () => {
    const source = fixture();
    const old = P.signatures(P.splitState(source));
    source.agents = [];
    const records = P.splitState(source);
    const diff = P.diffRecords(records, old);
    assert.equal(diff.works.deletes.length, 1);
    assert.equal(diff.messages.deletes.length, 2);
    assert.equal(diff.assets.deletes.length, 0);
    source.rooms = [];
    assert.equal(P.diffRecords(P.splitState(source), old).assets.deletes.length, 1);
});

test('缺少任何一条历史、记忆或图片都拒绝加载，不假装成功', () => {
    for (const name of ['messages', 'memories', 'assets']) {
        const records = P.splitState(fixture());
        records[name].delete(records[name].keys().next().value);
        assert.throws(() => P.joinState(records), /缺失/);
    }
});

test('标识含分隔符仍无键冲突，同模式重复作品直接拒绝', () => {
    const source = fixture();
    source.agents[0].id = 'a:b["s"]';
    source.rooms[0].id = source.agents[0].id;
    assert.deepEqual(P.joinState(P.splitState(source)), source);
    source.agents.push(structuredClone(source.agents[0]));
    assert.throws(() => P.splitState(source), /重复作品/);
});
