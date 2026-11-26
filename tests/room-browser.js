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
    const calls=[],requestBodies=[];let sceneMode='normal',dialogueMode='normal',judgeMode='normal',heldScene=null;
    let currentId=null, directorEmpty=false;
    const work=async()=>{const state=await read();return state.rooms.find(r=>r.id===currentId);};
    const reply=(value,status=200)=>new Response(JSON.stringify(status===200?{choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:6}}:{error:{message:'模拟失败，旧内容应保留'}}),{status,headers:{'Content-Type':'application/json'}});
    const sceneResult=()=>({narration:'走廊的灯亮了，窗外只剩一点暮色。',state:{time:'傍晚',place:'旧教室',summary:'放学后仍留在旧教室',objects:'桌上的借书',pending:'还没决定明天的安排'}});
    window.fetch=async(url,options)=>{
        if(new URL(url,location.href).hostname!=='api.deepseek.com')return savedFetch(url,options);
        const body=JSON.parse(options.body),all=body.messages.map(m=>m.content).join('\n');
        requestBodies.push(body);
        if(body.stream){
            calls.push('dialogue');
            if(dialogueMode==='fail')throw new Error('模拟重写网络失败');
            const raw=dialogueMode==='recover'?(body.response_format?'   ':'“我记得。”'):dialogueMode==='malformed'?'旁白：她心里想着已经攻略成功。':dialogueMode==='whitespace'?'   \n  ':['empty','reasoning-only'].includes(dialogueMode)?'':JSON.stringify({expression:'她抬眼看向【玩家】',speech:dialogueMode==='action'?'':'我记得你说过这件事。 回复'+calls.length});
            const encoder=new TextEncoder();
            return new Response(new ReadableStream({start(controller){
                controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:raw}}]})+'\n\n'));
                if(dialogueMode==='reasoning-only')controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'PRIVATE_TEST_REASONING'}}]})+'\n\n'));
                if(dialogueMode==='hold')options.signal.addEventListener('abort',()=>controller.error(new DOMException('cancel','AbortError')),{once:true});
                else{controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{},finish_reason:dialogueMode==='reasoning-only'?'length':'stop'}],usage:{prompt_tokens:30,completion_tokens:dialogueMode==='reasoning-only'?16000:20,completion_tokens_details:{reasoning_tokens:dialogueMode==='reasoning-only'?16000:0}}})+'\n\ndata: [DONE]\n\n'));controller.close();}
            }}),{headers:{'Content-Type':'text/event-stream'}});
        }
        if(all.includes('手动情景预览协议')){
            calls.push('scene');
            if(sceneMode==='recover')return new Response(JSON.stringify({choices:[{message:{content:body.response_format?'  ':JSON.stringify({...sceneResult(),narration:'灯亮了一盏。'})},finish_reason:'stop'}]}));
            if(sceneMode==='fail')return reply(null,503);
            if(['whitespace','empty'].includes(sceneMode))return new Response(JSON.stringify({choices:[{message:{content:sceneMode==='whitespace'?'   ':''},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
            if(sceneMode==='hold')return new Promise(resolve=>{heldScene=()=>resolve(reply({...sceneResult(),narration:'旧请求晚到的内容'}));});
            return reply(sceneResult());
        }
        if(all.includes('writing_skill')){
            calls.push('style-analysis');
            return reply({suggested_name:'房间试写测试',summary:'自然接话。',factors:[{name:'对白',instruction:'先回应眼前的话。'}]});
        }
        if(all.includes('房间关系证据核对器')){
            calls.push('judge');if(judgeMode==='fail')return reply(null,503);
            const payload=JSON.parse(body.messages.at(-1).content),source=payload.records.filter(m=>m.role==='user').at(-1);
            const judgements=payload.characters.map(m=>({memberId:m.id,sources:[{id:source.id,quote:source.content}],kind:'action',tag:'兑现约定',familiarity:1,trust:2,affection:1,reason:'本轮实际行动符合人物重视守约的设定。',significant:false}));
            const desireEvents=payload.desireContext&&source.content.includes('喧闹声停了')?
                [{type:'environment',sourceId:source.id,quote:'喧闹声停了',factor:'四周安静下来',direction:'raise',strength:2}]:[];
            return reply({judgements,desireEvents});
        }
        if(all.includes('隐藏发言调度器')){
            calls.push('director');
            if(directorEmpty)return new Response(JSON.stringify({choices:[{message:{content:'    '},finish_reason:'stop'}]}));
            const state=await work();return reply({speakers:[state.participants[0].id],narration_needed:true,narration_hint:'不应自动执行的旁白'});
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
        if (node('#btnRoomComposerTools').getAttribute('aria-expanded') === 'false') await click('#btnRoomComposerTools');
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
        let scorecard=node('#roomRelationshipCard');
        assert(!scorecard.hidden&&scorecard.querySelectorAll('[data-dimension]').length===3,'双人房间显示三维进度');
        assert(scorecard.getAttribute('aria-label').includes('待评估'),'缺失的旧分数显示待评估');
        await click('#btnRoomHeaderTools');
        assert(getComputedStyle(node('#roomContextBar')).display==='none'&&scorecard.getBoundingClientRect().height>0,'折叠只收起工具，保留关系浮卡');
        await click('#roomRelationshipCard');
        assert(StarlightMotion.isOpen(node('#roomExperienceOverlay'))&&!document.querySelector('[data-relation-value]'),'浮卡打开只读关系档案');
        await click('#roomExperienceClose');
        await click('#btnRoomHeaderTools');
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

        await click('#roomRelationshipCard');assert(!node('#roomRelationContent').querySelector('[data-relation-value]'),'作者视图关闭时不显示评分修改框');
        node('#roomAuthorView').checked=true;node('#roomAuthorView').dispatchEvent(new Event('change'));await settle();
        input('#roomRelationPreferences','重视守约，不喜欢反复讨好。');input('[data-relation-value="trust"]','20');input('#roomRelationBaseline','已是同学，不因升级重置为陌生');
        await click('#roomEffectiveCriteria summary');
        input('[data-criteria-dimension="familiarity"][data-criteria-kind="increase"]','首次分享一个真实日常习惯');
        node('#roomRelationBaseline').focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));assert((await work()).messages.length===0,'作者输入框 Ctrl+Z 不撤回正式回合');
        await click('[data-relation-tab="events"]');await click('[data-relation-tab="profile"]');assert(node('#roomRelationPreferences').value.includes('守约'),'未保存的作者草稿跨栏目保留');
        await click('#roomRelationSave');await wait(async()=>(await work()).experience.relations[(await work()).participants[0].id].trust===20,'作者校准保存');
        await click('#roomExperienceClose');
        await send('（按约归还借来的书）');value=await work();const a=value.participants[0].id;
        assert(value.experience.relations[a].trust===22,'依据用户真实行动增加信任');assert(value.messages.filter(m=>m.role==='assistant').length===1,'对白正式落盘');assert(value.messages.at(-1).dialogue.speech.includes('我记得'),'正文结构化但界面不显示 JSON');
        assert(requestBodies.at(-1).messages.at(-1).content.includes('首次分享一个真实日常习惯'),'作者标准进入模型核对');
        assert(value.messages.at(-1).dialogue.expression==='她抬眼看向你' && !node('#messagesContainer').textContent.includes('【玩家】'),'房间保存和气泡显示都采用第二人称');
        assert(requestBodies.findLast(body=>body.stream).messages[0].content.includes('用第二人称指代当前用户所扮演的角色'),'正式对白请求带有动作视角规则');
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
        await click('#roomExperienceClose');await click('#roomRelationshipCard');dialogueMode='normal';await click('#roomRelationRecheck');await wait(()=>node('#roomRelationRecheck').disabled&&StarlightMotion.isOpen(node('#roomExperienceOverlay')),'关系补判完成');
        await wait(async()=>(await work()).experience.relations[a].trust===26,'按来源补判');assert(node('#roomRelationRecheck').disabled,'已核对回合不可重复请求');
        await click('#roomExperienceClose');await actionLast('undo');await wait(async()=>(await work()).messages.length===beforeInvalid,'撤回用户回合');assert((await work()).experience.relations[a].trust===24,'撤回同步恢复关系维度');

        await newRoom('group','房间2.4回归 · 多人');
        directorEmpty=true;judgeMode='fail';
        const beforeDirector=calls.length;
        await send('大家在吗？');
        value=await work();
        assert(value.messages.length===2 && value.messages[1].speakerId===value.participants[0].id &&
            calls.slice(beforeDirector).join(',')==='director,dialogue,judge','导演空白时仍由在场角色接话且只请求一次关系核对');
        directorEmpty=false;judgeMode='normal';
        await send('@小夏 （按约归还书）');value=await work();const ids=value.participants.map(m=>m.id);assert(value.experience.relations[ids[0]].trust===2&&value.experience.relations[ids[1]].trust===0,'多人关系严格分角色');
        const scenesBefore=calls.filter(c=>c==='scene').length;await send('你们怎么看？');value=await work();assert(value.messages.every(m=>m.kind!=='narration'),'导演声称需要旁白也不会自动生成情景');assert(calls.filter(c=>c==='scene').length===scenesBefore,'对话路径不调用旁白模型');
        judgeMode='fail';const stateBefore=JSON.stringify(value.experience.relations);await send('（兑现新的约定）');value=await work();assert(JSON.stringify(value.experience.relations)===stateBefore,'关系服务失败不乱加减分');assert(value.messages.at(-1).role==='assistant','关系失败不丢正常对白');
        const final=await read();assert(JSON.stringify(final.agents.find(s=>s.id==='ui-story').conversations)===originalStory,'房间改进不污染剧情原文');assert(JSON.stringify(final.rooms.find(r=>r.id==='ui-room').messages)===originalRoom,'不同房间正式记录隔离');

        await newRoom('double','房间2.7.1 · 空回复修复');
        node('#thinkingModeSelect').value='enabled';node('#thinkingModeSelect').dispatchEvent(new Event('change'));
        judgeMode='normal';dialogueMode='normal';await send('（按约归还借书）');
        const normalRequest=requestBodies.findLast(b=>b.stream);
        assert(normalRequest.thinking.type==='enabled'&&normalRequest.reasoning_effort==='low','深度思考保留，短对白使用低推理强度');
        assert(normalRequest.max_tokens===16000,'不自动提高用户输出上限');
        assert(normalRequest.response_format.type==='json_object','正式对白使用JSON模式');
        assert(normalRequest.messages[0].content.includes('房间对白输出协议')&&!normalRequest.messages[0].content.includes('或JSON'),'实际请求已消除互斥协议');

        let before=await work();const originalReply=JSON.stringify(before.messages.at(-1));
        const priorRelations=JSON.stringify(before.experience.relations),beforeRegenerate=calls.length;
        dialogueMode='whitespace';await actionLast('regenerate');
        await wait(()=>calls.length>beforeRegenerate&&!node('#btnSend').classList.contains('stop-mode'),'空白重写恢复');await delay(220);
        value=await work();assert(JSON.stringify(value.messages.at(-1))===originalReply,'空白重生成保留完整原回复');
        assert(JSON.stringify(value.experience.relations)===priorRelations,'失败重写不撤销原关系');
        assert(calls.length===beforeRegenerate+2,'空白重写只补一次，均为空时不核对关系');

        for(const [mode,expected] of [['whitespace','重试后仍未返回正文'],['empty','重试后仍未返回正文'],['reasoning-only','已进行思考']]){
            before=await work();const count=calls.length;dialogueMode=mode;
            input('#messageInput','继续刚才的谈话。');await click('#btnSend');
            await wait(async()=>!node('#btnSend').classList.contains('stop-mode')&&(await work()).messages.length===before.messages.length+1,'失败仅保存本次输入');
            value=await work();assert(calls.length===count+(mode==='reasoning-only'?1:2),mode+'仅在正常结束但空白时补一次请求');
            assert(JSON.stringify(value.messages.slice(0,before.messages.length))===JSON.stringify(before.messages),mode+'保留原有消息');
            assert(JSON.stringify(value.sharedMemory)===JSON.stringify(before.sharedMemory)&&JSON.stringify(value.characterMemories)===JSON.stringify(before.characterMemories),mode+'不写入记忆');
            assert(JSON.stringify(value.experience.relations)===JSON.stringify(before.experience.relations),mode+'不结算关系');
            assert([...document.querySelectorAll('.toast')].some(el=>el.textContent.includes(expected)),mode+'显示可区分的错误原因');
        }
        assert(node('#apiTaskStatus').textContent.includes('最近返回：length')&&node('#apiTaskStatus').textContent.includes('思考 16000 tokens'),'请求分类显示最近一次失败的结束原因和思考用量');
        assert(!document.body.textContent.includes('PRIVATE_TEST_REASONING'),'思考原文不会显示在界面或诊断中');
        assert((await read()).roomMemorySettings.thinkingMode==='enabled','失败后仍保留用户的深度思考设置');
        dialogueMode='action';await send('（安静地等对方回应）');value=await work();
        assert(value.messages.at(-1).dialogue.speech===''&&value.messages.at(-1).content==='（她抬眼看向你）','仅动作回应正常保存并展示');

        await click('#btnRoomState');input('#roomSceneInstruction','延续教室内的情景，不改变地点。');sceneMode='normal';await click('#roomSceneGenerate');
        await wait(async()=>Boolean((await work()).experience.sceneDraft),'有效情景预览');
        const preview=JSON.stringify((await work()).experience.sceneDraft),formal=JSON.stringify((await work()).messages);
        const sceneRequest=requestBodies.at(-1);
        assert(sceneRequest.thinking.type==='disabled'&&sceneRequest.response_format.type==='json_object','情景独立使用非思考JSON请求');
        assert(sceneRequest.messages.some(m=>m.content.includes('narration 字段'))&&!sceneRequest.messages.some(m=>m.content.includes('直接输出正文')),'实际情景请求消除纯文本协议冲突');
        for(const mode of ['whitespace','empty']){
            sceneMode=mode;const count=calls.length;await click('#roomSceneGenerate');await wait(()=>node('#roomSceneCancel').hidden,'空情景失败恢复');await delay(220);
            value=await work();assert(JSON.stringify(value.experience.sceneDraft)===preview,'情景'+mode+'保留上一份预览');
            assert(JSON.stringify(value.messages)===formal&&calls.length===count+2,'情景'+mode+'只重试一次且不修改正式记录');
            assert(node('#roomExperienceNotice').textContent.includes('没有返回有效正文'),'情景'+mode+'两次均为空时提示未产生有效正文');
        }
        sceneMode='recover';const sceneCalls=calls.length;
        await click('#roomSceneGenerate');await wait(async()=>(await work()).experience.sceneDraft?.content==='灯亮了一盏。','情景空白后重新取回有效预览');
        assert(calls.length===sceneCalls+2 && JSON.stringify((await work()).messages)===formal,'情景重试成功也不自动采纳、计分或写入对话');
        await click('#roomExperienceClose');dialogueMode='normal';sceneMode='normal';
        const roomBeforePractice=JSON.stringify(await work());
        await click('#btnStyleLab');await click('#btnAddStyleProfile');
        input('#styleSourceTextInput','她抬起头：“你来啦？”窗边的书还摊着，她往旁边挪了半个座位。\n\n'.repeat(12));
        await click('#btnAnalyzeStyle');await wait(()=>!node('#btnAnalyzeStyle').disabled&&!node('#btnGenerateStylePreview').disabled,'准备试写档案');
        node('#stylePreviewModeSelect').value='practice';node('#stylePreviewModeSelect').dispatchEvent(new Event('change'));await settle();
        const profileId=node('#styleProfileList .style-profile-item.active').dataset.styleProfileId;
        let previewCallCount=calls.length;await click('#btnGenerateStylePreview');
        await wait(()=>!node('#btnGenerateStylePreview').disabled&&calls.length>previewCallCount,'房间实战试写');
        const practiceRequest=requestBodies.findLast(b=>b.stream);
        assert(practiceRequest.response_format.type==='json_object'&&practiceRequest.messages[0].content.includes('只输出含 expression'),'房间试写使用一致的结构化协议');
        assert(!node('#stylePreviewOutput').textContent.includes('"speech"')&&node('#stylePreviewOutput').textContent.includes('我记得'),'房间试写展示对白而不显示JSON字段');
        await delay(220);const savedPreview=(await read()).styleProfiles.find(p=>p.id===profileId).previewText;
        dialogueMode='whitespace';previewCallCount=calls.length;await click('#btnGenerateStylePreview');
        await wait(()=>!node('#btnGenerateStylePreview').disabled&&calls.length>previewCallCount,'失败试写恢复');await delay(220);
        assert((await read()).styleProfiles.find(p=>p.id===profileId).previewText===savedPreview,'空白试写保留原参考文本');
        assert(calls.length===previewCallCount+2,'空白试写最多补一次');
        dialogueMode='recover';previewCallCount=calls.length;await click('#btnGenerateStylePreview');
        await wait(async()=>!node('#btnGenerateStylePreview').disabled && (await read()).styleProfiles.find(p=>p.id===profileId).previewText==='我记得。','补发后试写恢复');
        assert(calls.length===previewCallCount+2 && !requestBodies.at(-1).response_format,'试写只对空白回复解除服务端格式约束');
        dialogueMode='normal';previewCallCount=calls.length;await click('#btnCompareStyle');
        await wait(()=>!node('#btnCompareStyle').disabled&&calls.length===previewCallCount+2,'房间A/B试写');
        assert([node('#styleCompareA'),node('#styleCompareB')].every(el=>el.textContent.includes('我记得')&&!el.textContent.includes('"speech"')),'房间A/B两份结果均解析展示');
        assert(requestBodies.slice(-2).every(b=>b.response_format.type==='json_object'),'房间A/B两份请求均为JSON模式');
        await delay(220);assert(JSON.stringify(await work())===roomBeforePractice,'试写和A/B对比不改变房间、场景、关系或记忆');
        await click('#btnStyleLabClose');
        await click('#btnChatSettings');
        assert(!node('#roomModalOverlay').querySelector('#roomDesireSettings, #roomRelationshipEvents'),'房间设置不含评判模块');
        await click('#btnRoomEditorClose');
        await click('#roomRelationshipCard');
        assert(node('#roomExperienceTitle').textContent==='关系与评判'&&node('#roomAssessmentPage').hidden===false,'进度卡打开独立评判页面');
        await click('[data-relation-tab="desire"]');
        assert(!node('#roomDesireEnabled').checked&&node('#roomDesireSettings .room-desire-fields').hidden,'独立性欲度默认关闭');
        assert(node('#roomPeakMode').disabled,'三维未满时禁用欲望时刻');
        await click('#roomDesireEnabled');
        input('#roomDesireNearField [name=prepareAt]','88');
        input('#roomNormalDesireSteps [data-step="action"]','先主动安排一段独处时间。');
        input('#roomDesireSettings [name="initialValue"]','15');
        input('.room-desire-base [name="growthPoints"]','11');
        await click('#roomAssessmentSave');
        assert(node('.room-desire-base [name="growthPoints"]').getAttribute('aria-invalid')==='true'&&node('.assessment-field-error').textContent.includes('1–10'),'错误对应到具体数值栏位');
        input('.room-desire-base [name="growthPoints"]','4');
        await click('#btnAddDesireRule');
        input('.room-desire-rule:first-child [name="trust"]','70');
        input('.room-desire-rule:first-child [name="hoursPerPoint"]','3');
        input('.room-desire-rule:first-child [name="growthPoints"]','2');
        await click('#btnAddDesireRule');
        input('.room-desire-rule:nth-child(2) [name="affection"]','60');
        input('.room-desire-rule:nth-child(2) [name="resetValue"]','21');
        await click('#btnAddDesireRule');
        input('.room-desire-rule:nth-child(3) [name="familiarity"]','50');
        input('.room-desire-rule:nth-child(3) [name="resetValue"]','11');
        await click('.room-desire-rule:nth-child(3) .desire-rule-up');
        assert(node('.room-desire-rule:nth-child(2) [name="familiarity"]').value==='50','移动规则保留输入值');
        await click('#roomAssessmentSave');
        await wait(async()=> (await work()).desireEnabled&& !node('#roomAssessmentSave').disabled,'保存性欲度设置');
        assert((await work()).desireSettings.prepareAt===88 && (await work()).desireSettings.steps[0].action.includes('独处时间'),'可保存准备阈值和自定义步骤');
        await click('[data-relation-tab="events"]');
        await click('#btnAddRelationshipEvent');
        input('.node-description','主动分享一件往事');
        input('[data-node-threshold="trust"]','40');
        input('[data-node-threshold="desire"]','12');
        await click('#roomAssessmentSave');
        await wait(async()=>(await work()).relationshipEvents?.[0]?.thresholds.desire===12 && !node('#roomAssessmentSave').disabled,'保存各维度的独立门槛');
        scorecard=node('#roomRelationshipCard');
        assert(scorecard.querySelectorAll('[data-dimension]').length===4,'启用后在同一浮卡显示第四维');
        assert((await work()).desireSettings.rules.map(rule=>Object.keys(rule.thresholds)[0]).join(' ')==='trust familiarity affection','保存任意多条有顺序的阈值规则');
        assert((await work()).experience.desire.value===15,'首次开启使用配置的初始值');
        assert((await work()).relationshipEvents[0].thresholds.trust===40,'保存信任门槛且保留空缺项');
        await click('[data-relation-tab="profile"]');
        assert(node('#roomRelationContent').textContent.includes('待解锁')&&node('#roomRelationContent').textContent.includes('主动分享一件往事'),'关系档案展示事件与状态');
        await click('#roomExperienceClose');
        const beforeDesireTurn=calls.filter(call=>call==='judge').length;
        await send('三小时后，门外的喧闹声停了。');
        value=await work();
        assert(value.experience.desire.value===19,'同一轮按新增长速度累计时间与环境变化');
        assert(calls.filter(call=>call==='judge').length===beforeDesireTurn+1,'环境变化复用现有模型请求');
        await click('#roomRelationshipCard');
        if(!node('#roomAuthorView').checked)await click('#roomAuthorView');
        for(const key of ['familiarity','trust','affection'])input('[data-relation-value="'+key+'"]','100');
        await click('#roomRelationSave');
        await wait(()=>!node('#roomExperienceClose').disabled,'保存三维校准');
        await click('[data-relation-tab="desire"]');
        assert(!node('#roomPeakMode').disabled,'三维全满后可开启欲望时刻');
        await click('#roomPeakMode');
        await wait(async()=> (await work()).experience.desire.peakMode && !node('#roomPeakMode').disabled,'启用欲望时刻');
        assert(node('#roomRelationshipCard [data-dimension=desire] strong').textContent==='100','开启后浮卡显示 100');
        await click('#roomExperienceClose');
        await send('六小时后，外面的雨还在下。');
        assert((await work()).experience.desire.value===19,'开启时冻结原有分数');
        await click('#roomRelationshipCard');
        await click('[data-relation-tab="desire"]');
        await click('#roomPeakMode');
        await wait(async()=> !(await work()).experience.desire.peakMode && !node('#roomPeakMode').disabled,'关闭欲望时刻');
        assert(node('#roomRelationshipCard [data-dimension=desire] strong').textContent==='19','关闭后浮卡恢复原分');
        input('#roomDesireSettings [name=currentValue]','100');
        await click('#roomAssessmentSave');
        await wait(async()=>(await work()).experience.desire.value===100&&!node('#roomAssessmentSave').disabled,'设置满分以检查步骤和回落');
        await click('[data-relation-tab="profile"]');
        assert(node('#roomRelationContent').textContent.includes('待推进 · 准备')&&node('#roomRelationContent').textContent.includes('先主动安排一段独处时间。'),'档案公开当前步骤和生效指令');
        await click('#roomExperienceClose');
        await send('我在原地等你回来。');
        await actionLast('confirm-step');
        await wait(async()=>(await work()).experience.desire.stepsDone.normal.includes('prepare'),'从原消息手动确认步骤');
        await send('继续接回刚才的事情。');
        await actionLast('confirm-release');
        await wait(async()=>(await work()).experience.desire.value===8,'从原消息手动确认遗漏的回落');
        await actionLast('undo');
        await wait(async()=>(await work()).experience.desire.value===100,'撤回后恢复结算前分数');
        return {checks,roomId:currentId};
    }finally{if(heldScene)heldScene();window.fetch=savedFetch;document.activeElement?.blur();}
};
