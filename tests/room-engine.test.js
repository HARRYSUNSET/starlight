const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../www/room-engine.js');
const State=require('../www/room-state.js');
const Rooms=require('../www/rooms.js');
const Memory=require('../www/memory.js');
function room(input={}){return Rooms.normalizeRoom({id:'test-room',roomType:'double',scenePrompt:'午后的教室',participants:[{id:'a',name:'小夏',personaPrompt:'重视守约，不因一句夸奖就恋爱。'}],messages:[],...input},Memory);}
function turn(value,text,id){value.messages.push({id:id+'-u',turnId:id,role:'user',kind:'dialogue',content:text},{id:id+'-a',turnId:id,role:'assistant',kind:'message',speakerId:'a',content:'（点头）谢谢。'});}
function judgement(turnId,quote,extra={}){return {judgements:[{memberId:'a',sources:[{id:turnId+'-u',quote}],kind:'action',tag:'守约',familiarity:1,trust:2,affection:1,reason:'按先前约定归还物品',...extra}]};}

test('旧房间保留关系基线和事件描述，空缺维度与门槛等待校准',()=>{
    const value=room({intimacy:{value:180,initialValue:20,nodes:[{id:'old',value:100,description:'既有关系'}]},participants:[{id:'a',name:'小夏',relationships:'已是恋人'}]});
    const e=E.ensure(value);assert.equal(value.intimacy,undefined);assert.equal(e.relations.a.baseline,'已是恋人');assert.equal(e.relations.a.known,false);assert.equal(e.relationHistory.length,0);assert.deepEqual(value.relationshipEvents,[{id:'old',description:'既有关系',condition:'',thresholds:{}}]);assert.deepEqual(E.availableNodes(value),[]);
});
test('对话和情景草稿独立，切换模式不把要求变成正式消息',()=>{
    const value=room();E.setComposerValue(value,'对白草稿');E.ensure(value).mode='scene';E.setComposerValue(value,'推进到放学');assert.equal(E.composerValue(value),'推进到放学');E.ensure(value).mode='dialogue';assert.equal(E.composerValue(value),'对白草稿');assert.equal(value.messages.length,0);
});
test('预览只读、采纳才改变场景与正式历史，指令不冒充已发生事件',()=>{
    const value=room();const memory=JSON.stringify(value.sharedMemory),original=E.currentScenePrompt(value);
    const draft=E.sceneCandidate(value,{narration:'走廊的灯亮了。',state:{time:'傍晚',place:'教室',summary:'仍留在教室',presentIds:['a']}},'不要突然转场',E.stamp(value));
    assert.equal(value.messages.length,0);assert.equal(E.currentScenePrompt(value),original);assert.equal(JSON.stringify(value.sharedMemory),memory);
    E.acceptScene(value,draft);assert.equal(value.messages.length,1);assert.equal(value.messages[0].kind,'narration');assert.equal(value.messages[0].content,'走廊的灯亮了。');assert.ok(E.currentScenePrompt(value).includes('傍晚'));assert.equal(value.scenePrompt,'午后的教室');assert.equal(E.ensure(value).mode,'dialogue');assert.equal(JSON.stringify(value.sharedMemory),memory);
    const dispatch=Rooms.buildDirectorMessages(value,'继续刚才的话。').map(m=>m.content).join('\n');
    assert.ok(dispatch.includes('傍晚'),'发言选择使用已采纳的当前情景');
    assert.ok(!dispatch.includes('午后的教室'),'发言选择不再误用初始场景');
    assert.throws(()=>E.acceptScene(value,draft),/来源|变化/);
});
test('来源变更或未知角色会拒绝旧预览，旧正式场景不变',()=>{
    const value=room(),draft=E.sceneCandidate(value,{narration:'放学了。',state:{}},'',E.stamp(value));
    value.messages.push({id:'new',role:'user',content:'等等。'});assert.throws(()=>E.acceptScene(value,draft),/变化/);assert.equal(E.ensure(value).sceneHistory.length,0);
    assert.throws(()=>E.sceneCandidate(value,{narration:'新场景',state:{presentIds:['unknown']}},'',E.stamp(value)),/不存在/);
});

test('升级兼容旧房间的预览，后台整理不会让预览过期', () => {
    const value = room();
    const parts = JSON.parse(E.stamp(value));
    const legacyBook = JSON.parse(JSON.stringify(value.worldBook));
    delete legacyBook.automation;
    parts[7] = legacyBook;
    const oldStamp = JSON.stringify(parts);
    const preview = E.sceneCandidate(value, {narration:'电灯亮了。',state:{}}, '', oldStamp);
    E.ensure(value).sceneDraft = preview;
    const upgraded = Rooms.normalizeRoom(JSON.parse(JSON.stringify(value)), Memory);
    const candidate = E.ensure(upgraded).sceneDraft;
    assert.equal(candidate.stamp, E.stamp(upgraded));
    upgraded.worldBook.automation = {enabled:true, sources:[{key:'turn-1', stamp:'a', status:'done'}]};
    upgraded.worldBook.progressEntries.push({...upgraded.worldBook.initialEntries[0],kind:'progress',origin:{sourceKey:'turn-1'}});
    upgraded.worldBook.updatedAt++;
    assert.equal(candidate.stamp, E.stamp(upgraded));
    upgraded.worldBook.initialEntries[0].fields[0].value = '作者刚更改的设定';
    assert.throws(() => E.acceptScene(upgraded,candidate), /变化/);
});
test('撤回情景恢复上一场景并保留未采纳草稿供检查',()=>{
    const value=room(),before=E.currentScenePrompt(value),draft=E.sceneCandidate(value,{narration:'到了傍晚。',state:{time:'傍晚'}},'',E.stamp(value));
    E.acceptScene(value,draft);const t=value.messages.at(-1).turnId;E.ensure(value).sceneDraft={content:'新的未采纳预览'};E.revertTurn(value,t);value.messages=[];
    assert.equal(E.currentScenePrompt(value),before);assert.equal(E.ensure(value).sceneDraft.content,'新的未采纳预览');
});
test('对白仅渲染说话和可见神态，长对白不截断，心理描述留待修正',()=>{
    const parsed=E.parseDialogue(JSON.stringify({speech:'你好。',expression:'抬眼看你',privateThought:'隐藏资料'}));assert.equal(parsed.content,'（抬眼看你）你好。');
    assert.equal(E.parseDialogue({speech:'长对白'.repeat(50000),expression:''}).speech.length,150000);
    assert.throws(()=>E.parseDialogue({speech:'你好',expression:'心里想着其他事'}),/心理/);assert.throws(()=>E.parseDialogue('她心里觉得很开心。'),/格式/);
});
test('逐字 JSON 流不显示原始字段或内心，正确处理中文、转义和表情',()=>{
    const raw=JSON.stringify({expression:'眨眼',speech:'“好呀。”\n明天见 😀'});
    for(let i=0;i<raw.length;i++){const partial=E.partialDialogue(raw.slice(0,i));assert.ok(!partial.startsWith('{'));assert.ok(!partial.includes('"speech"'));}
    assert.equal(E.partialDialogue(raw),'（眨眼）“好呀。”\n明天见 😀');
});

test('房间动作将玩家标记渲染成第二人称，保留角色人称和直接对白',()=>{
    const expression='她看了阿岚一眼，把书放在【玩家】手边，窗外的灯映在【玩家】的杯沿';
    const speech='阿岚说你可以借走。';
    const raw=JSON.stringify({expression,speech});
    const expected='（她看了阿岚一眼，把书放在你手边，窗外的灯映在你的杯沿）'+speech;
    for(let i=0;i<raw.length;i++)assert.doesNotMatch(E.partialDialogue(raw.slice(0,i)),/【|玩家/);
    assert.equal(E.partialDialogue(raw),expected);
    assert.equal(E.parseDialogue(raw).content,expected);
    assert.equal(E.parseDialogue(raw).speech,speech);
    assert.equal(E.parseDialogue({expression:'她点点头，他在门口等着'}).expression,'她点点头，他在门口等着');
    assert.equal(E.parseDialogue({expression:'抬手【'}).content,'（抬手【）');
    assert.equal(E.partialDialogue('{"expression":"抬手【"}'),'（抬手【）');
});

test('角色可以只以简短动作回应，协议、流式展示和最终校验保持一致',()=>{
    const raw=JSON.stringify({speech:'',expression:'轻轻点头'});
    assert.equal(E.parseDialogue(raw).content,'（轻轻点头）');
    assert.equal(E.parseDialogue({speech:'嗯？'}).content,'嗯？');
    assert.equal(E.parseDialogue({expression:'轻轻点头'}).content,'（轻轻点头）');
    assert.equal(E.parseDialogue({speech:'🙂'}).content,'🙂');
    assert.throws(()=>E.parseDialogue({speech:3,expression:''}),/格式/);
    assert.equal(E.partialDialogue(raw),'（轻轻点头）');
    assert.equal(E.parseDialogue({speech:'',expression:'（轻轻点头）'}).content,'（轻轻点头）');
    assert.throws(()=>E.parseDialogue({speech:' ',expression:' '}),/均为空/);
    assert.throws(()=>E.parseDialogue({speech:'……',expression:'（）'}),/实际内容/);
    assert.throws(()=>E.parseDialogue({speech:'',expression:'心里想着胜利'}),/心理/);
    assert.equal(E.partialDialogue(JSON.stringify({speech:'',expression:'心里想着胜利'})),'');
});
test('关系非零判定必须有本轮真实用户来源，伪造及角色自我害羞不能充当证据',()=>{
    const value=room();turn(value,'（归还借来的书）','t1');const before=JSON.stringify(E.ensure(value).relations);
    assert.throws(()=>E.applyJudgements(value,'t1',judgement('t1','不在原文里')),/来源/);
    assert.throws(()=>E.applyJudgements(value,'t1',judgement('t1','点头',{sources:[{id:'t1-a',quote:'点头'}]})),/来源/);
    assert.equal(JSON.stringify(E.ensure(value).relations),before);assert.equal(E.ensure(value).relationHistory.length,0);
});
test('同轮不重复结算，重复事件换标签也不能反复刷分',()=>{
    const value=room(),quote='（归还借来的书）';turn(value,quote,'t1');E.applyJudgements(value,'t1',judgement('t1',quote));
    const before=E.ensure(value).relations.a.trust;assert.equal(E.applyJudgements(value,'t1',judgement('t1',quote)).duplicate,true);
    turn(value,quote,'t2');E.applyJudgements(value,'t2',judgement('t2',quote,{tag:'换个名字的还书事件'}));assert.equal(E.ensure(value).relations.a.trust,before);
});
test('寒暄、赞美和未兑现承诺不因模型误判就持续加分',()=>{
    for(const [quote,kind] of [['你好','action'],['明天一定归还','promise'],['你真棒','praise']]){const value=room();turn(value,quote,'t');E.applyJudgements(value,'t',judgement('t',quote,{kind}));assert.equal(E.ensure(value).relations.a.trust,0);assert.equal(E.ensure(value).relations.a.affection,0);}
});
test('各维度限速，事件要求已评估的数值门槛与选填的剧情条件',()=>{
    const value=room({relationshipEvents:[{id:'n',thresholds:{trust:4,affection:1},description:'愿意分享私事',condition:'归还借物'}]});
    turn(value,'（归还第一本书）','t1');E.applyJudgements(value,'t1',judgement('t1','归还第一本书',{trust:99,affection:99}));
    assert.equal(E.ensure(value).relations.a.trust,2);assert.equal(E.ensure(value).relations.a.affection,1);assert.equal(E.availableNodes(value).length,0);
    turn(value,'（归还第二本书）','t2');E.applyJudgements(value,'t2',judgement('t2','归还第二本书',{grantedNodes:['n']}));assert.equal(E.availableNodes(value)[0].id,'n');
});
test('多人只修改实际回应者的关系，缺失或重复角色判定不部分写入',()=>{
    const value=room({roomType:'group',participants:[{id:'a',name:'小夏'},{id:'b',name:'小秋'}]});turn(value,'遵守了约定','t');E.applyJudgements(value,'t',judgement('t','遵守了约定'));
    assert.equal(E.ensure(value).relations.a.trust,2);assert.equal(E.ensure(value).relations.b.trust,0);
    turn(value,'新的共同事件','t2');assert.throws(()=>E.applyJudgements(value,'t2',{judgements:[]}),/角色/);assert.equal(E.ensure(value).relations.a.trust,2);
});
test('撤回与重新生成撤销来源对应的关系，并保留后来的作者校准',()=>{
    const value=room(),quote='兑现先前承诺';turn(value,quote,'t');E.applyJudgements(value,'t',judgement('t',quote));assert.equal(E.ensure(value).relations.a.affection,1);
    E.revertRelations(value,'t');assert.equal(E.ensure(value).relations.a.affection,0);assert.equal(E.ensure(value).relations.a.trust,0);assert.equal(E.ensure(value).relationHistory.length,0);
    E.applyJudgements(value,'t',judgement('t',quote));E.calibrate(value,'a',{trust:60,policy:{baseline:'作者确认的旧友'}});E.revertRelations(value,'t');assert.equal(E.ensure(value).relations.a.trust,60);assert.equal(E.ensure(value).relations.a.baseline,'作者确认的旧友');assert.equal(E.ensure(value).relations.a.affection,0);
});
test('新数据归一化、备份往返不丢预览、规则或关系来源',()=>{
    const value=room(),quote='履行昨日约定';turn(value,quote,'t');E.applyJudgements(value,'t',judgement('t',quote));
    E.ensure(value).sceneDraft=E.sceneCandidate(value,{narration:'灯亮了。',state:{}},'推进一下',E.stamp(value));E.ensure(value).profileDrafts.a={policy:{preferences:'未保存的作者草稿'}};
    const next=Rooms.normalizeRoom(JSON.parse(JSON.stringify(value)),Memory);assert.equal(E.ensure(next).relationHistory.length,1);assert.equal(E.ensure(next).sceneDraft.content,'灯亮了。');assert.equal(E.ensure(next).profileDrafts.a.policy.preferences,'未保存的作者草稿');
});
test('草稿与后台关系不进入公开旁白，已采纳场景进入角色当前状态',()=>{
    const value=room();E.ensure(value).candidates=[{raw:'未采纳私密稿'}];E.ensure(value).relations.a.reason='后台判断原因';E.acceptScene(value,E.sceneCandidate(value,{narration:'走廊亮灯。',state:{time:'傍晚',place:'图书馆',summary:'来到图书馆'}},'',E.stamp(value)));
    const narrator=Rooms.buildNarrationMessages(value,'自然继续').map(m=>m.content).join('\n');assert.ok(!narrator.includes('未采纳私密稿'));assert.ok(!narrator.includes('后台判断原因'));
    const prompt=Rooms.buildCharacterMessages(value,'a',{},100,Memory).map(m=>m.content).join('\n');assert.ok(prompt.includes('图书馆'));assert.ok(prompt.includes('傍晚'));
});
test('采纳情景同步人物入场离场，撤回恢复名单且不覆盖后来的作者在场调整',()=>{
    const value=room({roomType:'group',participants:[{id:'a',name:'小夏',enabled:true},{id:'b',name:'小秋',enabled:false}]});
    E.acceptScene(value,E.sceneCandidate(value,{narration:'小秋来到教室，小夏先离开了。',state:{presentIds:['b']}},'',E.stamp(value)));
    assert.deepEqual(Rooms.getActiveMembers(value).map(m=>m.id),['b']);const turnId=value.messages.at(-1).turnId;
    E.revertTurn(value,turnId);assert.deepEqual(Rooms.getActiveMembers(value).map(m=>m.id),['a']);
    E.acceptScene(value,E.sceneCandidate(value,{narration:'小秋来了。',state:{presentIds:['a','b']}},'',E.stamp(value)));
    const next=value.messages.at(-1).turnId;value.participants[0].enabled=false;E.ensure(value).presenceEdits.a=1;E.ensure(value).scene.presentIds=['b'];
    E.revertTurn(value,next);assert.equal(value.participants[0].enabled,false);assert.ok(!E.ensure(value).scene.presentIds.includes('a'));
});
test('旧版已经结算的回合不因补判再增加一次分数',()=>{
    const value=room();turn(value,'旧版已核对的行动','old');value.turnEffects.old={intimacyDelta:1};
    const result=E.applyJudgements(value,'old',judgement('old','旧版已核对的行动'));assert.equal(result.legacy,true);assert.equal(E.ensure(value).relations.a.affection,0);
});

test('已知维度门槛均达标才开放事件，换剧情条件需要重新核对',()=>{
    const value=room({relationshipEvents:[
        {id:'known',description:'主动聊往事',thresholds:{trust:1,affection:0}},
        {id:'condition',description:'一起修书',thresholds:{trust:1},condition:'归还借物'},
    ]});
    E.calibrate(value,'a',{trust:1});
    assert.deepEqual(E.availableNodes(value),[]);
    turn(value,'按约归还借来的书','t');
    E.applyJudgements(value,'t',judgement('t','按约归还借来的书',{grantedNodes:['condition']}));
    assert.deepEqual(E.availableNodes(value).map(event=>event.id),['known','condition']);
    value.relationshipEvents[1].condition='一起完成另一项约定';
    assert.deepEqual(E.availableNodes(value).map(event=>event.id),['known']);
});

test('有实质新了解的对话只许可熟悉度增加，零分与实计原因都可回查',()=>{
    const value=room();
    E.calibrate(value,'a',{policy:{criteria:{familiarity:{increase:'在日常交谈中了解新习惯'}}}});
    const quote='我每天傍晚去河边散步';
    turn(value,quote,'new-info');
    assert.match(JSON.stringify(E.buildJudgeMessages(value,'new-info')),/在日常交谈中了解新习惯/);
    E.applyJudgements(value,'new-info',judgement('new-info',quote,{kind:'conversation',reasons:{familiarity:'首次了解日常习惯'}}));
    const audit=value.turnEffects['new-info'].relationshipAudit.records[0];
    assert.equal(audit.applied.familiarity,1);
    assert.equal(audit.requested.trust,2);
    assert.equal(audit.applied.trust,0);
    assert.equal(audit.causes.trust,'criteria');
    assert.equal(audit.reasons.familiarity,'首次了解日常习惯');
    turn(value,'好的','neutral');
    E.applyJudgements(value,'neutral',{judgements:[{memberId:'a',sources:[],familiarity:0,trust:0,affection:0}]});
    assert.equal(value.turnEffects.neutral.relationshipAudit.records[0].applied.affection,0);
    assert.equal(value.turnEffects.neutral.relationshipAudit.records[0].causes.affection,'steady');
});

function withState(config={},extra={}){
    return room({customStateEnabled:true,customStateSettings:{name:'紧张度',definition:'未知危险提高紧张，确认安全降低紧张。',
        initialValue:15,interval:3,points:4,...config},...extra});
}
const custom=value=>E.ensure(value).customState;
function scoredTurn(value,content,turnId){
    turn(value,content,turnId);
    for(const message of value.messages.slice(-2))E.recordStateMessage(value,message);
}
const change=(turnId,quote,delta)=>({delta,reason:'现场出现明确变化。',sourceId:turnId+'-u',quote});

test('自定义状态按正式消息分段累计，重新加载与撤回保留跨轮进度',()=>{
    const value=withState();
    scoredTurn(value,'查看窗外','one');
    E.recordStateMessage(value,{role:'system',kind:'control',turnId:'one'});
    assert.equal(custom(value).value,15);
    assert.equal(custom(value).remainder,2);
    const restored=room(JSON.parse(JSON.stringify(value)));
    scoredTurn(restored,'确认走廊安全','two');
    assert.equal(custom(restored).value,19);
    assert.equal(custom(restored).remainder,1);
    E.revertTurn(restored,'two');
    assert.equal(custom(restored).value,15);
    assert.equal(custom(restored).remainder,2);
});

test('剧情与三维独立核对，可凭本轮正文加减分并且只结算一次',()=>{
    const value=withState();
    scoredTurn(value,'门外突然传来巨响','danger');
    const prompt=E.buildJudgeMessages(value,'danger');
    assert.equal(JSON.parse(prompt[1].content).customStateContext.name,'紧张度');
    E.applyJudgements(value,'danger',{...judgement('danger','门外突然传来巨响'),customState:change('danger','突然传来巨响',3)});
    E.applyJudgements(value,'danger',{judgements:[],customState:change('danger','突然传来巨响',3)});
    assert.equal(custom(value).value,18);
    assert.equal(E.ensure(value).relations.a.trust,2);
    assert.equal(E.canRecheck(value,'danger'),false);
    scoredTurn(value,'调查后确认安全','safe');
    E.applyJudgements(value,'safe',{customState:change('safe','确认安全',-2)});
    assert.equal(custom(value).value,20);
    assert.equal(E.canRecheck(value,'safe'),true);
    assert.equal(custom(value).records.at(-1).quote,'确认安全');
});

test('拒绝伪造引文和越界分值，补判不重复累计消息或改动已核对的三维',()=>{
    const value=withState({interval:2,initialValue:99});
    scoredTurn(value,'窗外传来巨响','t');
    E.applyJudgements(value,'t',{...judgement('t','窗外传来巨响'),customState:change('t','从未出现',3)});
    E.applyJudgements(value,'t',{customState:change('t','窗外传来巨响',9)});
    assert.equal(custom(value).value,100);
    assert.equal(E.canRecheck(value,'t'),true);
    const cleared=change('t','窗外传来巨响',-2);
    E.applyJudgements(value,'t',{customState:cleared});
    assert.equal(custom(value).value,98);
    assert.equal(E.ensure(value).relations.a.trust,2);
    assert.equal(E.canRecheck(value,'t'),false);
});

test('情景预览不计分，采纳编辑后的正文才计一条并可核对剧情',()=>{
    const value=withState({interval:1,points:2});
    const draft=E.sceneCandidate(value,{narration:'雷声响了。',state:{time:'晚上'}},'',E.stamp(value));
    assert.equal(custom(value).records.length,0);
    draft.content='暴雨停了。';
    const sourceId=E.acceptScene(value,draft),turnId=E.latestReviewTurn(value);
    assert.equal(custom(value).value,17);
    assert.equal(E.canRecheck(value,turnId),true);
    E.applyJudgements(value,turnId,{customState:{sourceId,quote:'暴雨停了',reason:'环境平静下来',delta:-2}});
    assert.equal(custom(value).value,15);
    E.revertTurn(value,turnId);
    assert.equal(custom(value).records.length,0);
});

test('修改正文保留条数，撤销旧剧情分并重新核对；作者校准优先于早先回合',()=>{
    const value=withState({interval:2});
    scoredTurn(value,'听到响动','t');
    E.applyJudgements(value,'t',{...judgement('t','听到响动'),customState:change('t','听到响动',3)});
    E.revertRelations(value,'t');
    assert.equal(custom(value).value,19);
    assert.equal(custom(value).records.length,2);
    State.configure(value,E.ensure(value),true,value.customStateSettings,45);
    E.applyJudgements(value,'t',{...judgement('t','听到响动'),customState:change('t','听到响动',2)});
    assert.equal(custom(value).value,45);
    E.revertTurn(value,'t');
    assert.equal(custom(value).value,45);
});

test('旧第四项与门槛保留在归档，不自动启用或继承为自定义状态',()=>{
    const old=room({desireEnabled:true,desireSettings:{initialValue:20},experience:{desire:{value:99}},
        relationshipEvents:[{id:'old',description:'旧事件',thresholds:{desire:10}}]});
    assert.deepEqual(E.dimensions(old),['familiarity','trust','affection']);
    assert.equal(old.experience.desire.value,99);
    assert.doesNotMatch(JSON.stringify(Rooms.buildCharacterMessages(old,'a',{},100,Memory)),/自定义状态/);
    State.configure(old,E.ensure(old),true,State.settings({name:'警戒',definition:'对风险的注意程度',initialValue:20}));
    assert.equal(custom(old).value,20);
    assert.deepEqual(E.availableNodes(old),[]);
    old.relationshipEvents[0].thresholds={customState:10};
    assert.equal(E.availableNodes(old)[0].id,'old');
    const group=withState({}, {roomType:'group'});
    assert.equal(State.active(group),false);
    assert.equal(E.statePrompt(group),'');
});

test('仅重命名保留分数，改含义从初始值重新开始，关闭时暂停累加',()=>{
    const value=withState({interval:2});
    scoredTurn(value,'查看窗外','a');
    const config={...value.customStateSettings,name:'危险感'};
    State.configure(value,E.ensure(value),false,config);
    scoredTurn(value,'暂停期间的消息','b');
    State.configure(value,E.ensure(value),true,config);
    assert.equal(custom(value).value,19);
    assert.equal(State.canReview(value,E.ensure(value),'b'),false);
    State.configure(value,E.ensure(value),true,{...config,definition:'体力消耗程度',initialValue:30});
    assert.equal(custom(value).value,30);
    assert.equal(custom(value).records.length,0);
});

test('单房间备份保留自定义定义、累计余量与剧情依据',()=>{
    const Archive=require('../www/archive.js');
    const value=withState();
    scoredTurn(value,'发现门锁已被撬开','clue');
    E.applyJudgements(value,'clue',{...judgement('clue','门锁已被撬开'),customState:change('clue','门锁已被撬开',2)});
    const backup=Archive.createBackup({rooms:[value]},{mode:'room',id:value.id});
    const restored=room(Archive.parseBackup(JSON.stringify(backup)).state.rooms[0]);
    assert.deepEqual(restored.customStateSettings,value.customStateSettings);
    assert.equal(custom(restored).value,17);
    assert.equal(custom(restored).remainder,2);
    assert.equal(custom(restored).records.at(-1).quote,'门锁已被撬开');
});

const peakConfig={initialValue:100,near:'观察出口',peak:{
    reaction:'优先撤往安全区',conditions:['角色已退进安全区','安全区的门已经关上'],fallback:40,
}};
function peakTurn(value,id,{expression='',speech=''}={}){
    turn(value,'检查周边情况',id);
    const [player,reply]=value.messages.slice(-2);
    const experience=E.ensure(value);
    E.recordStateMessage(value,player);
    State.markCue(value,experience,id,State.turnSnapshot(value,experience,id));
    reply.dialogue=E.parseDialogue({expression,speech});
    reply.content=reply.dialogue.content;
    E.recordStateMessage(value,reply);
    return reply.id;
}
const finishPeak=(sourceId)=>({completed:true,reason:'角色已进入安全区，并把门关好。',conditions:[
    {id:1,sourceId,quote:'退进安全区'},{id:2,sourceId,quote:'把门关好'},
]});

test('规则首个匹配、未知关系不命中，同一轮和历史记录保留规则参数',()=>{
    const value=withState({interval:3,rules:[
        {name:'需要两项已知',thresholds:{trust:70,affection:0},interval:1,points:8},
        {name:'信任优先',thresholds:{trust:50},interval:2,points:4},
    ]});
    E.calibrate(value,'a',{trust:75});
    assert.equal(State.effective(value,E.ensure(value)).name,'信任优先');
    turn(value,'先观察','one');
    E.recordStateMessage(value,value.messages.at(-2));
    E.calibrate(value,'a',{affection:0});
    E.recordStateMessage(value,value.messages.at(-1));
    assert.equal(custom(value).value,19);
    scoredTurn(value,'换到新地点','two');
    assert.equal(custom(value).value,35);
    const restored=room(JSON.parse(JSON.stringify(value)));
    assert.equal(custom(restored).value,35);
    assert.equal(custom(restored).records[0].snapshot.rule.name,'信任优先');
});

test('临界向正文提供反应，回合中才到顶时只核对剧情分',()=>{
    const value=withState({...peakConfig,initialValue:99,interval:1,points:1});
    E.recordStateMessage(value,{role:'user',kind:'dialogue',turnId:'t'});
    const frozen=State.turnSnapshot(value,E.ensure(value),'t');
    assert.match(E.statePrompt(value,frozen),/观察出口/);
    assert.equal(frozen.stage,'near');
    peakTurn(value,'t',{expression:'她退进安全区并把门关好'});
    const context=State.judgeContext(value,E.ensure(value),'t');
    assert.equal(context.peakCheck,undefined);
    assert.equal(custom(value).value,100);
});

test('峰值拒绝台词和不完整证据，补判只需缺失项，回落目标锁定且可以撤回',()=>{
    const value=withState(peakConfig);
    const talk=peakTurn(value,'talk',{speech:'退进安全区，把门关好。'});
    E.applyJudgements(value,'talk',{customState:{delta:0},peakOutcome:finishPeak(talk)},true);
    assert.equal(custom(value).value,100);
    const payload=JSON.parse(E.buildJudgeMessages(value,'talk',{},true)[1].content);
    assert.equal(payload.customStateContext.reviewPlot,false);
    assert.equal(payload.customStateContext.peakCheck.conditions.length,2);
    E.applyJudgements(value,'talk',{peakOutcome:{completed:false,reason:'只是说了动作。'}},true);
    assert.equal(State.canReview(value,E.ensure(value),'talk'),false);
    assert.equal(custom(value).peak.plan.fallback,40);
    State.configure(value,E.ensure(value),true,State.settings({...value.customStateSettings,
        peak:{...value.customStateSettings.peak,fallback:10}}));
    const action=peakTurn(value,'action',{expression:'她退进安全区并把门关好'});
    const incomplete=finishPeak(action);
    incomplete.conditions.pop();
    E.applyJudgements(value,'action',{customState:{delta:0},peakOutcome:incomplete},true);
    assert.equal(custom(value).value,100);
    E.applyJudgements(value,'action',{peakOutcome:finishPeak(action)},true);
    assert.equal(custom(value).value,40);
    E.applyJudgements(value,'action',{peakOutcome:finishPeak(action)},true);
    assert.equal(custom(value).records.filter(record=>record.kind==='peak'&&record.completed).length,1);
    const restored=room(JSON.parse(JSON.stringify(value)));
    assert.equal(custom(restored).value,40);
    assert.equal(custom(restored).records.at(-1).sources.length,2);
    E.revertTurn(value,'action');
    assert.equal(custom(value).value,100);
    assert.equal(custom(value).peak.plan.fallback,40);
});

test('自定义状态可单独补判更早回合，沿用原阶段并重新结算历史',()=>{
    const value=withState(peakConfig,{participants:[{id:'a',name:'小夏',relationshipPolicy:{enabled:false}}]});
    const first=peakTurn(value,'first',{expression:'她退进安全区并把门关好'});
    peakTurn(value,'second',{expression:'她停留在门边'});
    E.applyJudgements(value,'second',{customState:{delta:0},peakOutcome:{completed:false,reason:'没有新变化'}},true);
    assert.deepEqual(State.pendingTurns(value,E.ensure(value)).map(item=>item.turnId),['first']);
    const prompt=E.buildJudgeMessages(value,'first',{},true);
    assert.match(prompt[0].content,/自定义状态证据核对器/);
    assert.doesNotMatch(prompt[1].content,/停留在门边/);
    E.applyJudgements(value,'first',{customState:{delta:-2,reason:'危险已过去',sourceId:first,quote:'把门关好'},
        peakOutcome:finishPeak(first)},true);
    assert.equal(custom(value).value,44);
    assert.equal(custom(value).peak,null);
});

test('改写后的正文重新核对峰值，保持原来的消息累计',()=>{
    const value=withState(peakConfig);
    const source=peakTurn(value,'one',{expression:'她退进安全区并把门关好'});
    E.applyJudgements(value,'one',{customState:{delta:0},peakOutcome:finishPeak(source)},true);
    E.revertRelations(value,'one');
    const snapshot=State.turnSnapshot(value,E.ensure(value),'one');
    State.restoreCue(value,E.ensure(value),'one',snapshot);
    const message=value.messages.at(-1);
    message.dialogue=E.parseDialogue({expression:'她站在原地'});
    message.content=message.dialogue.content;
    E.applyJudgements(value,'one',{customState:{delta:0},peakOutcome:finishPeak(source)},true);
    assert.equal(custom(value).value,100);
    assert.equal(custom(value).remainder,2);
    assert.equal(State.canReview(value,E.ensure(value),'one'),true);
});
