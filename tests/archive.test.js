const test = require('node:test');
const assert = require('node:assert/strict');
const Archive = require('../www/archive.js');

const image = 'data:image/png;base64,YWJj';
function state() {
    return {
        apiKey: 'local-secret', apiKeys: { deepseek: 'local-secret' }, storyGlobalPrompt: '本机设定',
        agents: [{ id: 's1', name: '旧站', avatar: image, characters: [{ id: 'c1', fields: [{ label: '姓名', value: '小雨' }] }], worldBook: { initial: [{ title: '背景' }], progress: [] }, conversations: [{ role: 'user', content: '走进车站' }], memory: { core: '核心', facts: [{ id: 'f1', content: '留下钥匙' }], segments: [] }, styleInfluence: { sourceProfileId: 'style1', name: '轻松', analysis: { factors: [{ name: '对白', instruction: '顺口' }] } } }],
        rooms: [{ id: 'r1', name: '茶室', participants: [{ id: 'p1', name: '阿云', avatar: image }], messages: [{ role: 'system', content: '开场' }], sharedMemory: { facts: [] }, characterMemories: { p1: { facts: [{ content: '私密往事' }] } } }],
        styleProfiles: [{ id: 'style1', name: '轻松', sourceText: '样本', previewText: '独立预览' }],
        commonSnippets: ['继续'], currentAgentId: 's1', currentRoomId: 'r1', activeMode: 'story',
    };
}

test('完整备份保留两种作品、公共私密记忆、图片和文风，移除所有密钥字段', () => {
    const source = state();
    source.agents[0].nested = { apiKey: 'nested-secret' };
    const backup = Archive.createBackup(source);
    assert.equal(backup.format, 'starlight-backup');
    assert.equal(JSON.stringify(backup).includes('secret'), false);
    assert.equal(source.apiKey, 'local-secret');
    const restored = Archive.parseBackup(JSON.stringify(backup));
    assert.equal(restored.state.rooms[0].characterMemories.p1.facts[0].content, '私密往事');
    assert.equal(restored.state.agents[0].avatar, image);
    assert.equal(restored.state.styleProfiles[0].sourceText, '样本');
    const summary = Archive.summarizeBackup(restored);
    assert.deepEqual({ ...summary, bytes: 0 }, { stories: 1, rooms: 1, messages: 2, facts: 2, images: 1, styles: 1, bytes: 0 });
});

test('单作品导出只包含该作品及其文风来源，包括历史版本引用', () => {
    const source = state();
    source.styleProfiles.push({ id: 'historical', name: '旧风格' }, { id: 'unrelated', name: '别的' });
    source.agents[0].revisionHistory = [{ snapshot: { styleInfluence: { sourceProfileId: 'historical' } } }];
    const backup = Archive.createBackup(source, { mode: 'story', id: 's1' });
    assert.equal(backup.scope, 'story');
    assert.equal(backup.state.rooms.length, 0);
    assert.deepEqual(backup.state.styleProfiles.map(item => item.id), ['style1', 'historical']);
    assert.equal(backup.state.storyGlobalPrompt, undefined);
    assert.throws(() => Archive.createBackup(source, { mode: 'story', id: 'missing' }), /未找到/);
});

test('新增副本不修改源数据，修复冲突文风引用并保留当前密钥', () => {
    const current = state();
    const incoming = state();
    incoming.styleProfiles[0].sourceText = '不同内容';
    const backup = Archive.createBackup(incoming);
    const plan = Archive.planImport(current, backup);
    assert.equal(plan.state.apiKey, current.apiKey);
    assert.equal(current.agents.length, 1);
    assert.equal(plan.state.agents.length, 2);
    assert.notEqual(plan.state.agents[1].id, 's1');
    assert.notEqual(plan.state.rooms[1].id, 'r1');
    const profileId = plan.state.agents[1].styleInfluence.sourceProfileId;
    assert.notEqual(profileId, 'style1');
    assert.equal(plan.state.styleProfiles.find(item => item.id === profileId).sourceText, '不同内容');
    plan.state.agents[1].characters[0].fields[0].value = '小晴';
    assert.equal(backup.state.agents[0].characters[0].fields[0].value, '小雨');
});

test('替换仅允许同模式单作品，保留目标身份和其他作品，配置恢复需要显式启用', () => {
    const current = state();
    const incoming = state();
    incoming.agents[0].name = '新站';
    incoming.storyGlobalPrompt = '备份设定';
    const backup = Archive.createBackup(incoming, { mode: 'story', id: 's1' });
    const plan = Archive.planImport(current, backup, { strategy: 'replace', targetMode: 'story', targetId: 's1' });
    assert.equal(plan.state.agents.length, 2);
    assert.notEqual(plan.state.agents[1].id, current.agents[0].id);
    assert.deepEqual(plan.state.agents[1].conversations, current.agents[0].conversations);
    assert.match(plan.state.agents[1].name, /替换前备份/);
    assert.equal(plan.state.agents[0].id, 's1');
    assert.equal(plan.state.agents[0].name, '新站');
    assert.equal(current.agents[0].name, '旧站');
    assert.strictEqual(plan.state.rooms[0], current.rooms[0]);
    assert.throws(() => Archive.planImport(current, backup, { strategy: 'replace', targetMode: 'room', targetId: 'r1' }), /相同模式/);
    assert.throws(() => Archive.planImport(current, Archive.createBackup(incoming), { strategy: 'replace', targetMode: 'story', targetId: 's1' }), /一个作品/);
    const full = Archive.createBackup(incoming);
    assert.equal(Archive.planImport(current, full).state.storyGlobalPrompt, '本机设定');
    assert.equal(Archive.planImport(current, full, { restoreSettings: true }).state.storyGlobalPrompt, '备份设定');
});

test('已删除的文风来源不会误连到本机同名ID，应用快照仍完整保留', () => {
    const source = state();
    source.styleProfiles = [];
    const plan = Archive.planImport(state(), Archive.createBackup(source));
    assert.equal(plan.state.agents[1].styleInfluence.sourceProfileId, '');
    assert.equal(plan.state.agents[1].styleInfluence.analysis.factors[0].instruction, '顺口');
});

test('备份校验拒绝污染属性、可执行图片URL、错误结构、超限或伪造范围', () => {
    const backup = Archive.createBackup(state());
    assert.throws(() => Archive.parseBackup('{"format":"starlight-backup","__proto__":{"polluted":true}}'), /非法属性/);
    assert.equal({}.polluted, undefined);
    const badImage = structuredClone(backup);
    badImage.state.agents[0].avatar = 'javascript:alert(1)';
    assert.throws(() => Archive.validateBackup(badImage), /图片/);
    const badMessage = structuredClone(backup);
    badMessage.state.agents[0].conversations[0].content = {};
    assert.throws(() => Archive.validateBackup(badMessage), /消息/);
    assert.throws(() => Archive.parseBackup(JSON.stringify(backup), { maxBytes: 10 }), /大小/);
    assert.throws(() => Archive.validateBackup({ ...backup, scope: 'story' }), /范围不一致/);
    assert.throws(() => Archive.validateBackup({ ...backup, version: 999 }), /受支持/);
});

test('创作中的HTML文本保持原文作为纯数据，导入不得执行或改写它', () => {
    const source = state();
    source.agents[0].conversations[0].content = '<script>未执行的小说代码</script>';
    const restored = Archive.parseBackup(JSON.stringify(Archive.createBackup(source)));
    assert.equal(restored.state.agents[0].conversations[0].content, source.agents[0].conversations[0].content);
});

test('有限设定历史不复制消息图片，重复快照合并，恢复不会撤回新消息', () => {
    let work = state().agents[0];
    const messages = work.conversations;
    work = Archive.captureRevision(work, { mode: 'story', label: '第一次' });
    const firstId = work.revisionHistory[0].id;
    assert.equal(work.revisionHistory[0].snapshot.conversations, undefined);
    assert.equal(work.revisionHistory[0].snapshot.avatar, undefined);
    assert.equal(Archive.captureRevision(work, { mode: 'story' }).revisionHistory.length, 1);
    work.name = '改名';
    work.memory.facts.push({ content: '新事实' });
    work.conversations.push({ role: 'assistant', content: '继续剧情' });
    const restored = Archive.restoreRevision(work, firstId);
    assert.equal(restored.name, '旧站');
    assert.equal(restored.memory.facts.length, 1);
    assert.strictEqual(restored.conversations, messages);
    assert.equal(restored.conversations.length, 2);
    assert.equal(restored.avatar, image);
    for (let index = 0; index < 20; index += 1) { work.name = `版本${index}`; work = Archive.captureRevision(work, { mode: 'story' }); }
    assert.equal(work.revisionHistory.length, 12);
});

test('房间历史保留角色私密记忆，恢复仅复用相同角色图片', () => {
    let room = state().rooms[0];
    room = Archive.captureRevision(room, { mode: 'room' });
    assert.equal(room.revisionHistory[0].snapshot.participants[0].avatar, undefined);
    room.participants = [{ id: 'p2', name: '新人', avatar: 'data:image/png;base64,ZGVm' }];
    room.characterMemories = { p2: { facts: [] } };
    const restored = Archive.restoreRevision(room, room.revisionHistory[0].id);
    assert.equal(restored.participants[0].id, 'p1');
    assert.equal(restored.participants[0].avatar, undefined);
    assert.equal(restored.characterMemories.p1.facts[0].content, '私密往事');
});

test('正文同位置被改写后恢复设定不复活旧记忆；新增后续消息仍允许恢复原来源记忆',()=>{
    let work=Archive.captureRevision(state().agents[0],{mode:'story'});
    const revision=work.revisionHistory[0].id;
    work.conversations[0].content='已改写的事件';work.memory={core:'当前有效记忆',facts:[]};
    const restored=Archive.restoreRevision(work,revision);
    assert.equal(restored.memory.core,'当前有效记忆');
    assert.equal(restored.conversations[0].content,'已改写的事件');
});
