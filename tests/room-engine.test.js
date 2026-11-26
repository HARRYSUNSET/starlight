const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../www/room-engine.js');
const Desire=require('../www/room-desire.js');
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

const score=value=>E.ensure(value).desire.value;
const environment=(sourceId,quote,direction='raise',factor='周围恢复安静',strength=2)=>
    ({type:'environment',sourceId,quote,direction,factor,strength});
const release=(sourceId,quote)=>({type:'release',sourceId,quote});

test('基础时钟累积小数，预约、静止对话和普通转场不结算',()=>{
    const value=room({desireEnabled:true,desireSettings:{initialValue:10}});
    turn(value,'三小时后见。','appointment');
    E.applyDesireTime(value,'appointment');
    assert.equal(score(value),10);
    turn(value,'三小时后，街上才重新安静下来。','first');
    E.applyDesireTime(value,'first');
    E.applyDesireTime(value,'first');
    assert.equal(score(value),10.5);
    turn(value,'（半小时后）回到了休息室。','second');
    E.applyJudgements(value,'second',judgement('second','回到了休息室'));
    assert.ok(Math.abs(score(value)-(10.5+1/12))<1e-7);
    const before=score(value);
    E.acceptScene(value,E.sceneCandidate(value,{narration:'她挪到了窗边。',state:{place:'窗边'}},'',E.stamp(value)));
    assert.equal(score(value),before);
    assert.deepEqual(E.ensure(value).desire.history.map(entry=>entry.kind),['time','time']);
});

test('多个个性化规则按优先顺序匹配，空缺字段沿用基础值',()=>{
    const value=room({desireEnabled:true,desireSettings:{initialValue:50,hoursPerPoint:6,resetValue:8,rules:[
        {thresholds:{trust:90},hoursPerPoint:4,resetValue:22},
        {thresholds:{trust:60,familiarity:50},hoursPerPoint:3},
        {thresholds:{trust:60},resetValue:16},
        {thresholds:{affection:0},resetValue:25},
    ]}});
    E.calibrate(value,'a',{familiarity:50,trust:65});
    assert.deepEqual(Desire.effective(value.desireSettings,E.ensure(value).relations.a),{hoursPerPoint:3,growthPoints:1,resetValue:8});
    E.calibrate(value,'a',{trust:95});
    assert.deepEqual(Desire.effective(value.desireSettings,E.ensure(value).relations.a),{hoursPerPoint:4,growthPoints:1,resetValue:22});
    E.ensure(value).relations.a.knownDimensions=[];
    assert.deepEqual(Desire.effective(value.desireSettings,E.ensure(value).relations.a),{hoursPerPoint:6,growthPoints:1,resetValue:8});
});

test('增长量可独立覆盖，旧设置默认每段增加 1 分',()=>{
    const value=room({desireEnabled:true,desireSettings:{growthPoints:4,rules:[{thresholds:{trust:70},growthPoints:10}]}});
    assert.equal(Desire.settings({hoursPerPoint:2}).growthPoints,1);
    turn(value,'三小时后，来到窗边。','first');
    E.applyDesireTime(value,'first');
    assert.equal(score(value),2);
    E.calibrate(value,'a',{trust:75});
    turn(value,'三小时后，走到门边。','second');
    E.applyDesireTime(value,'second');
    assert.equal(score(value),7);
    E.revertTurn(value,'second');
    assert.equal(score(value),2);
});

test('欲望时刻只在三维全满后开启，冻结评分，关闭后从原分继续',()=>{
    const value=room({desireEnabled:true,desireSettings:{initialValue:27,rules:[{thresholds:{trust:100},growthPoints:4}]},
        relationshipEvents:[{description:'可选节点',thresholds:{desire:100}}]});
    const exp=E.ensure(value);
    E.calibrate(value,'a',{familiarity:100,affection:100,trust:99});
    assert.throws(()=>Desire.setPeak(value,exp,true),/达到 100/);
    E.calibrate(value,'a',{trust:100});
    Desire.setPeak(value,exp,true);
    assert.equal(Desire.displayedValue(value),100);
    assert.equal(E.availableNodes(value).length,1);
    turn(value,'六小时后，门外安静了。','paused');
    value.messages.forEach(message=>message.createdAt=10);
    E.applyDesireTime(value,'paused');
    E.applyJudgements(value,'paused',{...judgement('paused','门外安静了'),desireEvents:[environment('paused-u','门外安静了')]});
    assert.equal(score(value),27);
    assert.deepEqual(exp.desire.history,[]);
    assert.doesNotMatch(JSON.stringify(E.buildJudgeMessages(value,'paused')),/"type":"release"|desireContext/);
    assert.match(JSON.stringify(E.buildJudgeMessages(value,'paused')),/desireStep/);
    E.calibrate(value,'a',{trust:99});
    assert.equal(Desire.displayedValue(value),100);
    const revived=Rooms.normalizeRoom(JSON.parse(JSON.stringify(value)),Memory);
    assert.equal(Desire.displayedValue(revived),100);
    Desire.setPeak(value,exp,false,20);
    assert.equal(Desire.displayedValue(value),27);
    assert.equal(E.availableNodes(value).length,0);
    turn(value,'六小时后，她到了门口。','resumed');
    value.messages.slice(-2).forEach(message=>message.createdAt=30);
    E.applyDesireTime(value,'resumed');
    assert.equal(score(value),28);
});

test('两种满分状态都提示角色主动行动，情景可承接，低分和关闭时不提示',()=>{
    const value=room({desireEnabled:true,desireSettings:{initialValue:89,peakBehavior:'角色的私有安排'}});
    const dialogue=()=>Rooms.buildCharacterMessages(value,'a',{},100,Memory).map(message=>message.content).join('\n');
    const narration=()=>Rooms.buildNarrationMessages(value,'自然推进')[0].content;
    assert.doesNotMatch(dialogue(),/峰值时的角色行动/);
    assert.doesNotMatch(narration(),/峰值后的情景衔接/);
    const experience=E.ensure(value);
    Desire.calibrate(experience.desire,100);
    assert.match(dialogue(),/本轮给当前角色一个具体、可感知的主动步骤/);
    assert.equal(value.desireSettings.steps[1].action,'角色的私有安排');
    assert.match(narration(),/峰值后的情景衔接/);
    assert.doesNotMatch(narration(),/角色的私有安排/);

    value.desireEnabled=false;
    assert.doesNotMatch(dialogue(),/峰值时的角色行动/);
    assert.doesNotMatch(narration(),/峰值后的情景衔接/);
    E.calibrate(value,'a',{familiarity:100,trust:100,affection:100});
    Desire.setPeak(value,experience,true);
    assert.match(dialogue(),/欲望时刻已开启/);
    assert.match(dialogue(),/本轮给当前角色一个具体、可感知的主动步骤/);
    assert.match(narration(),/峰值后的情景衔接/);
});

test('环境与完成事件从正式记录独立结算，同一变化不重复叠加',()=>{
    const value=room({desireEnabled:true,desireSettings:{initialValue:97,resetValue:11,sensitivity:150}});
    value.participants[0].relationshipPolicy.enabled=false;
    turn(value,'关门后，房间终于安静下来。','quiet');
    const reply={judgements:[],desireEvents:[environment('quiet-u','房间终于安静下来')]};
    assert.equal(Desire.canJudge(value,'quiet'),true);
    assert.match(JSON.stringify(E.buildJudgeMessages(value,'quiet')),/desireContext/);
    E.applyJudgements(value,'quiet',reply);
    E.applyJudgements(value,'quiet',reply);
    assert.equal(score(value),100);
    assert.equal(E.ensure(value).relations.a.trust,0);
    assert.match(E.desirePrompt(value,'a'),/峰值/);
    turn(value,'房间仍然安静。','quiet2');
    E.applyJudgements(value,'quiet2',{judgements:[],desireEvents:[environment('quiet2-u','房间仍然安静')]});
    assert.equal(E.ensure(value).desire.history.length,1);
    turn(value,'门外突然传来巨响。','noise');
    E.applyJudgements(value,'noise',{judgements:[],desireEvents:[environment('noise-u','传来巨响','lower','门外巨响')]});
    assert.equal(score(value),97);
    turn(value,'她想要找时间独处。','pending');
    E.applyJudgements(value,'pending',{judgements:[],desireEvents:[release('pending-u','想要找时间独处'),release('pending-a','正文不存在')]});
    assert.equal(score(value),97);
    turn(value,'继续。','done');
    value.messages.at(-1).content='（她确认已经完成了纾解。）';
    E.applyJudgements(value,'done',{judgements:[],desireEvents:[release('done-a','已经完成了纾解')]});
    assert.equal(score(value),11);
    E.revertTurn(value,'done');
    assert.equal(score(value),97);
});

test('只在采纳后写入情景变化，修改过的正文要求重新确认，撤回恢复时钟',()=>{
    const value=room({desireEnabled:true,desireSettings:{initialValue:24,hoursPerPoint:6,resetValue:5}});
    const narration='六小时后，房间暖了起来。';
    const result={narration,state:{time:'傍晚'},desireEvents:[environment('','房间暖了起来')]};
    let candidate=E.sceneCandidate(value,result,'',E.stamp(value));
    assert.equal(score(value),24);
    E.acceptScene(value,candidate);
    assert.equal(score(value),27);
    const turnId=value.messages.at(-1).turnId;
    E.revertTurn(value,turnId);
    value.messages.pop();
    assert.equal(score(value),24);
    candidate=E.sceneCandidate(value,result,'',E.stamp(value));
    candidate.content='她只是走到房间的另一头。';
    candidate.elapsedMinutes=180;
    candidate.environmentOverride=-1;
    E.acceptScene(value,candidate);
    assert.equal(score(value),23.5);
});

test('旧房间继承启用状态、已有性欲度与事件门槛，关闭暂停且再次开启延续数值',()=>{
    const value=room({desireEnabled:true,experience:{version:1,relations:{a:{known:true,knownDimensions:['desire','trust'],desire:18,trust:22}}},
        relationshipEvents:[{id:'optional',description:'可选事件',thresholds:{desire:12}}]});
    assert.equal(score(value),18);
    assert.equal(E.ensure(value).relations.a.desire,undefined);
    assert.equal(E.availableNodes(value)[0].id,'optional');
    value.desireEnabled=false;
    turn(value,'六小时后，两人又见面了。','disabled');
    E.applyDesireTime(value,'disabled');
    assert.equal(score(value),18);
    assert.deepEqual(E.availableNodes(value),[]);
    assert.doesNotMatch(JSON.stringify(E.buildJudgeMessages(value,'disabled')),/desireEvents|性欲度/);
    value.desireEnabled=true;
    const restored=Rooms.normalizeRoom(JSON.parse(JSON.stringify(value)),Memory);
    assert.equal(score(restored),18);
    assert.equal(E.availableNodes(restored)[0].id,'optional');
    E.ensure(restored).desire.enabledSince=Date.now()+1000;
    assert.equal(Desire.canJudge(restored,'disabled'),false);
    E.applyDesireTime(restored,'disabled');
    assert.equal(score(restored),18);
});

test('有实质新了解的对话只许可熟悉度增加，零分与实计原因都可回查',()=>{
    const value=room();
    E.calibrate(value,'a',{policy:{criteria:{familiarity:{increase:'在日常交谈中了解新习惯'}}}});
    const quote='我每天傍晚去河边散步';
    turn(value,quote,'new-info');
    E.applyJudgements(value,'new-info',judgement('new-info',quote,{kind:'conversation',reasons:{familiarity:'首次了解日常习惯'}}));
    const audit=value.turnEffects['new-info'].relationshipAudit.records[0];
    assert.equal(audit.applied.familiarity,1);
    assert.equal(audit.requested.trust,2);
    assert.equal(audit.applied.trust,0);
    assert.equal(audit.causes.trust,'criteria');
    assert.equal(audit.reasons.familiarity,'首次了解日常习惯');
    assert.match(JSON.stringify(E.buildJudgeMessages(value,'new-info')),/在日常交谈中了解新习惯/);
    turn(value,'好的','neutral');
    E.applyJudgements(value,'neutral',{judgements:[{memberId:'a',sources:[],familiarity:0,trust:0,affection:0}]});
    assert.equal(value.turnEffects.neutral.relationshipAudit.records[0].applied.affection,0);
    assert.equal(value.turnEffects.neutral.relationshipAudit.records[0].causes.affection,'steady');
});

test('达到准备阈值后逐步确认，满分不跳过未完成准备，撤回可回退阶段',()=>{
    const value=room({desireEnabled:true,desireSettings:{initialValue:89,prepareAt:90}});
    assert.equal(Desire.stage(value).ready,false);
    turn(value,'六小时后，外面安静了。','tick');
    E.applyDesireTime(value,'tick');
    assert.equal(score(value),90);
    assert.equal(Desire.stage(value).next.id,'prepare');
    assert.match(E.desirePrompt(value,'a'),/进入准备阶段/);
    Desire.calibrate(E.ensure(value).desire,100);
    turn(value,'继续对话。','prep');
    value.messages.at(-1).content='让我独处一会儿，然后我们再接着聊。';
    const result=judgement('prep','继续对话。',{familiarity:0,trust:0,affection:0});
    result.desireEvents=[{type:'step',stepId:'act',sourceId:'prep-a',quote:'让我独处一会儿'}];
    E.applyJudgements(value,'prep',result);
    assert.equal(Desire.stage(value).next.id,'prepare');
    result.desireEvents[0].stepId='prepare';
    const trust=E.ensure(value).relations.a.trust;
    E.applyJudgements(value,'prep',result);
    assert.equal(Desire.stage(value).next.id,'act');
    assert.equal(E.ensure(value).relations.a.trust,trust);
    E.revertTurn(value,'prep');
    assert.equal(Desire.stage(value).next.id,'prepare');
});

test('三维格式失败仍可按有效来源回落，漏报可手动确认且不会重复结算',()=>{
    const build=()=>room({desireEnabled:true,desireSettings:{initialValue:100,resetValue:18}});
    const first=build();
    turn(first,'继续。','done');
    first.messages.at(-1).content='她确认已完成了纾解。';
    E.applyJudgements(first,'done',{judgements:[],desireEvents:[release('done-a','已完成了纾解')]});
    assert.equal(first.turnEffects.done.relationshipAudit.status,'failed');
    assert.equal(first.turnEffects.done.desireReview,'settled');
    assert.equal(score(first),18);

    const second=build();
    turn(second,'继续。','manual');
    const message=second.messages.at(-1);
    message.content='她确认已完成了纾解。';
    E.applyJudgements(second,'manual',{judgements:[{memberId:'a',sources:[],familiarity:0,trust:0,affection:0}],desireEvents:[]});
    assert.equal(second.turnEffects.manual.desireReview,'unconfirmed');
    assert.equal(E.canRecheck(second,'manual'),true);
    Desire.confirmMessage(second,E.ensure(second),message,'release');
    assert.equal(score(second),18);
    assert.equal(second.turnEffects.manual.desireReview,'settled');
    assert.throws(()=>Desire.confirmMessage(second,E.ensure(second),message,'release'),/重复确认/);
    E.revertRelations(second,'manual');
    assert.equal(score(second),100);
});
