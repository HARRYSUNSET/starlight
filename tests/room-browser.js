module.exports=async function roomBrowserChecks(){
    let checks=0;
    const assert=(value,message)=>{checks++;if(!value)throw new Error('房间2.4：'+message);};
    const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const settle=async()=>{await StarlightMotion.whenIdle();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));};
    const node=selector=>{const result=document.querySelector(selector);if(!result)throw new Error('缺少控件 '+selector);return result;};
    const click=async selector=>{node(selector).click();await settle();};
    const input=(selector,value)=>{node(selector).value=value;node(selector).dispatchEvent(new Event('input',{bubbles:true}));};
    const wait=async(predicate,label)=>{for(let i=0;i<100;i++){if(await predicate())return;await delay(30);}throw new Error('房间检查超时：'+label+' / '+document.querySelector('.toast')?.textContent);};
    const read=()=>window.__qaReadState();
    const base=await read(),originalStory=JSON.stringify(base.agents.find(a=>a.id==='ui-story').conversations),originalRoom=JSON.stringify(base.rooms.find(r=>r.id==='ui-room').messages);
    const savedFetch=window.fetch;
    const calls=[];let sceneMode='normal',dialogueMode='normal',judgeMode='normal',heldScene=null;
    let currentId=null;
    const work=async()=>{const state=await read();return state.rooms.find(r=>r.id===currentId);};
    const reply=(value,status=200)=>new Response(JSON.stringify(status===200?{choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:6}}:{error:{message:'模拟失败，旧内容应保留'}}),{status,headers:{'Content-Type':'application/json'}});
    const sceneResult=()=>({narration:'走廊的灯亮了，窗外只剩一点暮色。',state:{time:'傍晚',place:'旧教室',summary:'放学后仍留在旧教室',objects:'桌上的借书',pending:'还没决定明天的安排'}});
    window.fetch=async(url,options)=>{
        if(new URL(url,location.href).hostname!=='api.deepseek.com')return savedFetch(url,options);
        const body=JSON.parse(options.body),all=body.messages.map(m=>m.content).join('\n');
        if(body.stream){
            calls.push('dialogue');
            if(dialogueMode==='fail')throw new Error('模拟重写网络失败');
            const raw=dialogueMode==='malformed'?'旁白：她心里想着已经攻略成功。':JSON.stringify({expression:'抬眼看你',speech:'我记得你说过这件事。 回复'+calls.length});
            const encoder=new TextEncoder();
            return new Response(new ReadableStream({start(controller){
                controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:raw}}]})+'\n\n'));
                if(dialogueMode==='hold')options.signal.addEventListener('abort',()=>controller.error(new DOMException('cancel','AbortError')),{once:true});
                else{controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();}
            }}),{headers:{'Content-Type':'text/event-stream'}});
        }
        if(all.includes('手动情景预览协议')){
            calls.push('scene');
            if(sceneMode==='fail')return reply(null,503);
            if(sceneMode==='hold')return new Promise(resolve=>{heldScene=()=>resolve(reply({...sceneResult(),narration:'旧请求晚到的内容'}));});
            return reply(sceneResult());
        }
        if(all.includes('房间关系证据核对器')){
            calls.push('judge');if(judgeMode==='fail')return reply(null,503);
            const payload=JSON.parse(body.messages.at(-1).content),source=payload.records.filter(m=>m.role==='user').at(-1);
            return reply({judgements:payload.characters.map(m=>({memberId:m.id,sources:[{id:source.id,quote:source.content}],kind:'action',tag:'兑现约定',familiarity:1,trust:2,affection:1,reason:'本轮实际行动符合人物重视守约的设定。',significant:false}))});
        }
        if(all.includes('隐藏发言调度器')){
            calls.push('director');const state=await work();return reply({speakers:[state.participants[0].id],narration_needed:true,narration_hint:'不应自动执行的旁白'});
        }
        throw new Error('不应自动发生的额外 API 请求');
    };
    async function newRoom(type,label){
        await click('#btnHamburger');await click('[data-home-tab="room"]');await click('#homeAddRoom');
        if(type==='group')await click('[data-room-type="group"]');
        input('#roomNameInput',label);input('#roomUserPersonaInput','同班同学，所有测试行为均由用户明确表达。');input('#roomScenePromptInput','午后的初始教室');
        while(document.querySelectorAll('#roomParticipantsEditor .member-name').length<(type==='group'?2:1))await click('#btnAddRoomParticipant');
        const names=[...document.querySelectorAll('#roomParticipantsEditor .member-name')],personas=[...document.querySelectorAll('#roomParticipantsEditor .member-persona')];
        names.forEach((el,i)=>{el.value=i?'小秋':'小夏';el.dispatchEvent(new Event('input'));});
        personas.forEach(el=>{el.value='重视守约，不因一句赞美就恋爱。';el.dispatchEvent(new Event('input'));});
        await click('#btnConfirmRoom');
        await wait(()=>!StarlightMotion.isOpen(node('#roomModalOverlay'))&&node('#currentAgentName').textContent===label,'保存房间');
        currentId=(await read()).rooms.find(r=>r.name===label).id;
        return currentId;
    }
    async function send(text){
        const before=(await work()).messages.length;
        input('#messageInput',text);await click('#btnSend');
        await wait(async()=>!node('#btnSend').classList.contains('stop-mode')&&(await work()).messages.length>=before+(dialogueMode==='malformed'?1:2),'发送对白');await settle();
    }
    async function actionLast(action){
        node('#messagesContainer [data-message-index]:last-child').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));await settle();await click(`[data-message-action="${action}"]`);
    }
    try{
        await newRoom('double','房间2.4回归 · 双人');
        assert(calls.length===0,'创建房间不强制请求 AI 规则');
        assert(!node('#messageInput').disabled,'没有预生成规则也能编辑对白');
        input('#messageInput','对白草稿');await click('#btnContinueScene');
        assert(!node('#messageInput').value,'首次情景草稿为空');input('#messageInput','推进到放学后，仍留在教室。');await click('#btnRoomDialogue');assert(node('#messageInput').value==='对白草稿','两个通道独立草稿');
        await click('#btnContinueScene');assert(node('#messageInput').value.includes('放学后'),'切回情景恢复草稿');assert(calls.length===0,'切换模式不请求模型');
        node('#messageInput').focus();await click('#btnSend');
        await wait(async()=>Boolean((await work()).experience.sceneDraft),'情景预览生成');await settle();
        assert(StarlightMotion.isOpen(node('#roomExperienceOverlay')),'发送情景要求打开独立页面');
        assert(!document.activeElement.matches('input,textarea'),'打开预览不自动唤起键盘');
        let value=await work();assert(value.messages.length===0,'预览不增加正式消息');assert(value.sharedMemory.summarizedUntil===0,'预览不进入记忆');assert(value.experience.relationHistory.length===0,'预览不加分');
        const firstPreview=value.experience.sceneDraft.content;
        sceneMode='fail';const count=calls.length;await click('#roomSceneGenerate');await wait(()=>node('#roomSceneCancel').hidden,'失败恢复');
        assert((await work()).experience.sceneDraft.content===firstPreview,'生成失败保留上一份预览');assert(calls.length===count+1,'失败不自动付费重试');
        sceneMode='hold';await click('#roomSceneGenerate');await wait(()=>Boolean(heldScene),'等待中的预览');await click('#roomSceneCancel');
        assert(node('#roomSceneGenerate').disabled===false,'取消后生成按钮恢复');
        sceneMode='normal';await click('#roomSceneGenerate');await wait(()=>node('#roomSceneCancel').hidden,'重新生成');heldScene();await delay(50);await settle();
        assert(!node('#roomSceneText').value.includes('旧请求晚到'),'晚到的旧结果不覆盖新预览');
        await click('#roomSceneAccept');await wait(async()=>Boolean((await work()).messages.length),'采纳情景');
        value=await work();assert(value.messages.length===1&&value.messages[0].kind==='narration','只增加一条已采纳情景，不写入创作指令');assert(value.experience.scene.place==='旧教室','采纳才更新当前场景');assert(value.experience.mode==='dialogue','采纳回到对白');assert(node('#messageInput').value==='对白草稿','采纳后恢复对白草稿');
        assert(document.querySelectorAll('.room-scene-card').length===1,'旁白使用独立场景卡');
        await click('#roomExperienceClose');await actionLast('undo');await wait(async()=>!(await work()).messages.length,'撤回情景');assert((await work()).experience.scene.summary.includes('初始教室'),'撤回恢复场景状态');

        await click('#btnRoomJournal');assert(node('#roomRelationContent').textContent.includes('沉浸视图'),'默认不显示后台心理与分数');
        node('#roomAuthorView').checked=true;node('#roomAuthorView').dispatchEvent(new Event('change'));await settle();
        input('#roomRelationPreferences','重视守约，不喜欢反复讨好。');input('[data-relation-value="trust"]','20');input('#roomRelationBaseline','已是同学，不因升级重置为陌生');
        node('#roomRelationBaseline').focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));assert((await work()).messages.length===0,'作者输入框 Ctrl+Z 不撤回正式回合');
        await click('[data-room-tab="scene"]');await click('[data-room-tab="relations"]');assert(node('#roomRelationPreferences').value.includes('守约'),'未保存的作者草稿跨栏目保留');
        await click('#roomRelationSave');await wait(async()=>(await work()).experience.relations[(await work()).participants[0].id].trust===20,'作者校准保存');
        await click('#roomExperienceClose');
        await send('（按约归还借来的书）');value=await work();const a=value.participants[0].id;
        assert(value.experience.relations[a].trust===22,'依据用户真实行动增加信任');assert(value.messages.filter(m=>m.role==='assistant').length===1,'对白正式落盘');assert(value.messages.at(-1).dialogue.speech.includes('我记得'),'正文结构化但界面不显示 JSON');
        assert(value.experience.relationHistory.filter(e=>e.kind!=='author')[0].sources[0].quote.includes('归还'),'关系变化可追溯原文');
        await send('（按约归还借来的书）');assert((await work()).experience.relations[a].trust===22,'重复事件不刷分');
        await send('（按照约定把伞交回去）');value=await work();assert(value.experience.relations[a].trust===24,'不同真实事件可以增长');
        const old=value.messages.at(-1);
        dialogueMode='fail';await actionLast('regenerate');await wait(()=>!node('#btnSend').classList.contains('stop-mode'),'重写失败');value=await work();assert(value.messages.at(-1).id===old.id&&value.experience.relations[a].trust===24,'失败不丢原回复或关系');
        dialogueMode='hold';await actionLast('regenerate');await wait(()=>Boolean(document.querySelector('#roomStreamingMessage')),'重写进行中');value=await work();assert(value.messages.at(-1).id===old.id,'重写期间磁盘仍保留原回复');
        await click('#btnSend');await wait(()=>!node('#btnSend').classList.contains('stop-mode'),'停止重写');assert((await work()).messages.at(-1).id===old.id,'停止后保留原回复');
        dialogueMode='normal';await actionLast('regenerate');await wait(async()=>(await work()).messages.at(-1).id!==old.id&&!node('#btnSend').classList.contains('stop-mode'),'重写完成');value=await work();assert(value.experience.relations[a].trust===24,'重写撤销旧判定再核对，不重复加分');

        dialogueMode='malformed';const beforeInvalid=(await work()).messages.length;await send('（把借用的笔完整归还）');value=await work();assert(value.messages.length===beforeInvalid+1,'格式错误只保存用户输入，不保存坏回复');assert(value.experience.candidates.length===1,'坏回复留作待修正');
        await click('#btnRoomJournal');await click('[data-room-tab="drafts"]');input('[data-draft-speech]','好的，我记住了。');input('[data-draft-expression]','点头');const beforeAdoptCalls=calls.length;await click('[data-draft-accept]');
        await wait(async()=>(await work()).experience.candidates.length===0,'手动修正稿采纳');assert(calls.length===beforeAdoptCalls,'修正采纳不自动发起额外请求');value=await work();assert(value.messages.at(-1).content==='（点头）好的，我记住了。','手工修正只渲染说话和神态');
        await click('[data-room-tab="relations"]');dialogueMode='normal';await click('#roomRelationRecheck');await wait(()=>node('#roomRelationRecheck').disabled&&!StarlightMotion.isOpen(node('#roomExperienceOverlay'))===false,'关系补判完成');
        await wait(async()=>(await work()).experience.relations[a].trust===26,'按来源补判');assert(node('#roomRelationRecheck').disabled,'已核对回合不可重复请求');
        await click('#roomExperienceClose');await actionLast('undo');await wait(async()=>(await work()).messages.length===beforeInvalid,'撤回用户回合');assert((await work()).experience.relations[a].trust===24,'撤回同步恢复关系维度');

        await newRoom('group','房间2.4回归 · 多人');
        await send('@小夏 （按约归还书）');value=await work();const ids=value.participants.map(m=>m.id);assert(value.experience.relations[ids[0]].trust===2&&value.experience.relations[ids[1]].trust===0,'多人关系严格分角色');
        const scenesBefore=calls.filter(c=>c==='scene').length;await send('你们怎么看？');value=await work();assert(value.messages.every(m=>m.kind!=='narration'),'导演声称需要旁白也不会自动生成情景');assert(calls.filter(c=>c==='scene').length===scenesBefore,'对话路径不调用旁白模型');
        judgeMode='fail';const stateBefore=JSON.stringify(value.experience.relations);await send('（兑现新的约定）');value=await work();assert(JSON.stringify(value.experience.relations)===stateBefore,'关系服务失败不乱加减分');assert(value.messages.at(-1).role==='assistant','关系失败不丢正常对白');
        const final=await read();assert(JSON.stringify(final.agents.find(s=>s.id==='ui-story').conversations)===originalStory,'房间改进不污染剧情原文');assert(JSON.stringify(final.rooms.find(r=>r.id==='ui-room').messages)===originalRoom,'不同房间正式记录隔离');
        return {checks,roomId:currentId};
    }finally{if(heldScene)heldScene();window.fetch=savedFetch;document.activeElement?.blur();}
};
