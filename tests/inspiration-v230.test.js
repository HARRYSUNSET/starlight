const test=require('node:test');
const assert=require('node:assert/strict');
const Inspiration=require('../www/inspiration.js');
const Story=require('../www/story.js');
const Memory=require('../www/memory.js');
const Archive=require('../www/archive.js');
const sample=n=>({role:'user',content:`第${n}章，承接上一章的结尾。\n\n`+'这一章请安排两个人一起完成眼前的事情，以具体行动推动关系变化，不急于揭晓线索。'.repeat(n+3)+'\n写作要求：对白自然，不要在结尾总结道理。'});
const snapshot={workId:'story-a',apiKey:'sk-fixture',model:'deepseek-flash',settings:'设定：图书馆',memory:'两人尚未找到钥匙。',conversations:[sample(1),{role:'assistant',content:'他们仍在门外。'},sample(2),sample(3)],direction:'推进日常'};
const draft='下一章从图书馆门口的等待接起。'+'安排两个人围绕找书这件小事产生自然互动，用行动而不是标签表现性格。'.repeat(50);
const response=(content,reason='stop')=>new Response(JSON.stringify({choices:[{finish_reason:reason,message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:100,completion_tokens:50}}));

test('自动选取代表用户长输入，排除继续、纠错、AI来源及重复；明确指定可覆盖来源',()=>{
 const source=[...snapshot.conversations,{role:'user',content:'继续'}, {...sample(2)}, {...sample(4),inspirationGenerated:true}, {...sample(5),inspirationExcluded:true}, {role:'user',content:'纠正上一条。'.repeat(100)}];
 const before=JSON.stringify(source),selected=Inspiration.selectExamples(source);
 assert.equal(selected.length,3);assert.ok(selected.every(s=>source[s.index].role==='user'&&!source[s.index].inspirationGenerated&&!source[s.index].inspirationExcluded));
 assert.equal(new Set(selected.map(s=>s.fingerprint)).size,3);assert.equal(JSON.stringify(source),before);
 source[6].inspirationExample=true;assert.ok(Inspiration.selectExamples(source).some(s=>s.index===6));
});
test('方向阶段不读取写法档案，完整稿才携带参考且输出预算匹配长提示词',()=>{
 const direction=Inspiration.buildDirectionRequest({...snapshot,writingProfile:{secret:'SHOULD_NOT_SEND'}});
 assert.doesNotMatch(JSON.stringify(direction),/SHOULD_NOT_SEND|用户写法范例/);
 assert.match(direction.messages[0].content,/三个事件发展实质不同/);
 const full=Inspiration.buildFullRequest({...snapshot,targetChars:4000});
 assert.match(full.messages[1].content,/用户写法范例/);assert.match(full.messages[0].content,/约4000字/);
 assert.ok(full.max_tokens>direction.max_tokens);assert.match(full.messages[0].content,/不是小说正文作者/);
});
test('首次完整稿仅一次请求，原设定消息记忆不变，返回结构化偏好而非故事事实',async()=>{
 let calls=0;const before=JSON.stringify(snapshot);
 const result=await Inspiration.requestFullPrompt(snapshot,{fetch:async()=>{calls++;return response({draft,profile:{format:'sections',voice:'instruction',facts:'不应保留',fixedSuffix:'不应相信'}});}});
 assert.equal(calls,1);assert.equal(result.profileReused,false);assert.equal(JSON.stringify(snapshot),before);
 assert.equal(result.profile.format,'sections');assert.equal(result.profile.fixedSuffix,'写作要求：对白自然，不要在结尾总结道理。');
 assert.doesNotMatch(JSON.stringify(result.profile),/不应/);assert.ok(result.draft.endsWith(result.profile.fixedSuffix));
});
test('写法档案只在同作品同样本复用，正文记忆每次使用最新版本',async()=>{
 const first=await Inspiration.requestFullPrompt(snapshot,{fetch:async()=>response({draft})});
 const source={...snapshot,writingProfile:first.profile,memory:'最新事实：现在找到钥匙了。'};
 let body;const second=await Inspiration.requestFullPrompt(source,{fetch:async(_,opts)=>{body=JSON.parse(opts.body);return response({draft});}});
 assert.equal(second.profileReused,true);assert.match(JSON.stringify(body),/现在找到钥匙/);
 for(const changed of [{...source,workId:'story-b'},{...source,forceProfileRefresh:true},{...source,conversations:[...source.conversations,sample(8)]}]){
  const result=await Inspiration.requestFullPrompt(changed,{fetch:async()=>response({draft})});assert.equal(result.profileReused,false);
 }
});
test('长完整稿不会静默截为3000字，token截断、过短和错误JSON不自动重试',async()=>{
 const long=draft.repeat(4);const complete=await Inspiration.requestFullPrompt(snapshot,{fetch:async()=>response({draft:long})});assert.ok(complete.draft.includes(long));
 for(const payload of [()=>response({draft},'length'),()=>response({draft:'一句短点子'}),()=>new Response(JSON.stringify({choices:[{message:{content:'{"draft":'}}]}))]){
  let calls=0;await assert.rejects(Inspiration.requestFullPrompt(snapshot,{fetch:async()=>{calls++;return payload();}}));assert.equal(calls,1);
 }
});
test('新流程失败不查余额也不自动重试，取消不会接受忽略信号后迟到的结果',async()=>{
 let calls=0;await assert.rejects(Inspiration.requestDirections(snapshot,{fetch:async()=>{calls++;return new Response('{"error":{"message":"Insufficient Balance"}}',{status:402});}}));assert.equal(calls,1);
 const controller=new AbortController();let resolve;const pending=Inspiration.requestFullPrompt(snapshot,{signal:controller.signal,fetch:()=>new Promise(r=>{resolve=r;})});
 controller.abort();resolve(response({draft}));await assert.rejects(pending,e=>e.name==='AbortError');
});
test('超长范例与设定受预算限制；无范例仍可生成；人物设定不混入写法档案',()=>{
 const request=Inspiration.buildFullRequest({...snapshot,settings:'世界设定'.repeat(20000),memory:'记忆'.repeat(20000),conversations:[{role:'user',content:'第1章\n'+'正文要求'.repeat(10000)}]});
 assert.ok(Memory.estimateMessagesTokens(request.messages)<23000);
 const none=Inspiration.buildFullRequest({...snapshot,conversations:[]});assert.match(none.messages[1].content,/尚无合适/);
 assert.equal(Inspiration.normalizeProfile({version:1,workId:'a',format:'秘密事实',facts:'秘密'}).format,'paragraph');
});
test('写法及草稿能持久化备份，生成来源在升级后保留；正常剧情请求不注入它们',()=>{
 const agent=Story.normalizeAgent({id:'a',conversations:[{...sample(1),inspirationGenerated:true}],inspiration:{draft:'DRAFT_ONLY',request:'REQUEST_ONLY'},inspirationProfile:{version:1,workId:'a'},inspirationDraftSource:'DRAFT_ONLY'},Memory);
 assert.equal(agent.conversations[0].inspirationGenerated,true);assert.equal(agent.inspiration.draft,'DRAFT_ONLY');
 const backup=Archive.createBackup({agents:[agent],rooms:[],styleProfiles:[],apiKey:'sk-fixture'},{scope:'all'});
 assert.equal(backup.state.agents[0].inspiration.draft,'DRAFT_ONLY');assert.doesNotMatch(JSON.stringify(backup),/sk-fixture/);
 assert.doesNotMatch(Story.buildStructuredPrompt(agent),/DRAFT_ONLY|REQUEST_ONLY|sampleFingerprints/);
 assert.equal(Inspiration.selectExamples(agent.conversations).length,0);
});
