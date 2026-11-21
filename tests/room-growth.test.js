const test = require('node:test');
const assert = require('node:assert/strict');
const AI = require('../www/worldbook-ai.js');
const Growth = require('../www/room-growth.js');
const Rooms = require('../www/rooms.js');
const Engine = require('../www/room-engine.js');
const Archive = require('../www/archive.js');

const change = '阿青学会了换灯芯。';
function fixture() {
    return Rooms.normalizeRoom({roomType:'group',
        participants:[{id:'a',name:'阿青',privateGoal:'只有阿青知道的打算。',growthNotes:'作者保留的成长。'},
            {id:'b',name:'阿白'}],
        messages:[{id:'u',turnId:'t',role:'user',kind:'dialogue',content:'我兑现了承诺，陪你修好灯。'},
            {id:'a1',turnId:'t',role:'assistant',speakerId:'a',kind:'message',content:change}]});
}
function fact(room, extra = {}) {
    const input = {mode:'room',kind:'progress',participants:room.participants,text:change};
    const result = AI.parseResult({entries:[{fields:[{label:'具体变化',value:change}],evidence:change,
        knowledgeScope:'public',characterIds:[],characterChanges:[{memberId:'a',section:'growth'},{memberId:'stranger',section:'state'}],...extra}]},input);
    room.worldBook = AI.applyEntries(room.worldBook,result,{kind:'progress',sourceKey:'room:t',sourceIndex:0,sourceEndIndex:1,sourceLabel:'房间记录 1–2'}).book;
    return room.worldBook.progressEntries.at(-1);
}
function event(room, delta, extra) {
    Engine.applyJudgements(room,'t',{judgements:[{memberId:'a',kind:'action',trust:delta,familiarity:0,affection:0,
        tag:'修灯',reason:'阿青更愿意与用户一起承担重要任务。',sources:[{id:'u',quote:'我兑现了承诺'}],...extra}]});
}
test('房间世界书识别成长主体，知情者与当事人分开，备份往返后保留 ID', () => {
    const room=fixture();
    const row=fact(room);
    assert.deepEqual(row.origin.characterChanges,[{memberId:'a',section:'growth'}]);
    const loaded=Rooms.normalizeRoom(JSON.parse(JSON.stringify(room)));
    const [a,b]=loaded.participants;
    a.name='灯塔管理员';
    assert.equal(Growth.records(loaded,a)[0].evidence,change);
    assert.deepEqual(Growth.records(loaded,b),[]);
    row.knowledgeScope='private';
    row.characterIds=['b'];
    assert.deepEqual(Growth.records(room,room.participants[0]),[]);
    assert.deepEqual(Growth.records(room,room.participants[1]),[]);
});
test('事件投影尊重启用、关键词、有效状态与正式记录，排除未采纳预览', () => {
    const room=fixture(), a=room.participants[0], entry=fact(room);
    entry.activationMode='keywords';entry.keywords=['灯芯'];
    assert.equal(Growth.prompt(room,a,'修灯泡'),'');
    assert.match(Growth.prompt(room,a,'灯芯呢？'),/换灯芯/);
    entry.status='replaced';
    assert.equal(Growth.prompt(room,a,'灯芯'),'');
    entry.status='active';entry.enabled=false;
    assert.equal(Growth.prompt(room,a,'灯芯'),'');
    entry.enabled=true;
    room.messages.pop();
    room.experience.sceneDraft={content:change};
    assert.deepEqual(Growth.records(room,a),[]);
});
test('人物发展编辑和移除局限于当前角色，原始设定与世界书不变，可恢复', () => {
    const room=fixture(), [a,b]=room.participants;
    const worldEntry=fact(room), row=Growth.records(room,a)[0];
    Growth.edit(a,row,{text:'更愿意独自检修灯塔。',section:'state'});
    const loaded=Rooms.normalizeRoom(JSON.parse(JSON.stringify(room)));
    const prompt=Rooms.buildCharacterPromptParts(loaded,loaded.participants[0]);
    assert.match(prompt.dynamicPrompt,/当前状态：更愿意独自检修灯塔。/);
    assert.match(prompt.stableSystemPrompt,/作者保留的成长。/);
    const other=Rooms.buildCharacterPromptParts(room,b);
    assert.doesNotMatch(other.stableSystemPrompt + other.dynamicPrompt,/更愿意独自检修|只有阿青知道/);
    assert.equal(worldEntry.fields[0].value,change);
    Growth.edit(a,row,{hidden:true});
    assert.equal(Growth.prompt(room,a,''),'');
    Growth.edit(a,row,{hidden:false});
    assert.match(Growth.prompt(room,a,''),/独自检修/);
    a.developmentEnabled=false;
    assert.equal(Growth.prompt(room,a,''),'');
    a.developmentEnabled=true;
    room.worldBook=AI.removeSource(room.worldBook,'room:t');
    assert.equal(Growth.prompt(room,a,''),'');
    assert.equal(a.privateGoal,'只有阿青知道的打算。');
});
test('重大关系变化进入当事人成长并显示原文，普通互动、作者校准及撤回排除', () => {
    const room=fixture(),[a,b]=room.participants;
    event(room,1);
    assert.deepEqual(Growth.records(room,a),[]);
    Engine.revertRelations(room,'t');
    event(room,1,{significant:true});
    const [row]=Growth.records(room,a);
    assert.equal(row.label,'关系档案');
    assert.equal(row.evidence,'我兑现了承诺');
    assert.deepEqual(Growth.records(room,b),[]);
    Growth.edit(a,row,{text:'一起完成了重要工作。'});
    Engine.revertRelations(room,'t');
    Engine.calibrate(room,a.id,{trust:15,policy:{}});
    assert.deepEqual(Growth.records(room,a),[]);
    assert.equal(room.experience.relations.a.trust,15);
});
test('旧世界书按原文与明确主体本地归档，旁观和同名歧义保持原状', () => {
    const room=fixture(),[a,b]=room.participants;
    const entry=fact(room);
    delete entry.origin.characterChanges;
    assert.equal(Growth.records(room,a).length,1);
    entry.fields[0].value='阿青看见阿白正在修灯。';
    assert.deepEqual(Growth.records(room,a),[]);
    entry.fields.push({label:'角色名称',value:'阿青'});
    assert.equal(Growth.records(room,a).length,1);
    b.name='阿青';
    assert.deepEqual(Growth.records(room,a),[]);
});

test('导入 3.0 房间与再次导出副本保留草稿、旧设定、开关与个人编辑', () => {
    const old = fixture();
    for (const member of old.participants) {
        delete member.developmentEdits;
        delete member.developmentEnabled;
    }
    old.draft='上次还没有发出的消息。';
    old.experience.sceneDraft=Engine.sceneCandidate(old,{narration:'未采纳场景。',state:{}},'作者预览指令',Engine.stamp(old));
    const validStamp=Engine.stamp(old);
    const staleParts=JSON.parse(validStamp);
    staleParts[1]--;
    old.experience.candidates=[{id:'valid',memberId:'a',raw:'待修回复。',stamp:validStamp},
        {id:'stale',memberId:'a',raw:'旧回复。',stamp:JSON.stringify(staleParts)}];
    old.experience.profileDrafts.a={baseline:'未提交的作者校准。'};
    function roundtrip(work, version) {
        const state={rooms:[work],agents:[],styleProfiles:[]};
        const exported=Archive.createBackup(state,{mode:'room',id:work.id,appVersion:version});
        const parsed=Archive.parseBackup(JSON.stringify(exported));
        const imported=Archive.planImport(state,parsed,{strategy:'copy'}).state.rooms.at(-1);
        return Rooms.normalizeRoom(imported);
    }
    const migrated=roundtrip(old,'3.0.0');
    assert.notEqual(migrated.id,old.id);
    assert.equal(migrated.participants[0].privateGoal,old.participants[0].privateGoal);
    assert.equal(migrated.participants[0].developmentEnabled,true);
    assert.deepEqual(migrated.participants[0].developmentEdits,[]);
    assert.equal(migrated.experience.sceneDraft.stamp,Engine.stamp(migrated));
    assert.equal(migrated.experience.candidates[0].stamp,Engine.stamp(migrated));
    assert.notEqual(migrated.experience.candidates[1].stamp,Engine.stamp(migrated));
    const copy=Rooms.normalizeRoom(JSON.parse(JSON.stringify(migrated)));
    Engine.acceptScene(copy,copy.experience.sceneDraft);
    assert.equal(copy.messages.at(-1).content,'未采纳场景。');
    const a=migrated.participants[0];
    fact(migrated);
    const row=Growth.records(migrated,a)[0];
    Growth.edit(a,row,{text:'校对过的人物补充。',section:'state',hidden:true});
    a.developmentEnabled=false;
    const restored=roundtrip(migrated,'3.1.0');
    const member=restored.participants[0];
    assert.equal(restored.draft,old.draft);
    assert.deepEqual(restored.experience.profileDrafts.a,old.experience.profileDrafts.a);
    assert.deepEqual({...restored.experience.sceneDraft,stamp:''},{...migrated.experience.sceneDraft,stamp:''});
    assert.equal(restored.experience.sceneDraft.stamp,Engine.stamp(restored));
    assert.equal(member.developmentEnabled,false);
    assert.deepEqual(member.developmentEdits,a.developmentEdits);
    assert.equal(Growth.prompt(restored,member,''),'');
    assert.equal(Growth.records(restored,member)[0].text,'校对过的人物补充。');
    assert.equal(restored.participants[1].developmentEnabled,true);
    const destination={rooms:[old],agents:[],styleProfiles:[]};
    const incoming=Archive.createBackup({rooms:[restored]},{mode:'room',id:restored.id});
    const replaced=Archive.planImport(destination,incoming,{strategy:'replace',targetMode:'room',targetId:old.id});
    const [target,recovery]=replaced.state.rooms.map(room => Rooms.normalizeRoom(room));
    assert.equal(target.id,old.id);
    assert.notEqual(recovery.id,old.id);
    for (const work of [target,recovery]) {
        assert.equal(work.experience.sceneDraft.stamp,Engine.stamp(work));
        assert.notEqual(work.experience.candidates[1].stamp,Engine.stamp(work));
    }
});

test('角色的私有投影及作者编辑不会外发给调度、公共旁白、关系核对、公共记忆或同房间另一角色', () => {
    const room=fixture(), [a,b]=room.participants;
    const entry=fact(room,{knowledgeScope:'private',characterIds:['a']});
    const secret='仅阿青的设定标记-308';
    const localOverride='仅作者修改的设定标记-406';
    entry.fields[0].value=secret;
    Growth.edit(a,Growth.records(room,a)[0],{text:localOverride});
    const own=JSON.stringify(Rooms.buildCharacterMessages(room,a.id,{}));
    assert.ok(own.includes(secret) && own.includes(localOverride));
    for (const request of [Rooms.buildDirectorMessages(room,'谁回应？'),Rooms.buildNarrationMessages(room,'场景'),
        Engine.buildJudgeMessages(room,'t'),Rooms.roomMessagesForMemory(room),Rooms.buildCharacterMessages(room,b.id,{}),
        AI.buildMessages({mode:'room',kind:'progress',text:'新事件。',book:room.worldBook,participants:room.participants})]) {
        assert.ok(!JSON.stringify(request).includes(secret));
        assert.ok(!JSON.stringify(request).includes(localOverride));
    }
});
