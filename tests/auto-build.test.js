const test=require('node:test');const assert=require('node:assert/strict');
const A=require('../www/auto-build.js'),S=require('../www/story.js'),M=require('../www/memory.js'),W=require('../www/workspace-tools.js'),I=require('../www/inspiration.js'),Archive=require('../www/archive.js');
function work(){return S.createAgent({name:'自动小说',openingScene:'清晨的教室',characters:[{fields:[{label:'角色名称',value:'小夏'}]}]},M);}
test('自动构筑只组装本章任务，当前正文与记忆不被规划污染',()=>{
 const w=work();A.ensure(w).settings.nextNote='本章去旧车站';const before=JSON.stringify(w.conversations),task=A.createTask(w);
 assert.match(A.instructions(task),/完整的一章/);assert.match(A.instructions(task),/本章去旧车站/);
 assert.equal(JSON.stringify(w.conversations),before);assert.equal(w.memory.core,'');
 const messages=A.messages(w,[{role:'system',content:'固定规则'}],task);assert.equal(messages.length,2);assert.equal(messages.at(-1).role,'user');assert.equal(w.conversations.length,0);
});
test('成功章节同时记录来源、目录和下一章编号，继续不是重复保存',()=>{
 let w=work();A.ensure(w).settings.nextNote='只用一次';const task=A.createTask(w);w.autoBuild.mode='generating';
 w=A.result(w,task,'第1章 清晨\n\n「早呀！」');assert.equal(w.autoBuild.mode,'awaiting');assert.equal(w.autoBuild.nextNumber,2);assert.equal(w.autoBuild.settings.nextNote,'');
 assert.equal(w.conversations.length,2);assert.equal(w.conversations[0].kind,'autoTask');assert.equal(w.chapters[0].index,1);assert.equal(w.chapters[0].chapterNumber,1);
 const next=A.createTask(w);assert.equal(next.number,2);assert.notEqual(next.chapterId,task.chapterId);assert.equal(w.conversations.length,2);
});
test('自动任务与章号跨标准化及备份保存，不被灵感范例学习',()=>{
 const t=A.createTask(work()),done=A.result(work(),t,'一段完整正文。'),w=S.normalizeAgent(done,M);
 assert.equal(w.conversations[0].autoTask.id,t.id);assert.equal(w.conversations[1].chapterId,t.chapterId);assert.equal(w.autoBuild.nextNumber,2);
 assert.equal(I.selectExamples(w.conversations).length,0);assert.equal(W.normalizeChapters(w.chapters,2)[0].chapterNumber,1);
 const backup=Archive.createBackup({agents:[w],rooms:[],styleProfiles:[]});assert.equal(backup.state.agents[0].autoBuild.nextNumber,2);
});
test('旧作中文章号可推断，重写不加章，撤回回退章号',()=>{
 let w=work();w.conversations=[{role:'user',content:'第十二章，放学后'}];assert.equal(A.inferNext(w),13);
 const task=A.createTask(w);assert.equal(task.number,13);w=A.result(w,task,'第十三章\n完整正文');
 w.conversations.at(-1).content='精修后的正文';assert.equal(A.ensure(w).nextNumber,14);assert.equal(A.undo(w).nextNumber,13);
});
test('本章检索基于最新正文和当前要求，字数与输出预算本地计算',()=>{
 const w=work();w.conversations=[{role:'user',content:'很早的要求'},{role:'assistant',content:'现在已经到了图书馆。'}];
 const task=A.createTask(w);assert.match(A.query(w,task),/图书馆/);assert.doesNotMatch(A.query(w,task),/很早的要求/);
 assert.equal(A.count('你 好\n！'),3);assert.ok(A.outputTokens(task)>3000);assert.throws(()=>A.result(w,task,'   '),/未返回/);
});
test('自动续写世界书检索可覆盖过期用户提示，默认请求兼容',()=>{
 const w=work();const task=A.createTask(w);w.conversations=[{role:'user',content:'旧地点'}];
 const prompts=S.buildRequestPrompts(w,'规则',M.DEFAULT_CONFIG,'',M,'',A.query(w,task));
 assert.ok(prompts.stableSystemPrompt);assert.doesNotMatch(prompts.turnReminder,/单拍推进/);
 const state=A.normalize({mode:'awaiting',settings:{targetMin:5000,targetMax:100}});assert.equal(state.settings.targetMax,5000);
});
test('摘要最小阈值不会把超软限的同条消息重复计费',()=>{
 const messages=[{role:'user',content:'开篇'},{role:'assistant',content:'章'.repeat(6000)},{role:'user',content:'作'.repeat(40000)},{role:'assistant',content:'短回复'},...Array.from({length:4},(_,i)=>({role:i%2?'assistant':'user',content:i%2?'文'.repeat(6000):'继续'}))];
 assert.equal(M.findSummaryChunk(messages,M.createEmptyMemory(),{minChunkTokens:80000,maxChunkTokens:12000,recentTokenBudget:20000}),null);
});
test('自动章校准紧贴任务，重写同步自动标题但保留用户自定义目录名',()=>{
 const w=work(),task=A.createTask(w),messages=A.messages(w,[{role:'system',content:'【本轮校准】完整写章'},{role:'assistant',content:'上章正文'}],task);
 assert.equal(messages.at(-2).content,'【本轮校准】完整写章');assert.equal(messages.at(-1).role,'user');
 w.chapters=[{id:'c1',automatic:true,chapterNumber:1,title:'旧标题'},{id:'c2',automatic:false,title:'用户标题'}];
 assert.equal(A.retitle(w,'c1','第1章 新标题\n正文')[0].title,'第1章 新标题');assert.equal(A.retitle(w,'c2','第2章 模型标题')[1].title,'用户标题');
});
