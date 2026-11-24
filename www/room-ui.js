(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.StarlightRoomUI=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
    'use strict';
    const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function mountDesireSettings(section, engine, desire, onToggle) {
        const toggle=section.querySelector('#roomDesireEnabled');
        const fields=section.querySelector('.room-desire-fields');
        const ruleList=section.querySelector('.room-desire-rules');
        let savedConfig=desire.settings();
        const field=(name,label,[min,max],value='',step='any',placeholder='')=>
            `<label>${label}<input type="number" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}" placeholder="${placeholder}"></label>`;
        function readField(owner,name,required=false) {
            const input=owner.querySelector('[name="'+name+'"]');
            if(!input.validity.valid||(!input.value&&required)) throw new Error('请检查性欲度设置中的数值范围');
            return input.value===''?undefined:input.valueAsNumber;
        }
        function updateOrder() {
            const rules=[...ruleList.children];
            rules.forEach((rule,index)=>{
                rule.querySelector('legend').textContent='规则 '+(index+1);
                rule.querySelector('.desire-rule-up').disabled=index===0;
                rule.querySelector('.desire-rule-down').disabled=index===rules.length-1;
            });
        }
        function addRule(rule={}) {
            const row=section.ownerDocument.createElement('fieldset');
            row.className='room-desire-rule';
            row.innerHTML=`<legend></legend>
                <div class="node-criteria">${desire.RELATION_KEYS.map(key=>field(key,engine.RELATION_LABELS[key]+'门槛',
                    [0,100],rule.thresholds?.[key]??'','1','不限')).join('')}</div>
                <div class="node-criteria">${field('hoursPerPoint','每加 1 分需经过的剧情小时',desire.LIMITS.hoursPerPoint,rule.hoursPerPoint??'','any','用基础值')}
                ${field('resetValue','事后回到（分）',desire.LIMITS.resetValue,rule.resetValue??'','1','用基础值')}</div>
                <div class="room-inline">
                    <button type="button" class="mini-action-btn desire-rule-up" aria-label="上移规则">↑ 上移</button>
                    <button type="button" class="mini-action-btn desire-rule-down" aria-label="下移规则">↓ 下移</button>
                    <button type="button" class="mini-action-btn danger desire-rule-remove">删除规则</button>
                </div>`;
            row.querySelector('.desire-rule-up').onclick=()=>{row.previousElementSibling?.before(row);updateOrder();};
            row.querySelector('.desire-rule-down').onclick=()=>{row.nextElementSibling?.after(row);updateOrder();};
            row.querySelector('.desire-rule-remove').onclick=()=>{row.remove();updateOrder();};
            ruleList.append(row);
            updateOrder();
        }
        function open(room) {
            const config=desire.settings(room?.desireSettings);
            savedConfig=config;
            const present=room&&engine.ensure(room).desire;
            toggle.checked=desire.active(room);
            fields.hidden=!toggle.checked;
            section.querySelector('.room-desire-base').innerHTML=
                field('initialValue','初始值（分）',desire.LIMITS.initialValue,config.initialValue,'1')+
                field('hoursPerPoint','每加 1 分需经过的剧情小时',desire.LIMITS.hoursPerPoint,config.hoursPerPoint)+
                field('sensitivity','环境敏感度（%）',desire.LIMITS.sensitivity,config.sensitivity,'1')+
                field('resetValue','事后回到（分）',desire.LIMITS.resetValue,config.resetValue,'1')+
                (present?.initialized?field('currentValue','校准当前值',[0,100],'','1','当前 '+Math.floor(present.value)):'');
            section.querySelector('[name="peakBehavior"]').value=config.peakBehavior;
            ruleList.replaceChildren();
            config.rules.forEach(addRule);
        }
        section.querySelector('#btnAddDesireRule').onclick=()=>addRule();
        toggle.onchange=()=>{fields.hidden=!toggle.checked;onToggle();};
        function read(){
            if(!toggle.checked)return {config:savedConfig};
            const base=section.querySelector('.room-desire-base');
            const input=Object.fromEntries(Object.keys(desire.LIMITS).map(key=>[key,readField(base,key,true)]));
            const rules=[...ruleList.children].flatMap((row,index)=>{
                const thresholds=Object.fromEntries(desire.RELATION_KEYS.flatMap(key=>{
                    const value=readField(row,key);
                    return value===undefined?[]:[[key,value]];
                }));
                const hoursPerPoint=readField(row,'hoursPerPoint'),resetValue=readField(row,'resetValue');
                const hasThreshold=Object.keys(thresholds).length>0;
                const hasSetting=hoursPerPoint!==undefined||resetValue!==undefined;
                if(!hasThreshold&&!hasSetting)return [];
                if(!hasThreshold||!hasSetting)throw new Error('性欲度规则 '+(index+1)+' 需要至少一项关系门槛和一项覆盖设置');
                return [{thresholds,hoursPerPoint,resetValue}];
            });
            return {config:desire.settings({...input,rules,peakBehavior:section.querySelector('[name="peakBehavior"]').value}),
                current:base.querySelector('[name="currentValue"]')?readField(base,'currentValue'):undefined};
        }
        return {open,read,setType:type=>section.hidden=type!=='double'};
    }

    function renderScorecard(card, room, engine) {
        card.hidden=room?.roomType!=='double';
        if(card.hidden){card.replaceChildren();return;}
        const experience=engine.ensure(room),relation=experience.relations[room.participants[0]?.id];
        const scores=engine.dimensions(room).map(key=>{
            if(key==='desire'){
                const value=experience.desire.value;
                return {key,label:engine.RELATION_LABELS[key],known:true,value,readout:String(Math.floor(value))};
            }
            const label=engine.RELATION_LABELS[key], known=relation?.knownDimensions.includes(key);
            const value=known?relation[key]:0;
            return {key,label,known,value,readout:known?String(value):'—'};
        });
        card.setAttribute('aria-label','查看关系进度，'+scores.map(x=>x.label+(x.known?x.readout+' 分':'待评估')).join('，'));
        const html=scores.map(({key,label,value,readout})=>`<span class="relationship-score" data-dimension="${key}">
            <span class="relationship-score-label">${label}<strong>${readout}</strong></span>
            <span class="relationship-track"><span style="width:${value}%"></span></span></span>`).join('');
        if(card.innerHTML!==html)card.innerHTML=html;
    }

    function create(options){
        const {document:doc,engine:E,motion:M,ui:UI}=options;
        const overlay=doc.createElement('div');overlay.id='roomExperienceOverlay';overlay.className='modal-overlay room-experience-overlay';overlay.style.display='none';
        overlay.innerHTML=`<section class="room-experience-page" aria-label="房间情景与关系"><header class="room-experience-header"><div><h3 id="roomExperienceTitle">房间现场</h3><p>预览与正式记录分开</p></div><button type="button" class="mini-action-btn" id="roomExperienceClose">关闭</button></header><nav class="room-experience-tabs" aria-label="房间工具"><button type="button" data-room-tab="scene">情景预览</button><button type="button" data-room-tab="relations">关系档案</button><button type="button" data-room-tab="drafts">待修正回复</button></nav><div class="room-experience-scroll"><p id="roomExperienceNotice" role="status" hidden></p><section id="roomScenePage"><p class="room-note">这里的内容采纳前不进入正式对话、记忆或关系评分。不会自动切换场景，也不会代替用户作选择。</p><label>本次情景要求<textarea id="roomSceneInstruction" rows="3" placeholder="例如：推进到放学后，仍留在教室，不加入新冲突"></textarea></label><div class="room-inline"><button type="button" id="roomSceneGenerate" class="btn-confirm">生成预览</button><button type="button" id="roomSceneManual" class="mini-action-btn">手动写情景</button><button type="button" id="roomSceneCancel" class="mini-action-btn" hidden>取消生成</button></div><section id="roomSceneCandidate" hidden><div class="room-section-heading"><h4>待采纳情景 · 可直接修改</h4><span id="roomSceneStale"></span></div><label>正式旁白正文<textarea id="roomSceneText" rows="6"></textarea></label><div class="room-field-grid"><label>时间<input id="roomSceneTime" maxlength="200"></label><label>地点<input id="roomScenePlace" maxlength="300"></label></div><label>当前场景摘要<textarea id="roomSceneSummary" rows="3" maxlength="5000"></textarea></label><label>相关物件<textarea id="roomSceneObjects" rows="2" maxlength="3000"></textarea></label><label>未完成事项<textarea id="roomScenePending" rows="2" maxlength="3000"></textarea></label><fieldset class="room-present"><legend>采纳后在场的角色</legend><div id="roomScenePresent"></div></fieldset></section></section><section id="roomRelationsPage" hidden><label class="room-check"><input type="checkbox" id="roomAuthorView">作者视图：校准关系与编辑判定规则</label><p class="room-note">每名角色独立判断。信任、好感与当下情绪分开；不靠聊天轮数自动攻略。作者校准不会被当作角色亲历事件。</p><label>查看角色<select id="roomRelationMember"></select></label><div id="roomRelationContent"></div></section><section id="roomDialogueDraftsPage" hidden><p class="room-note">可以手动编辑后采纳，也可以直接修复并采纳原稿。自动修复优先使用本地整理，需要时会调用一次模型。</p><div id="roomDialogueDraftList"></div></section></div><footer class="room-experience-actions"><span id="roomExperienceFootnote">正式记录不受未采纳预览影响</span><button type="button" class="btn-confirm" id="roomSceneAccept">采纳情景并回到对话</button></footer></section>`;
        overlay.querySelector('#roomSceneCandidate').insertAdjacentHTML('beforeend',`<details id="roomSceneDesire" class="room-scene-desire" hidden>
            <summary>确认本段时间与性欲度变化</summary>
            <label>剧情经过分钟（可留空）<input type="number" min="0" step="any" id="roomSceneElapsed"></label>
            <label>环境变化<select id="roomSceneEnvironment"><option value="">按已生成的正文判定</option>
                <option value="3">明显升高</option><option value="2">升高</option><option value="1">稍升</option><option value="0">无变化</option>
                <option value="-1">稍降</option><option value="-2">降低</option><option value="-3">明显降低</option></select></label>
            <label class="room-check"><input type="checkbox" id="roomSceneRelease">确认角色在本段已经完成纾解</label>
        </details>`);
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
            doc.getElementById('btnRoomJournal').textContent=e.candidates.length?`待修正回复 · ${e.candidates.length}`:'关系档案';
            renderScorecard(doc.getElementById('roomRelationshipCard'),value,E);
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
            for(const button of overlay.querySelectorAll('button:not(#roomExperienceClose):not(#roomSceneCancel):not([data-draft-cancel])'))button.disabled=busy;
            for(const input of overlay.querySelectorAll('input,textarea,select'))input.disabled=busy;
            el('roomExperienceClose').disabled=committing;el('roomSceneCancel').hidden=!active;el('roomSceneCancel').disabled=committing;
            const value=room(),candidate=value&&E.ensure(value).sceneDraft;
            if (tab === 'drafts') {
                for (const card of el('roomDialogueDraftList').querySelectorAll('[data-room-draft]')) {
                    const repairing = active?.kind === 'repair' && active.id === card.dataset.roomDraft;
                    card.setAttribute('aria-busy', String(repairing));
                    card.querySelector('[data-draft-cancel]').hidden = !repairing;
                    if (card.dataset.stale === 'true') {
                        card.querySelector('[data-draft-repair]').disabled = true;
                        card.querySelector('[data-draft-accept]').disabled = true;
                    }
                }
            }
            el('roomSceneAccept').disabled=busy||!candidate||!candidate.content?.trim()||candidate.stamp!==E.stamp(value);
            const recheck=el('roomRelationRecheck');
            if(recheck&&value&&!busy){
                const turnId=[...value.messages].reverse().find(m=>m.role==='user'&&m.turnId)?.turnId;
                const effect=turnId&&value.turnEffects?.[turnId];
                const checked=effect?.relationshipChecked || Object.hasOwn(effect||{},'intimacyDelta');
                const pending=turnId&&E.ensure(value).candidates.some(d=>d.turnId===turnId);
                const enabled=E.canJudgeDesire(value,turnId)||value.participants.some(m=>E.policy(m).enabled&&value.messages.some(v=>v.turnId===turnId&&v.speakerId===m.id));
                recheck.disabled=!turnId||!enabled||Boolean(checked)||pending;
                recheck.textContent=checked?'上一轮已核对，不重复请求':pending?'请先处理本轮待修正回复':!enabled?'没有待核对的角色回合':'核对上一轮关系（一次请求）';
            }
            refreshComposer();
        }
        function render(){
            const value=room();if(!value)return;
            el('roomExperienceTitle').textContent=value.name;
            const pendingCount = E.ensure(value).candidates.length;
            overlay.querySelector('[data-room-tab="drafts"]').textContent = pendingCount ? `待修正回复 (${pendingCount})` : '待修正回复';
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
            el('roomSceneDesire').hidden=!value.desireEnabled;
            el('roomSceneElapsed').value=candidate.elapsedMinutes??'';
            el('roomSceneEnvironment').value=candidate.environmentOverride??'';
            el('roomSceneRelease').checked=candidate.releaseOverride===true;
            el('roomScenePresent').innerHTML=value.participants.map(m=>`<label class="room-check"><input type="checkbox" value="${escape(m.id)}" ${candidate.state.presentIds.includes(m.id)?'checked':''}>${escape(m.name)}${m.enabled===false?'（设定中未启用）':''}</label>`).join('');
            el('roomSceneStale').textContent=candidate.stamp!==E.stamp(value)?'来源已变化，请重新生成或手动重建':'';
        }
        function readCandidate(){
            const value=room(),candidate=value&&E.ensure(value).sceneDraft;if(!candidate)return;
            candidate.content=el('roomSceneText').value;
            for(const field of ['Time','Place','Summary','Objects','Pending'])candidate.state[field.toLowerCase()]=el('roomScene'+field).value;
            if(value.desireEnabled){
                const elapsed=el('roomSceneElapsed'),environment=el('roomSceneEnvironment').value;
                candidate.elapsedMinutes=elapsed.validity.valid&&elapsed.value!==''?elapsed.valueAsNumber:undefined;
                candidate.environmentOverride=environment===''?undefined:Number(environment);
                candidate.releaseOverride=el('roomSceneRelease').checked;
            }
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
            const visibleKeys=E.dimensions(value);
            const keys=visibleKeys.filter(key=>key!=='desire');
            const events=value.roomType==='double'?(value.relationshipEvents||[]):[];
            const available=new Set(E.availableNodes(value).map(node=>node.id));
            const eventList=events.length ? '<h4>关系事件</h4><div class="room-evidence-list">'+events.map(node=>{
                const thresholds=visibleKeys.filter(key=>Object.hasOwn(node.thresholds,key)).map(key=>E.RELATION_LABELS[key]+' ≥ '+node.thresholds[key]);
                const state=available.has(node.id)?'可用':Object.hasOwn(node.thresholds,'desire')&&!value.desireEnabled?'第四项未启用':thresholds.length?'待解锁':'待设置门槛';
                const criteria=[...thresholds,node.condition].filter(Boolean).join(' · ');
                return '<article><strong>'+escape(state)+'</strong><p>'+escape(node.description)+'</p><small>'+escape(criteria)+'</small></article>';
            }).join('')+'</div>' : '';
            const last=e.relationHistory.findLast(event=>event.memberId===memberId&&event.kind!=='desire-scene');
            const overview='<p class="room-note">'+(r.known?'进度依据正式互动更新。':'关系分数待评估；已确立的关系继续有效。')+'</p>'+
                (last?.reason?'<p class="room-note">最近一次核对 · '+escape(last.reason)+'</p>':'');
            if(!e.authorView){body.innerHTML=overview+eventList;return;}
            const history=e.relationHistory.filter(v=>v.memberId===memberId&&v.kind!=='desire-scene').slice().reverse().map(event=>({...event,
                sources:Array.isArray(event.sources)?event.sources.filter(s=>s&&typeof s.id==='string'&&typeof s.quote==='string').map(s=>({id:s.id,quote:s.quote.slice(0,2000)})):[],
                delta:event.delta&&typeof event.delta==='object'?Object.fromEntries(Object.entries(event.delta).filter(([key])=>keys.includes(key)).map(([key,n])=>[key,Number.isFinite(Number(n))?Number(n):0])):null}));
            body.innerHTML=overview+eventList+`<button type="button" class="mini-action-btn" id="roomRelationRecheck">核对上一轮关系（一次请求）</button><div class="room-field-grid room-stats">${keys.map(key=>`<label>${E.RELATION_LABELS[key]}（0–100）<input type="number" min="0" max="100" placeholder="待评估" data-relation-value="${key}" value="${escape(Object.hasOwn(pending||{},key)?pending[key]:r.knownDimensions.includes(key)?r[key]:'')}"></label>`).join('')}</div><label>当前情绪<input id="roomRelationEmotion" value="${escape(r.emotion)}" maxlength="200"></label><label>既有关系／作者确认的基线<textarea id="roomRelationBaseline" rows="3">${escape(r.baseline||p.baseline)}</textarea></label><label>这个人物重视什么<textarea id="roomRelationPreferences" rows="3">${escape(p.preferences)}</textarea></label><label>这个人物的界限／顾虑<textarea id="roomRelationBoundaries" rows="3">${escape(p.boundaries)}</textarea></label><label>关键关系转折需要什么经历<textarea id="roomRelationConditions" rows="3">${escape(p.conditions)}</textarea></label><label class="room-check"><input id="roomRelationEnabled" type="checkbox" ${p.enabled?'checked':''}>为此角色核对关系证据</label><button type="button" class="btn-confirm" id="roomRelationSave">保存作者校准与规则</button><p class="room-note">手动校准会留在关系档案中，不编造成剧情事件。既有自定义关系节点仍在房间设定中编辑。</p><h4>关系依据与来源</h4><div class="room-evidence-list">${history.slice(0,historyCount).map(event=>`<article><strong>${escape(event.kind==='author'?'作者校准':event.tag||'本轮判定')}</strong><p>${escape(event.reason||'无额外说明')}</p>${keys.includes('desire')&&event.desireReason?`<p>${escape(event.desireReason)}</p>`:''}${event.delta?`<small>${Object.entries(event.delta).map(([key,n])=>`${E.RELATION_LABELS[key]} ${n>0?'+':''}${n}`).join(' · ')}</small>`:''}${(event.sources||[]).map(ref=>`<button type="button" class="room-source" data-room-source="${escape(ref.id)}">${escape(ref.quote)}</button>`).join('')}</article>`).join('')||'<p class="room-note">还没有来源判定。普通交流可以保持原关系；API 判定失败不会凭空改变状态。</p>'}</div>${history.length>historyCount?'<button type="button" id="roomRelationMore" class="mini-action-btn">查看更多依据</button>':''}`;
            if(value.desireEnabled&&e.desire.history.length){
                const title={time:'剧情时间',environment:'环境变化',release:'事后回落'};
                const records=e.desire.history.slice(-historyCount).reverse().map(item=>`<article>
                    <strong>${escape(title[item.kind]||'状态变化')} · ${escape(Math.round(item.before*100)/100)} → ${escape(Math.round(item.after*100)/100)}</strong>
                    ${item.source?.id?`<button type="button" class="room-source" data-room-source="${escape(item.source.id)}">${escape(item.source.quote)}</button>`:''}</article>`).join('');
                body.insertAdjacentHTML('beforeend','<details class="room-scene-desire"><summary>性欲度记录</summary><div class="room-evidence-list">'+records+'</div></details>');
            }
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
                    if(input.value==='')continue;
                    const n=input.valueAsNumber;if(!Number.isInteger(n)||n<0||n>100)return message('关系数值必须在 0—100 之间。',true);values[input.dataset.relationValue]=n;
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
        async function repairCandidate(value, candidate) {
            if (room() !== value || active || committing || options.isBusy()) return;
            const member = value.participants.find(item => item.id === candidate.memberId);
            const current = () => E.ensure(value).candidates.some(item => item.id === candidate.id && item.raw === candidate.raw)
                && candidate.stamp === E.stamp(value);
            if (!member || !current()) { message('角色或原对话已变化，无法采纳这份旧稿。',true); return; }
            const token = { kind:'repair', id:candidate.id, controller:new AbortController() };
            active = token;
            message('正在修复这份原稿。可以取消并保留原稿。');
            renderBusy();
            try {
                const dialogue = await options.repairDialogue(candidate.raw,member,token.controller.signal);
                if (active !== token || token.controller.signal.aborted || room() !== value) return;
                if (!current()) throw new Error('修复期间原对话已变化，原稿已保留。');
                const parsed = E.parseDialogue(dialogue);
                active = null;
                await commit(target => options.adoptDialogue(target,candidate,parsed));
            } catch (error) {
                if (active === token) message('修复未完成，原稿已保留。' + error.message,true);
            } finally {
                if (active === token) { active = null; renderBusy(); }
            }
        }
        function renderDrafts(value){
            const drafts=E.ensure(value).candidates,body=el('roomDialogueDraftList');
            const stamp=E.stamp(value);
            body.innerHTML=drafts.map(d=>{
                const member=value.participants.find(m=>m.id===d.memberId);let parsed={speech:'',expression:''};
                try{parsed=E.parseDialogue(d.raw);}catch(error){try{const raw=JSON.parse(d.raw);parsed={speech:typeof raw.speech==='string'?raw.speech:'',expression:typeof raw.expression==='string'?raw.expression:''};}catch(ignored){parsed.speech=d.raw;}}
                return `<article class="room-candidate" data-room-draft="${escape(d.id)}"><h4>${escape(member?.name||'已移除角色')}</h4><p>${escape(d.reason)}</p><label>人物说的话<textarea data-draft-speech rows="5">${escape(parsed.speech)}</textarea></label><label>简短可见神态（可留空）<input data-draft-expression value="${escape(parsed.expression)}"></label><details><summary>查看模型原稿</summary><pre>${escape(d.raw)}</pre></details><div class="room-inline"><button type="button" data-draft-accept class="btn-confirm">采纳修正稿</button><button type="button" data-draft-delete class="mini-action-btn">删除待修正稿</button></div></article>`;
            }).join('')||'<p class="room-note">没有待修正的回复。</p>';
            body.querySelectorAll('[data-room-draft]').forEach(card=>{
                const candidate=drafts.find(d=>d.id===card.dataset.roomDraft);
                const stale = candidate.stamp !== stamp || !value.participants.some(m => m.id === candidate.memberId);
                card.dataset.stale = String(stale);
                const actions = card.querySelector('.room-inline');
                const repair = doc.createElement('button');
                repair.type = 'button'; repair.className = 'mini-action-btn'; repair.dataset.draftRepair = '';
                repair.textContent = '自动修复原稿并采纳';
                repair.onclick = () => repairCandidate(value,candidate);
                const cancel = doc.createElement('button');
                cancel.type = 'button'; cancel.className = 'mini-action-btn'; cancel.dataset.draftCancel = '';
                cancel.textContent = '取消修复'; cancel.hidden = true;
                cancel.onclick = () => {
                    if (active?.kind !== 'repair' || active.id !== candidate.id) return;
                    active.controller.abort(); active = null;
                    message('已取消修复，原稿已保留。'); renderBusy();
                };
                actions.prepend(repair,cancel);
                if (stale) {
                    const note = doc.createElement('p');
                    note.textContent = '来源或角色已变化，可查看或删除这份旧稿。';
                    actions.before(note);
                }
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
        doc.getElementById('btnRoomJournal').onclick=()=>{
            const value=options.getRoom();
            open(value && E.ensure(value).candidates.length ? 'drafts' : 'relations');
        };
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
        el('roomSceneEnvironment').onchange=readCandidate;
        el('roomSceneAccept').onclick=()=>{
            if(!el('roomSceneDesire').hidden&&!el('roomSceneElapsed').validity.valid)return message('请填写有效的剧情经过分钟数。',true);
            readCandidate();commit(current=>E.acceptScene(current,E.ensure(current).sceneDraft),()=>{refreshComposer(true);message('情景已采纳，已回到对话推进。');});
        };
        el('roomAuthorView').onchange=()=>{const value=room();if(value){E.ensure(value).authorView=el('roomAuthorView').checked;persist();renderRelations(value);refreshComposer();}};
        el('roomRelationMember').onchange=()=>{memberId=el('roomRelationMember').value;historyCount=30;renderRelations(room());};
        return {overlay,open,close,setMode,refreshComposer,isLocked:()=>committing,isActive:()=>Boolean(active),
            refresh:()=>{refreshComposer();if(room()&&M.isOpen(overlay)&&!active&&!committing)render();},
            preview:()=>{open('scene');if(room())return generate();},showDrafts:()=>open('drafts')};
    }
    return {create,renderScorecard,mountDesireSettings};
});
