// Runs inside the isolated real Chrome fixture, never using a real API key.
module.exports=async function checkInspirationInBrowser(){
 const checks=[],assert=(v,label)=>{if(!v)throw new Error(label);checks.push(label);};
 const wait=async condition=>{for(let i=0;i<120;i++){if(await condition())return;await new Promise(r=>setTimeout(r,30));}throw new Error('Inspiration wait timed out');};
 const settle=async()=>{await StarlightMotion.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));};
 const click=async selector=>{const e=document.querySelector(selector);if(!e||e.disabled)throw new Error('Unavailable '+selector);e.click();await settle();};
 const input=(selector,text)=>{const e=document.querySelector(selector);e.value=text;e.dispatchEvent(new Event('input',{bubbles:true}));};
 const read=()=>window.__qaReadState(),story=s=>s.agents.find(x=>x.id==='ui-story');
 const savedFetch=window.fetch,savedConfirm=window.confirm;
 const requests=[];let hold=false,release=null,truncate=false;
 const draft='第123章，接着图书馆门口的事情继续写。\n\n'+'这一章安排两个人一起寻找一本借出的书，通过眼前的小事自然推进关系，不急于给出谜底。'.repeat(35)+'\n\n写作要求：保持自然对白，不要在结尾总结道理。';
 const directions=[{title:'一起找书',text:'沿着借书记录找到下一条线索，两个人先解决眼前的小麻烦。',reason:'承接图书馆场景。'},{title:'午后的约定',text:'先安排日常互动，让未说完的话自然接下去。',reason:'推进人物关系。'},{title:'旧留言',text:'回顾前文已有的留言，不立刻揭晓秘密。',reason:'推进未解线索。'}];
 window.confirm=()=>true;
 window.fetch=async(url,opts)=>{
  if(!String(url).includes('api.deepseek.com'))return savedFetch(url,opts);
  const body=JSON.parse(opts.body);requests.push(body);
  if(hold){await new Promise(r=>{release=r;});}
  const full=body.messages[0].content.includes('只生成一份');
  return new Response(JSON.stringify({choices:[{finish_reason:truncate?'length':'stop',message:{content:JSON.stringify(full?{draft,profile:{format:'sections',voice:'instruction'}}:{directions})}}],usage:{prompt_tokens:130,completion_tokens:80}}),{status:200});
 };
 try{
  await click('#btnHamburger');await click('[data-home-tab="story"]');await click('[data-work-id="ui-story"]');
  const before=story(await read()),canon=JSON.stringify([before.conversations,before.memory]);
  await click('#btnInspiration');
  assert(requests.length===0,'打开页面不调用模型');
  await click('#btnRefreshInspirationProfile');await click('#btnInspirationReferences');
  assert(requests.length===0,'查看参考及标记下次刷新不产生请求');
  await click('#btnInspirationReferences');
  input('#inspirationRequestInput','主线推进，但不要突然揭晓秘密。');
  await click('#btnGenerateInspiration');await wait(()=>!document.querySelector('#btnGenerateInspiration').disabled);
  assert(requests.length===1&&document.querySelectorAll('.inspiration-direction').length===3,'一次请求只生成三个短方向');
  assert(!JSON.stringify(requests[0]).includes('用户写法范例'),'方向阶段不学习提示词写法');
  assert(document.querySelector('#btnExpandInspiration').disabled,'尚未选择方向不能展开');
  await click('.inspiration-direction');await click('#btnExpandInspiration');
  await wait(()=>!document.querySelector('#btnCopyInspiration').disabled);
  assert(requests.length===2,'方向加完整稿共两次请求，没有第三次学习');
  assert(document.querySelector('#inspirationDraft').value===draft,'完整稿不截断并进入可编辑大页面');
  await wait(async()=>story(await read()).inspiration.draft===draft);
  assert(JSON.stringify([story(await read()).conversations,story(await read()).memory])===canon,'生成方向和完整稿不修改正式消息及记忆');
  input('#inspirationDraft',draft+'\n手动修改保留。');
  await click('#btnUseInspiration');
  assert(!document.querySelector('#inspirationInsertChoice').hidden,'输入框已有草稿时先选择追加或替换');
  assert(document.querySelector('#messageInput').value==='快速编辑草稿 19','选择之前不覆盖原草稿');
  await click('#btnInspirationAppend');
  assert(document.querySelector('#messageInput').value.startsWith('快速编辑草稿 19\n'),'完整稿可追加到原输入末尾');
  assert(!document.querySelector('#btnSend').classList.contains('stop-mode')&&requests.length===2,'填入不自动发送或调用模型');
  await wait(async()=>story(await read()).inspirationDraftSource.includes('手动修改保留'));
  await click('#btnInspiration');
  assert(document.querySelector('#inspirationDraft').value.endsWith('手动修改保留。')&&requests.length===2,'再次打开保留编辑稿且不后台学习');
  await click('#btnInspirationBack');
  await click('#btnDirectInspiration');await wait(()=>!document.querySelector('#btnCopyInspiration').disabled);
  assert(requests.length===3,'直接生成只增加一次请求');
  assert(document.querySelector('#inspirationNoticeText').textContent.includes('保存的写法偏好'),'再次生成复用本作品写法');
  truncate=true;await click('#btnRewriteInspiration');await wait(()=>!document.querySelector('#btnRewriteInspiration').disabled);
  assert(document.querySelector('#inspirationDraft').value===draft&&requests.length===4,'截断输出保留旧草稿且不自动重试');truncate=false;
  hold=true;await click('#btnRewriteInspiration');await wait(()=>Boolean(release));
  await click('#btnCloseInspiration');hold=false;release();await new Promise(r=>setTimeout(r,80));
  await click('#btnInspiration');assert(document.querySelector('#inspirationDraft').value===draft,'关闭取消后迟到结果不覆盖草稿');
  await click('#btnCloseInspiration');
  input('#messageInput','');
  await wait(async()=>!story(await read()).inspirationDraftSource);
  await click('#btnHamburger');await click('[data-home-tab="room"]');await click('#homeRoomList .v2-work-card');
  assert(document.querySelector('#btnInspiration').hidden,'灵感模块不泄漏到房间模式');
  await click('#btnHamburger');await click('[data-home-tab="story"]');await click('[data-work-id="ui-story"]');
  assert(JSON.stringify([story(await read()).conversations,story(await read()).memory])===canon,'退出、切换及取消均不写入剧情正史');
  return{checks:checks.length};
 }finally{window.fetch=savedFetch;window.confirm=savedConfirm;}
};
