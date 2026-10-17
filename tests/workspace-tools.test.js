const test=require('node:test');const assert=require('node:assert/strict');const W=require('../www/workspace-tools.js');
test('章节识别只读用户开头标记，手动命名优先且撤回后无悬挂索引',()=>{
 const messages=[{role:'user',content:'第十二章 雨夜\n开始吧'},{role:'assistant',content:'第十三章 不应自动入目录'},{role:'user',content:'普通输入'},{role:'user',content:'Chapter 14: Dawn'}];
 const work={chapters:[{id:'x',index:0,title:'旧车站约定'},{index:20,title:'已撤回'}]};
 const before=JSON.stringify({work,messages});assert.deepEqual(W.chaptersFor(work,messages).map(c=>[c.index,c.title]),[[0,'旧车站约定'],[3,'Chapter 14: Dawn']]);assert.equal(JSON.stringify({work,messages}),before);
});
test('分页窗口恒定有界、阅读位置在撤回后校验',()=>{assert.deepEqual(W.pageRange(10000,300),{start:300,end:500});assert.deepEqual(W.pageRange(3,0),{start:0,end:3});assert.equal(W.normalizeReading({index:10},3),null);assert.deepEqual(W.normalizeReading({index:1,offset:12,atLatest:false},3),{index:1,offset:12,atLatest:false});});
