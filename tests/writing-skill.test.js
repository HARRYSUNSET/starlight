const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../www/writing-skill.js'),S=require('../www/style-lab.js'),Story=require('../www/story.js'),Rooms=require('../www/rooms.js'),M=require('../www/memory.js'),V=require('../www/voice.js');
const source='第一节\n\n“你来了吗？”\n\n“刚到……等我一下！”\n\n她在门口找钥匙，话说到一半，又低头看了一眼书包。\n\n'+('“找到了？”\n\n“找到了。”\n\n她把钥匙递过去，又看了看表。\n\n').repeat(12);
function result(){return {suggested_name:'自然日常',factors:[{name:'分段',instruction:'按照交流切换段落'}],writing_skill:{rules:W.DIMENSIONS.map(d=>({id:d.id,observation:'样本中的'+d.name,method:d.name+'根据交流目的变化',whenNot:'按本轮明确要求处理',evidenceIds:[W.sourceSamples(source)[0].id]}))}};}
function profile(){return S.profileFromAnalysis(S.createProfile(),result(),source,'对白使用「」；迟疑可用……，被打断可用——。');}

test('源文本统计为本地计数，连续对白样本保留空行并可在原文定位',()=>{
    const stats=W.statistics(source);assert.equal(stats.characters,source.length);assert.ok(stats.punctuation['？']>0);assert.equal(stats.punctuation['……'],1);
    const samples=W.sourceSamples(source);assert.ok(samples.length);for(const s of samples){assert.equal(source.slice(s.start,s.end),s.text);assert.ok(s.text.length<=650);}
    assert.match(samples[0].text,/\n\n/);assert.ok(!samples[0].text.startsWith('第一节'));
    assert.ok(W.completeExcerpt('完整一句。下一句话很长'.repeat(30),30).endsWith('。'));
});
test('一键分析只读完整样本，十个维度和用户要求参与同一次分析',()=>{
    const requests=S.buildAnalysisMessages(source,'使用「」和？！');assert.equal(requests.length,2);
    assert.match(requests[1].content,/使用「」和？！/);assert.ok(requests[1].content.includes(source));
    for(const d of W.DIMENSIONS)assert.ok(requests[0].content.includes(d.id));
    assert.ok(!requests[0].content.includes('刚到……等我一下'));
    assert.throws(()=>S.buildAnalysisMessages('字'.repeat(30001)),/30000/);
});
test('新档案区分用户写法与观察，出处验证，重新分析刷新旧锚与基线',()=>{
    const p=profile();assert.equal(p.skill.rules.length,10);assert.match(p.skill.userInstructions,/迟疑/);
    const bad=result();bad.writing_skill.rules[0].evidenceIds=['伪造位置'];assert.deepEqual(W.fromAnalysis(bad,source,'').rules[0].evidenceIds,[]);
    const nextSource='“明天见。”\n\n他把信封放下。'.repeat(20);
    const next=S.profileFromAnalysis({...p,anchor:'旧文本里的锚'},result(),nextSource,'新要求');
    assert.notEqual(next.anchor,'旧文本里的锚');assert.ok(nextSource.includes(next.anchor));
    const edited=S.normalizeProfile({...next,anchor:'手动替换',skill:{...next.skill,manual:'新的说明'}});
    const reset=S.resetProfile(edited);assert.equal(reset.anchor,next.anchor);assert.deepEqual(reset.skill,next.skill);
});
test('实际文风请求保留用户指定、核心写法和段落；强度0不发送',()=>{
    const p=profile(),a=S.createAppliedStyle(p);const out=S.buildInfluencePrompt(a);
    assert.match(out,/用户指定写法/);assert.match(out,/对白使用「」/);assert.match(out,/分段与留白/);assert.match(out,/标点与语气/);assert.match(out,/语感参照/);assert.match(out,/\n\n/);
    assert.ok(out.length<=S.getStrengthStrategy(p.strength).budget);
    assert.equal(S.buildInfluencePrompt({...a,strength:0}),'');
    const before=JSON.stringify(a);S.buildInfluencePrompt(a,{query:'告别'});assert.equal(JSON.stringify(a),before);
});
test('长因子和反馈不挤掉锚，预算收缩可见，人工说明优先且正文有界',()=>{
    const p=profile();p.strength=100;p.analysis.factors=Array.from({length:16},(_,i)=>({name:'方法'+i,instruction:'长说明'.repeat(200)}));
    p.feedback=Array.from({length:4},()=>({note:'反馈'.repeat(100),replacement:'修订'.repeat(100)}));
    const out=S.buildInfluencePrompt(S.createAppliedStyle(p));assert.match(out,/语感参照/);assert.match(out,/对白使用「」/);assert.ok(out.length<=4600);
    const compact=W.compile({...p.skill,manual:'人工写作要求'.repeat(300)},{maxChars:700});assert.equal(compact.shortened,true);assert.ok(compact.text.length<=700);assert.match(compact.text,/用户编辑/);
});
test('只改锚或方法提示快照可更新，不修改另一作品；JSON和Markdown可往返',()=>{
    const p=profile(),a=S.createAppliedStyle(p),b=S.createAppliedStyle(p);
    assert.equal(S.getApplicationState({...p,anchor:'另一个片段'},a).stale,true);
    const skill=structuredClone(p.skill);skill.rules[0].method='新方法';assert.equal(S.getApplicationState({...p,skill},a).stale,true);assert.notEqual(b.skill.rules[0].method,'新方法');
    const restored=S.createProfile(W.importArchive(W.exportArchive(p),'profile.json'));assert.deepEqual(restored.skill,p.skill);
    const md=W.markdown(p.skill,p.name),imported=S.createProfile(W.importArchive(md,'SKILL.md'));assert.equal(imported.skill.userInstructions,p.skill.userInstructions);assert.equal(imported.skill.rules[0].method,p.skill.rules[0].method);
    const custom=S.createProfile(W.importArchive('# 自用写法\n\n对白用「」，允许心理活动。','SKILL.md'));assert.ok(S.buildInfluencePrompt(S.createAppliedStyle(custom)).includes('用户编辑的写作说明'));
    assert.throws(()=>W.importArchive('{"hello":1}','a.json'),/不支持|不是支持/);
    assert.throws(()=>W.importArchive('字'.repeat(800000),'SKILL.md'),/2 MB/);
    const standalone=S.createProfile({skill:{manual:'对白使用「」；按语气安排停顿。'}});assert.ok(S.createAppliedStyle(standalone).skill.manual);
    const large={...p,skill:{...p.skill,manual:'写作说明。'.repeat(2400)}};
    assert.ok(W.markdown(large.skill,large.name).length>12000);
    assert.equal(W.importArchive(W.markdown(large.skill,large.name),'SKILL.md').skill.manual,large.skill.manual);
    assert.deepEqual(S.createProfile(W.importArchive(W.exportArchive(p),'skill.json')).baseline,p.baseline);
});
test('剧情短输入可以要求完整长篇，旧默认迁移且自定义规则原样保留',()=>{
    const agent=Story.createAgent({},M);agent.conversations=[{role:'user',content:'写一整章，至少三千字。'}];
    const prompt=Story.buildRequestPrompts(agent,'',M.normalizeConfig(),'',M,'');
    assert.doesNotMatch(prompt.turnReminder,/单拍|一个短段落|只推进一拍|本轮许可/);assert.match(prompt.turnReminder,/完整正文/);assert.match(prompt.stableSystemPrompt,/用户消息是本次创作要求/);
    const old=['这是一个持续发展的剧情对话。你只扮演角色设定区中的AI角色与必要的客观环境。','不得替用户决定台词、行动、思想或感受；只能回应用户已经明确表达的内容。',...Story.DEFAULT_STORY_RULES.split('\n').slice(2)].join('\n');
    assert.equal(Story.normalizeAgent({...agent,storyRules:old},M).storyRules,Story.DEFAULT_STORY_RULES);
    assert.equal(Story.normalizeAgent({...agent,storyRules:'自定义作者要求'},M).storyRules,'自定义作者要求');
    const room=Rooms.normalizeRoom({name:'房间',participants:[{id:'a',name:'A'}],messages:[{role:'user',content:'你好'}]},M,'');
    assert.match(Rooms.buildCharacterMessages(room,'a',{},100,M)[1].content,/单拍推进/);
});
test('体检重复调用不残留正则游标，错误报告不修改原文',()=>{
    V.detectTells('不是担心而是紧张。与其说是巧合不如说是安排。');
    const text='与其说是巧合不如说是安排。';const first=V.detectTells(text);
    assert.ok(first.length);assert.deepEqual(V.detectTells(text),first);
});
