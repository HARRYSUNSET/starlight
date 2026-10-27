const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../www/room-engine.js');
const Rooms=require('../www/rooms.js');
const Memory=require('../www/memory.js');
function room(input={}){return Rooms.normalizeRoom({id:'test-room',roomType:'double',scenePrompt:'午后的教室',participants:[{id:'a',name:'小夏',personaPrompt:'重视守约，不因一句夸奖就恋爱。'}],messages:[],...input},Memory);}
function turn(value,text,id){value.messages.push({id:id+'-u',turnId:id,role:'user',kind:'dialogue',content:text},{id:id+'-a',turnId:id,role:'assistant',kind:'message',speakerId:'a',content:'（点头）谢谢。'});}
function judgement(turnId,quote,extra={}){return {judgements:[{memberId:'a',sources:[{id:turnId+'-u',quote}],kind:'action',tag:'守约',familiarity:1,trust:2,affection:1,reason:'按先前约定归还物品',...extra}]};}

test('旧亲密度与已达到节点原样继承，不补造新维度的经历',()=>{
    const value=room({intimacy:{value:180,initialValue:20,nodes:[{id:'old',value:100,description:'既有关系'}]},participants:[{id:'a',name:'小夏',relationships:'已是恋人'}]});
    const e=E.ensure(value);assert.equal(value.intimacy.value,180);assert.equal(e.relations.a.baseline,'已是恋人');assert.equal(e.relations.a.known,false);assert.equal(e.relationHistory.length,0);assert.equal(Rooms.getAvailableNodes(value)[0].id,'old');
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
test('关系非零判定必须有本轮真实用户来源，伪造及角色自我害羞不能充当证据',()=>{
    const value=room();turn(value,'（归还借来的书）','t1');const before=JSON.stringify(E.ensure(value).relations);
    assert.throws(()=>E.applyJudgements(value,'t1',judgement('t1','不在原文里'),Rooms.applyIntimacyResult),/来源/);
    assert.throws(()=>E.applyJudgements(value,'t1',judgement('t1','点头',{sources:[{id:'t1-a',quote:'点头'}]}),Rooms.applyIntimacyResult),/来源/);
    assert.equal(JSON.stringify(E.ensure(value).relations),before);assert.equal(E.ensure(value).relationHistory.length,0);
});
test('同轮不重复结算，重复事件换标签也不能反复刷分',()=>{
    const value=room(),quote='（归还借来的书）';turn(value,quote,'t1');E.applyJudgements(value,'t1',judgement('t1',quote),Rooms.applyIntimacyResult);
    const before=E.ensure(value).relations.a.trust;assert.equal(E.applyJudgements(value,'t1',judgement('t1',quote)).duplicate,true);
    turn(value,quote,'t2');E.applyJudgements(value,'t2',judgement('t2',quote,{tag:'换个名字的还书事件'}),Rooms.applyIntimacyResult);assert.equal(E.ensure(value).relations.a.trust,before);
});
test('寒暄、赞美和未兑现承诺不因模型误判就持续加分',()=>{
    for(const [quote,kind] of [['你好','action'],['明天一定归还','promise'],['你真棒','praise']]){const value=room();turn(value,quote,'t');E.applyJudgements(value,'t',judgement('t',quote,{kind}),Rooms.applyIntimacyResult);assert.equal(E.ensure(value).relations.a.trust,0);assert.equal(value.intimacy.value,0);}
});
test('各维度限速、独立人物，节点还需信任、证据和文字条件',()=>{
    const value=room();value.intimacy.nodes=[{id:'n',value:1,description:'愿意分享私事',minTrust:1,minEvents:1,condition:'归还借物'}];
    turn(value,'（归还第一本书）','t1');E.applyJudgements(value,'t1',judgement('t1','归还第一本书',{trust:99,affection:99}),Rooms.applyIntimacyResult);
    assert.equal(E.ensure(value).relations.a.trust,2);assert.equal(E.ensure(value).relations.a.affection,1);assert.equal(Rooms.getAvailableNodes(value).length,0);
    turn(value,'（归还第二本书）','t2');E.applyJudgements(value,'t2',judgement('t2','归还第二本书',{grantedNodes:['n']}),Rooms.applyIntimacyResult);assert.equal(Rooms.getAvailableNodes(value)[0].id,'n');
});
test('多人只修改实际回应者的关系，缺失或重复角色判定不部分写入',()=>{
    const value=room({roomType:'group',participants:[{id:'a',name:'小夏'},{id:'b',name:'小秋'}]});turn(value,'遵守了约定','t');E.applyJudgements(value,'t',judgement('t','遵守了约定'));
    assert.equal(E.ensure(value).relations.a.trust,2);assert.equal(E.ensure(value).relations.b.trust,0);
    turn(value,'新的共同事件','t2');assert.throws(()=>E.applyJudgements(value,'t2',{judgements:[]}),/角色/);assert.equal(E.ensure(value).relations.a.trust,2);
});
test('撤回与重新生成撤销来源对应的关系与旧亲密度，并保留后来的作者校准',()=>{
    const value=room(),quote='兑现先前承诺';turn(value,quote,'t');E.applyJudgements(value,'t',judgement('t',quote),Rooms.applyIntimacyResult);assert.equal(value.intimacy.value,1);
    E.revertRelations(value,'t');assert.equal(value.intimacy.value,0);assert.equal(E.ensure(value).relations.a.trust,0);assert.equal(E.ensure(value).relationHistory.length,0);
    E.applyJudgements(value,'t',judgement('t',quote),Rooms.applyIntimacyResult);E.calibrate(value,'a',{trust:60,policy:{baseline:'作者确认的旧友'}});E.revertRelations(value,'t');assert.equal(E.ensure(value).relations.a.trust,60);assert.equal(E.ensure(value).relations.a.baseline,'作者确认的旧友');
});
test('新数据归一化、备份往返不丢预览、规则或关系来源',()=>{
    const value=room(),quote='履行昨日约定';turn(value,quote,'t');E.applyJudgements(value,'t',judgement('t',quote),Rooms.applyIntimacyResult);
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
    const value=room();turn(value,'旧版已核对的行动','old');value.intimacy.value=50;value.turnEffects.old={intimacyDelta:1};
    const result=E.applyJudgements(value,'old',judgement('old','旧版已核对的行动'),Rooms.applyIntimacyResult);assert.equal(result.legacy,true);assert.equal(value.intimacy.value,50);
    value.intimacy.rules='已有规则：角色重视守约。';
    const payload=JSON.parse(E.buildJudgeMessages(value,'old').at(-1).content);
    assert.equal(payload.legacyRules,value.intimacy.rules,'已有关系规则继续参与核对');
});
