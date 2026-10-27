(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.StarlightRoomUI=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
    'use strict';
    function create(options){
        const {document:doc,engine:E,motion:M,ui:UI}=options;
        const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const overlay=doc.createElement('div');overlay.id='roomExperienceOverlay';overlay.className='modal-overlay room-experience-overlay';overlay.style.display='none';
        overlay.innerHTML=`<section class="room-experience-page" aria-label="房间情景与关系"><header class="room-experience-header"><div><h3 id="roomExperienceTitle">房间现场</h3><p>预览与正式记录分开</p></div><button type="button" class="mini-action-btn" id="roomExperienceClose">关闭</button></header><nav class="room-experience-tabs" aria-label="房间工具"><button type="button" data-room-tab="scene">情景预览</button><button type="button" data-room-tab="relations">关系档案</button><button type="button" data-room-tab="drafts">待修正回复</button></nav><div class="room-experience-scroll"><p id="roomExperienceNotice" role="status" hidden></p><section id="roomScenePage"><p class="room-note">这里的内容采纳前不进入正式对话、记忆或关系评分。不会自动切换场景，也不会代替用户作选择。</p><label>本次情景要求<textarea id="roomSceneInstruction" rows="3" placeholder="例如：推进到放学后，仍留在教室，不加入新冲突"></textarea></label><div class="room-inline"><button type="button" id="roomSceneGenerate" class="btn-confirm">生成预览</button><button type="button" id="roomSceneManual" class="mini-action-btn">手动写情景</button><button type="button" id="roomSceneCancel" class="mini-action-btn" hidden>取消生成</button></div><section id="roomSceneCandidate" hidden><div class="room-section-heading"><h4>待采纳情景 · 可直接修改</h4><span id="roomSceneStale"></span></div><label>正式旁白正文<textarea id="roomSceneText" rows="6"></textarea></label><div class="room-field-grid"><label>时间<input id="roomSceneTime" maxlength="200"></label><label>地点<input id="roomScenePlace" maxlength="300"></label></div><label>当前场景摘要<textarea id="roomSceneSummary" rows="3" maxlength="5000"></textarea></label><label>相关物件<textarea id="roomSceneObjects" rows="2" maxlength="3000"></textarea></label><label>未完成事项<textarea id="roomScenePending" rows="2" maxlength="3000"></textarea></label><fieldset class="room-present"><legend>采纳后在场的角色</legend><div id="roomScenePresent"></div></fieldset></section></section><section id="roomRelationsPage" hidden><label class="room-check"><input type="checkbox" id="roomAuthorView">作者视图：查看、校准关系与证据（默认沉浸视图）</label><p class="room-note">每名角色独立判断。信任、好感与当下情绪分开；不靠聊天轮数自动攻略。作者校准不会被当作角色亲历事件。</p><label>查看角色<select id="roomRelationMember"></select></label><div id="roomRelationContent"></div></section><section id="roomDialogueDraftsPage" hidden><p class="room-note">不合格式的模型输出留在这里，不进入正式消息或记忆；只在你点击采纳后成为人物回复，不自动重试付费请求。</p><div id="roomDialogueDraftList"></div></section></div><footer class="room-experience-actions"><span id="roomExperienceFootnote">正式记录不受未采纳预览影响</span><button type="button" class="btn-confirm" id="roomSceneAccept">采纳情景并回到对话</button></footer></section>`;
        doc.body.appendChild(overlay);
        const el=id=>overlay.querySelector('#'+id);
        let ownerId=null,tab='scene',active=null,committing=false,memberId=null,historyCount=30;
        const room=()=>{const value=options.getRoom();return value?.id===ownerId?value:null;};
        const persist=()=>{const promise=options.save();promise?.catch?.(()=>{});};
        const message=(value,error=false)=>{el('roomExperienceNotice').hidden=!value;el('roomExperienceNotice').textContent=value||'';el('roomExperienceNotice').classList.toggle('error',error);};
        function refreshComposer(load=false){
            const value=options.getRoom();if(!value)return;
            const e=E.ensure(value),isScene=e.mode==='scene';
            const dialogue=doc.getElementById('btnRoomDialogue'),scene=doc.getElementById('btnContinueScene');
            dialogue.setAttribute('aria-pressed',String(!isScene));scene.setAttribute('aria-pressed',String(isScene));
            dialogue.classList.toggle('active',!isScene);scene.classList.toggle('active',isScene);
            doc.getElementById('roomTargetSelect').hidden=isScene;
            doc.getElementById('roomSceneModeHint').hidden=!isScene;
            for(const button of [dialogue,scene])button.disabled=options.isBusy()||committing;
            const summary=[e.scene.time,e.scene.place].filter(Boolean).join(' · ')||e.scene.summary||'当前场景 · 点击查看';
            const status=doc.getElementById('btnRoomState');status.textContent=summary;status.title=summary;
            doc.getElementById('btnRoomJournal').textContent=e.candidates.length?`关系／待修正 ${e.candidates.length}`:'关系档案';
            doc.getElementById('intimacyPanel').hidden=value.roomType!=='double'||!e.authorView;
            if(load)options.setComposer(E.composerValue(value));
            doc.getElementById('messageInput').placeholder=isScene?'输入情景要求，发送后先预览，不自动采纳':'输入对白…（可用 @角色名 指定回应）';
        }
        function setMode(mode){
            const value=options.getRoom();if(!value||options.isBusy()||committing)return;
            E.setComposerValue(value,doc.getElementById('messageInput').value);E.ensure(value).mode=mode;
            refreshComposer(true);options.updateSend();persist();
        }
        function close(){
            if(committing)return options.notify('正在保存，请稍候');
            if(active){const previous=active;active=null;previous.controller.abort();}
            UI.blurEditorWithin?.(overlay);M.setVisible(overlay,false);renderBusy();
        }
        function open(which='scene'){
            const value=options.getRoom();if(!value)return;
            if(options.isBusy()||committing)return options.notify('请先等待当前生成或保存完成');
            if(ownerId!==value.id){if(active){active.controller.abort();active=null;}ownerId=value.id;memberId=value.participants[0]?.id;}
            UI.blurEditorWithin?.(doc.getElementById('inputArea'));
            tab=which;historyCount=30;message('');render();overlay.querySelector('.room-experience-scroll').scrollTop=0;M.setVisible(overlay,true,{kind:'page'});
        }
        function renderBusy(){
            const busy=Boolean(active)||committing;
            overlay.setAttribute('aria-busy',String(busy));
            for(const button of overlay.querySelectorAll('button:not(#roomExperienceClose):not(#roomSceneCancel)'))button.disabled=busy;
            for(const input of overlay.querySelectorAll('input,textarea,select'))input.disabled=busy;
            el('roomExperienceClose').disabled=committing;el('roomSceneCancel').hidden=!active;el('roomSceneCancel').disabled=committing;
            const value=room(),candidate=value&&E.ensure(value).sceneDraft;
            el('roomSceneAccept').disabled=busy||!candidate||!candidate.content?.trim()||candidate.stamp!==E.stamp(value);
            const recheck=el('roomRelationRecheck');
            if(recheck&&value&&!busy){
                const turnId=[...value.messages].reverse().find(m=>m.role==='user'&&m.turnId)?.turnId;
                const checked=turnId&&value.turnEffects?.[turnId];
                const pending=turnId&&E.ensure(value).candidates.some(d=>d.turnId===turnId);
                const enabled=value.participants.some(m=>E.policy(m).enabled&&value.messages.some(v=>v.turnId===turnId&&v.speakerId===m.id));
                recheck.disabled=!turnId||!enabled||Boolean(checked)||pending;
                recheck.textContent=checked?'上一轮已核对，不重复请求':pending?'请先处理本轮待修正回复':!enabled?'没有待核对的角色回合':'核对上一轮关系（一次请求）';
            }
            refreshComposer();
        }
        function render(){
            const value=room();if(!value)return;
            el('roomExperienceTitle').textContent=value.name;
            for(const button of overlay.querySelectorAll('[data-room-tab]')){button.classList.toggle('active',button.dataset.roomTab===tab);button.setAttribute('aria-current',button.dataset.roomTab===tab?'page':'false');}
            el('roomScenePage').hidden=tab!=='scene';el('roomRelationsPage').hidden=tab!=='relations';el('roomDialogueDraftsPage').hidden=tab!=='drafts';el('roomSceneAccept').hidden=tab!=='scene';overlay.querySelector('.room-experience-actions').hidden=tab!=='scene';
            if(tab==='scene')renderScene(value);else if(tab==='relations')renderRelations(value);else renderDrafts(value);
            renderBusy();
        }
        function renderScene(value){
            const e=E.ensure(value),candidate=e.sceneDraft;
            el('roomSceneInstruction').value=e.instruction;
            el('roomSceneCandidate').hidden=!candidate;
            if(!candidate){el('roomSceneStale').textContent='';return;}
            el('roomSceneText').value=candidate.content||'';
            for(const field of ['Time','Place','Summary','Objects','Pending'])el('roomScene'+field).value=candidate.state[field.toLowerCase()]||'';
            el('roomScenePresent').innerHTML=value.participants.map(m=>`<label class="room-check"><input type="checkbox" value="${escape(m.id)}" ${candidate.state.presentIds.includes(m.id)?'checked':''}>${escape(m.name)}${m.enabled===false?'（设定中未启用）':''}</label>`).join('');
            el('roomSceneStale').textContent=candidate.stamp!==E.stamp(value)?'来源已变化，请重新生成或手动重建':'';
        }
        function readCandidate(){
            const value=room(),candidate=value&&E.ensure(value).sceneDraft;if(!candidate)return;
            candidate.content=el('roomSceneText').value;
            for(const field of ['Time','Place','Summary','Objects','Pending'])candidate.state[field.toLowerCase()]=el('roomScene'+field).value;
            candidate.state.presentIds=[...el('roomScenePresent').querySelectorAll('input:checked')].map(input=>input.value);
            persist();renderBusy();
        }
        async function generate(){
            const value=room();if(!value||active||committing||options.isBusy())return;
            const e=E.ensure(value);e.instruction=el('roomSceneInstruction').value;persist();
            const sourceStamp=E.stamp(value),token={controller:new AbortController(),ownerId:value.id};active=token;message('正在生成独立情景预览，旧预览仍保留。');renderBusy();
            try{
                const result=await options.generateScene(value,e.instruction||'让当前场景自然推进一小步，不替用户作选择。',token.controller.signal);
                if(active!==token||room()!==value)return;
                if(E.stamp(value)!==sourceStamp)throw new Error('生成期间房间来源已变化，结果未覆盖旧预览');
                e.sceneDraft=E.sceneCandidate(value,result,e.instruction,sourceStamp);persist();message('预览已生成，请核对正文、场景和在场角色后采纳。');renderScene(value);
            }catch(error){if(active===token)message(error.name==='AbortError'?'已取消，原预览保留。':'生成失败：'+error.message,true);}
            finally{if(active===token){active=null;renderBusy();}}
        }
        async function commit(action,after){
            const value=room();if(!value||active||committing||options.isBusy())return;
            committing=true;renderBusy();
            try{await options.commit(value,action);message('已保存。');after?.();}
            catch(error){message('保存失败：'+error.message,true);}
            finally{committing=false;render();options.refresh();}
        }
        function renderRelations(value){
            const e=E.ensure(value);el('roomAuthorView').checked=e.authorView;
            if(!value.participants.some(m=>m.id===memberId))memberId=value.participants[0]?.id;
            el('roomRelationMember').innerHTML=value.participants.map(m=>`<option value="${escape(m.id)}" ${m.id===memberId?'selected':''}>${escape(m.name)}</option>`).join('');
            const member=value.participants.find(m=>m.id===memberId),body=el('roomRelationContent');if(!member){body.textContent='尚无角色。';return;}
            const pending=e.profileDrafts[memberId];
            const r={...e.relations[memberId],...pending},p={...E.policy(member),...pending?.policy};
            for(const field of ['familiarity','trust','affection'])r[field]=Number.isFinite(Number(r[field]))?Math.max(0,Math.min(100,Number(r[field]))):0;
            if(!e.authorView){body.innerHTML='<div class="room-note">沉浸视图不展示分数、心理或后台评分依据。关系通过人物的回应自然体现；需要编辑时可开启上方作者视图。</div>';return;}
            const history=e.relationHistory.filter(v=>v.memberId===memberId).slice().reverse().map(event=>({...event,
                sources:Array.isArray(event.sources)?event.sources.filter(s=>s&&typeof s.id==='string'&&typeof s.quote==='string').map(s=>({id:s.id,quote:s.quote.slice(0,2000)})):[],
                delta:event.delta&&typeof event.delta==='object'?Object.fromEntries(Object.entries(event.delta).filter(([key])=>['familiarity','trust','affection'].includes(key)).map(([key,n])=>[key,Number.isFinite(Number(n))?Number(n):0])):null}));
            body.innerHTML=`<p class="room-note">${r.known?'已记录新维度状态':'新维度尚未积累证据；旧关系照常继承，不凭空补经历。'}${value.intimacy?' 原亲密度 '+value.intimacy.value+'/200 保留。':''}</p><button type="button" class="mini-action-btn" id="roomRelationRecheck">核对上一轮关系（一次请求）</button><div class="room-field-grid room-stats">${[['familiarity','熟悉'],['trust','信任'],['affection','好感']].map(([key,label])=>`<label>${label}（0—100）<input type="number" min="0" max="100" data-relation-value="${key}" value="${r[key]}"></label>`).join('')}</div><label>当前情绪<input id="roomRelationEmotion" value="${escape(r.emotion)}" maxlength="200"></label><label>既有关系／作者确认的基线<textarea id="roomRelationBaseline" rows="3">${escape(r.baseline||p.baseline)}</textarea></label><label>这个人物重视什么<textarea id="roomRelationPreferences" rows="3">${escape(p.preferences)}</textarea></label><label>这个人物的界限／顾虑<textarea id="roomRelationBoundaries" rows="3">${escape(p.boundaries)}</textarea></label><label>关键关系转折需要什么经历<textarea id="roomRelationConditions" rows="3">${escape(p.conditions)}</textarea></label><label class="room-check"><input id="roomRelationEnabled" type="checkbox" ${p.enabled?'checked':''}>为此角色核对关系证据</label><button type="button" class="btn-confirm" id="roomRelationSave">保存作者校准与规则</button><p class="room-note">手动校准会留在关系档案中，不编造成剧情事件。既有自定义关系节点仍在房间设定中编辑。</p><h4>关系依据与来源</h4><div class="room-evidence-list">${history.slice(0,historyCount).map(event=>`<article><strong>${escape(event.kind==='author'?'作者校准':event.tag||'本轮判定')}</strong><p>${escape(event.reason||'无额外说明')}</p>${event.delta?`<small>${Object.entries(event.delta).map(([key,n])=>`${({familiarity:'熟悉',trust:'信任',affection:'好感'})[key]} ${n>0?'+':''}${n}`).join(' · ')}</small>`:''}${(event.sources||[]).map(ref=>`<button type="button" class="room-source" data-room-source="${escape(ref.id)}">${escape(ref.quote)}</button>`).join('')}</article>`).join('')||'<p class="room-note">还没有来源判定。普通交流可以保持原关系；API 判定失败不会凭空改变状态。</p>'}</div>${history.length>historyCount?'<button type="button" id="roomRelationMore" class="mini-action-btn">查看更多依据</button>':''}`;
            el('roomRelationRecheck').onclick=async()=>{
                if(active||committing||options.isBusy())return;
                const source=E.stamp(value),token={controller:new AbortController(),kind:'relations'};active=token;message('正在核对；关闭页面可取消，本轮不重复计分。');renderBusy();
                try{const result=await options.recheckRelations(value,token.controller.signal);if(active!==token||room()!==value)return;
                    if(E.stamp(value)!==source)throw new Error('房间来源已变化，未采纳旧判定');
                    active=null;await commit(current=>options.applyRecheck(current,result));
                }catch(error){if(active===token)message(error.name==='AbortError'?'已取消，原关系保留。':error.message,true);}
                finally{if(active===token){active=null;renderBusy();}}
            };
            el('roomRelationSave').onclick=()=>{
                const values={emotion:el('roomRelationEmotion').value,policy:{enabled:el('roomRelationEnabled').checked,baseline:el('roomRelationBaseline').value,preferences:el('roomRelationPreferences').value,boundaries:el('roomRelationBoundaries').value,conditions:el('roomRelationConditions').value}};
                for(const input of body.querySelectorAll('[data-relation-value]')){
                    const n=Number(input.value);if(!Number.isFinite(n)||n<0||n>100)return message('关系数值必须在 0—100 之间。',true);values[input.dataset.relationValue]=n;
                }
                commit(current=>{E.calibrate(current,memberId,values);delete E.ensure(current).profileDrafts[memberId];});
            };
            const keepDraft=()=>{
                const values={emotion:el('roomRelationEmotion').value,baseline:el('roomRelationBaseline').value,policy:{enabled:el('roomRelationEnabled').checked,baseline:el('roomRelationBaseline').value,preferences:el('roomRelationPreferences').value,boundaries:el('roomRelationBoundaries').value,conditions:el('roomRelationConditions').value}};
                for(const input of body.querySelectorAll('[data-relation-value]'))values[input.dataset.relationValue]=input.value;
                e.profileDrafts[memberId]=values;persist();
            };
            for(const input of body.querySelectorAll('input,textarea')){input.addEventListener('input',keepDraft);input.addEventListener('change',keepDraft);}
            body.querySelectorAll('[data-room-source]').forEach(button=>button.onclick=()=>{close();options.locate(button.dataset.roomSource);});
            if(el('roomRelationMore'))el('roomRelationMore').onclick=()=>{historyCount+=30;renderRelations(value);};
        }
        function renderDrafts(value){
            const drafts=E.ensure(value).candidates,body=el('roomDialogueDraftList');
            body.innerHTML=drafts.map(d=>{
                const member=value.participants.find(m=>m.id===d.memberId);let parsed={speech:'',expression:''};
                try{parsed=E.parseDialogue(d.raw);}catch(error){try{const raw=JSON.parse(d.raw);parsed={speech:typeof raw.speech==='string'?raw.speech:'',expression:typeof raw.expression==='string'?raw.expression:''};}catch(ignored){parsed.speech=d.raw;}}
                return `<article class="room-candidate" data-room-draft="${escape(d.id)}"><h4>${escape(member?.name||'已移除角色')}</h4><p>${escape(d.reason)}</p><label>人物说的话<textarea data-draft-speech rows="5">${escape(parsed.speech)}</textarea></label><label>简短可见神态（可留空）<input data-draft-expression value="${escape(parsed.expression)}"></label><details><summary>查看模型原稿</summary><pre>${escape(d.raw)}</pre></details><div class="room-inline"><button type="button" data-draft-accept class="btn-confirm">采纳修正稿</button><button type="button" data-draft-delete class="mini-action-btn">删除待修正稿</button></div></article>`;
            }).join('')||'<p class="room-note">没有待修正的回复。</p>';
            body.querySelectorAll('[data-room-draft]').forEach(card=>{
                const candidate=drafts.find(d=>d.id===card.dataset.roomDraft);
                card.querySelector('[data-draft-delete]').onclick=()=>commit(current=>{E.ensure(current).candidates=E.ensure(current).candidates.filter(d=>d.id!==candidate.id);});
                card.querySelector('[data-draft-accept]').onclick=()=>{
                    let parsed;try{parsed=E.parseDialogue({speech:card.querySelector('[data-draft-speech]').value,expression:card.querySelector('[data-draft-expression]').value});}catch(error){return message(error.message,true);}
                    commit(current=>options.adoptDialogue(current,candidate,parsed));
                };
            });
        }
        doc.getElementById('btnRoomDialogue').onclick=()=>setMode('dialogue');
        doc.getElementById('btnContinueScene').onclick=()=>setMode('scene');
        doc.getElementById('btnRoomState').onclick=()=>open('scene');
        doc.getElementById('btnRoomJournal').onclick=()=>open('relations');
        el('roomExperienceClose').onclick=close;
        overlay.querySelectorAll('[data-room-tab]').forEach(button=>button.onclick=()=>{if(active||committing)return;tab=button.dataset.roomTab;message('');render();overlay.querySelector('.room-experience-scroll').scrollTop=0;});
        el('roomSceneInstruction').oninput=()=>{const value=room();if(value){E.ensure(value).instruction=el('roomSceneInstruction').value;if(E.ensure(value).mode==='scene')options.setComposer(E.ensure(value).instruction);persist();}};
        for(const control of overlay.querySelectorAll('#roomSceneCandidate textarea,#roomSceneCandidate input'))control.addEventListener('input',readCandidate);
        el('roomScenePresent').addEventListener('change',readCandidate);
        el('roomSceneGenerate').onclick=generate;
        el('roomSceneCancel').onclick=()=>{if(active){active.controller.abort();active=null;message('已取消，原预览保留。');renderBusy();}};
        el('roomSceneManual').onclick=()=>{
            const value=room();if(!value||active||committing)return;
            E.ensure(value).sceneDraft={id:'manual_'+Date.now(),content:'',instruction:el('roomSceneInstruction').value,state:E.clone(E.ensure(value).scene),stamp:E.stamp(value),createdAt:Date.now()};persist();renderScene(value);renderBusy();
        };
        el('roomSceneAccept').onclick=()=>{readCandidate();commit(current=>E.acceptScene(current,E.ensure(current).sceneDraft),()=>{refreshComposer(true);message('情景已采纳，已回到对话推进。');});};
        el('roomAuthorView').onchange=()=>{const value=room();if(value){E.ensure(value).authorView=el('roomAuthorView').checked;persist();renderRelations(value);refreshComposer();}};
        el('roomRelationMember').onchange=()=>{memberId=el('roomRelationMember').value;historyCount=30;renderRelations(room());};
        return {overlay,open,close,setMode,refreshComposer,isLocked:()=>committing,isActive:()=>Boolean(active),
            refresh:()=>{refreshComposer();if(room()&&M.isOpen(overlay)&&!active&&!committing)render();},
            preview:()=>{open('scene');if(room())return generate();},showDrafts:()=>open('drafts')};
    }
    return {create};
});
