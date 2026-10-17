(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.StarlightWorkspaceUI=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
    'use strict';
    function create(options) {
        const o=options, W=o.workspace, A=o.archive, M=o.memory, T=o.timeline;
        const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const overlay=document.createElement('div');overlay.className='modal-overlay workspace-overlay';overlay.id='workspaceOverlay';
        overlay.innerHTML='<div class="workspace-page"><div class="full-page-header"><div><h3 id="workspaceTitle">作品工具</h3><p class="hint" id="workspaceSubtitle"></p></div><button type="button" class="btn btn-secondary" data-work-action="close">关闭</button></div><nav class="workspace-tool-tabs" aria-label="作品工具"><button data-work-tab="chapters">章节目录</button><button data-work-tab="timeline">状态时间线</button><button data-work-tab="revisions">修改历史</button><button data-work-tab="backup">备份与恢复</button></nav><div id="workspaceBody"></div></div>';
        document.body.appendChild(overlay);
        const body=overlay.querySelector('#workspaceBody');
        let tab='chapters',busy=false, imported=null, activeScope='public';
        const work=()=>o.target();
        const messages=()=>o.messages();
        function close(){if(busy)return;o.motion.setVisible(overlay,false);imported=null;}
        function open(next='chapters'){if(o.busy())return o.notify('请等待当前任务完成','info');tab=next;activeScope='public';imported=null;render();o.motion.setVisible(overlay,true,{kind:'page'});}
        function button(action,label,extra=''){return `<button type="button" class="mini-action-btn" data-work-action="${action}" ${extra}>${label}</button>`;}
        function memoryState(){const target=work();return o.mode()==='room'?(activeScope==='public'?target.sharedMemory:target.characterMemories?.[activeScope]):target.memory;}
        function scopedEvents(){return M.normalizeMemory(memoryState(),messages().length).timeline||[];}
        function render(){
            overlay.querySelector('[data-work-action="close"]').disabled=busy;
            const target=work();overlay.querySelector('#workspaceTitle').textContent=tab==='backup'?'备份与恢复':(target?.name||'作品工具');
            overlay.querySelector('#workspaceSubtitle').textContent=tab==='backup'?'本地文件备份，不包含 API 密钥。':(o.mode()==='room'?'当前房间独立数据':'当前剧情独立数据');
            overlay.querySelectorAll('[data-work-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.workTab===tab);b.disabled=busy||(!target&&b.dataset.workTab!=='backup');});
            if(!target&&tab!=='backup'){body.innerHTML='<p class="hint">先打开一段剧情或房间。</p>';return;}
            if(tab==='chapters'){
                const chapters=W.chaptersFor(target,messages());
                body.innerHTML=`<p class="hint">识别用户输入中的“第X章 / Chapter X”，也可以为任意消息手动命名。章节只用于导航，不添加剧情事实。</p><div class="workspace-inline">${button('add-chapter','新增章节标记')}${button('export-work','导出当前作品')}</div><div class="workspace-list">${chapters.map(c=>`<article class="workspace-item"><button class="workspace-item-main" data-work-action="jump" data-index="${c.index}"><strong>${esc(c.title)}</strong><span>消息 #${c.index+1} · ${c.automatic?'自动识别':'手动标记'}</span></button><div>${button('rename-chapter','重命名',`data-index="${c.index}"`)}${c.automatic?'':button('delete-chapter','删除',`data-index="${c.index}"`)}</div></article>`).join('')||'<p class="hint">尚无章节，可长按消息添加章节标记。</p>'}</div>`;
            } else if(tab==='timeline') {
                const scopes=o.mode()==='room'?`<label>知识范围<select id="timelineScope"><option value="public">公开时间线</option>${(target.participants||[]).map(p=>`<option value="${esc(p.id)}" ${activeScope===p.id?'selected':''}>${esc(p.name)} · 独立认知</option>`).join('')}</select></label>`:'';
                const events=scopedEvents().slice().sort((a,b)=>(a.sourceEndIndex??Infinity)-(b.sourceEndIndex??Infinity));
                body.innerHTML=`<p class="hint">保存有来源的成长、关系、装备等变化；旧状态仍可回顾，私密认知只供相应角色使用。</p>${scopes}<div class="workspace-inline">${button('add-event','记录状态变化')}</div><div class="workspace-list">${events.map(e=>`<article class="workspace-item"><div class="workspace-item-main"><strong>${esc(e.subject||'未命名角色')} · ${esc(e.attribute||'状态')}</strong><span>${esc(e.before||'未记录')} → ${esc(e.after||'未记录')}</span><small>${e.invalidated?'来源已失效':({active:'有效记录',expired:'已失效',corrected:'已更正'}[e.status]||'有效记录')}${e.locked?' · 已锁定':''}${Number.isInteger(e.sourceEndIndex)?` · 截至消息 #${e.sourceEndIndex}`:' · 手工记录'}</small></div><div>${Number.isInteger(e.sourceStartIndex)?button('jump','来源',`data-index="${e.sourceStartIndex}"`):''}${button('edit-event','编辑',`data-id="${esc(e.id)}"`)}${button('delete-event','删除',`data-id="${esc(e.id)}"`)}</div></article>`).join('')||'<p class="hint">尚无明确状态变化。自动整理只记录原文确实发生的变化。</p>'}</div>`;
                body.querySelector('#timelineScope')?.addEventListener('change',e=>{activeScope=e.target.value;render();});
            } else if(tab==='revisions'){
                body.innerHTML=`<p class="hint">保留最近的设定与手工记忆修改。恢复前会再保存当前版本，聊天原文不会被覆盖。</p><div class="workspace-inline">${button('snapshot','保存当前快照')}</div><div class="workspace-list">${(target.revisionHistory||[]).slice().reverse().map(r=>`<article class="workspace-item"><div class="workspace-item-main"><strong>${esc(r.label||'设定快照')}</strong><span>${new Date(r.createdAt||0).toLocaleString()}</span></div>${button('restore-revision','查看并恢复',`data-id="${esc(r.id)}"`)}</article>`).join('')||'<p class="hint">后续保存人物、世界书或手工记忆时会自动建立修改历史。</p>'}</div>`;
            } else {
                const summary=imported?A.summarizeBackup(imported):null;
                body.innerHTML=`<div class="workspace-inline">${button('export-all','导出全部数据')}${target?button('export-work','导出当前作品'):''}</div><p class="hint">包含人物、世界书、对话、记忆、文风与图片。导出的文件可用于换机和恢复；请妥善保存私人剧情。</p><label class="workspace-file">选择备份文件<input id="workspaceImportFile" type="file" accept="application/json,.json"></label>${summary?`<section class="workspace-card"><strong>导入预览</strong><p>${summary.stories} 段剧情 · ${summary.rooms} 个房间 · ${summary.messages} 条消息 · ${summary.facts} 条事实 · ${summary.styles} 份文风</p><label>导入方式<select id="workspaceImportStrategy"><option value="copy">新增副本，保留现有作品</option>${target&&summary.stories+summary.rooms===1?'<option value="replace">替换当前作品（先保存恢复快照）</option>':''}</select></label>${button('import','确认导入')}</section>`:''}<div id="workspaceImportError" role="status"></div>`;
                body.querySelector('#workspaceImportFile').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>200*1024*1024)throw new Error('备份文件超过 200 MB，请按作品分开导入');imported=A.parseBackup(await file.text());render();}catch(error){body.querySelector('#workspaceImportError').textContent=error.message;}});
            }
            overlay.querySelectorAll('button').forEach(b=>{if(busy)b.disabled=true;});
        }
        async function exportData(scope){const backup=A.createBackup(o.state(),scope?{mode:o.mode(),id:work().id}:{});const text=JSON.stringify(backup);const name=`starlight-${scope?'work':'all'}-${new Date().toISOString().slice(0,10)}.json`;await o.download(name,text);o.notify('备份已导出','success');}
        async function saveTimeline(nextEvents,label){
            const target=work();let next=A.captureRevision(target,{mode:o.mode(),label});
            const memory=M.normalizeMemory(memoryState(),messages().length);memory.timeline=nextEvents;memory.updatedAt=Date.now();
            if(o.mode()==='room'){if(activeScope==='public')next.sharedMemory=memory;else next.characterMemories={...next.characterMemories,[activeScope]:memory};}else next.memory=memory;
            await o.commitWork(next);render();
        }
        function editEvent(existing){
            const e=existing||{subject:'',attribute:'',before:'',after:'',sourceStartIndex:null,sourceEndIndex:null,status:'active',locked:false};
            body.innerHTML=`<form id="timelineForm" class="workspace-form"><label>角色 / 对象<input name="subject" required value="${esc(e.subject)}"></label><label>变化项目<input name="attribute" required placeholder="例如：装备、关系、能力" value="${esc(e.attribute)}"></label><label>变化前<textarea name="before">${esc(e.before)}</textarea></label><label>变化后<textarea name="after" required>${esc(e.after)}</textarea></label><div class="workspace-columns"><label>起始消息编号<input name="start" type="number" min="1" max="${messages().length}" value="${Number.isInteger(e.sourceStartIndex)?e.sourceStartIndex+1:''}"></label><label>结束消息编号<input name="end" type="number" min="1" max="${messages().length}" value="${e.sourceEndIndex??''}"></label></div><label>状态<select name="status"><option value="active">有效记录</option><option value="expired">失效</option><option value="corrected">已更正</option></select></label><label><input name="locked" type="checkbox" ${e.locked?'checked':''}> 锁定，自动整理不覆盖</label><div class="workspace-inline"><button class="btn btn-primary" type="submit">保存变化</button>${button('cancel-event','取消')}</div></form>`;
            const form=body.querySelector('form');form.elements.status.value=e.status||'active';
            form.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;const data=new FormData(form);const start=data.get('start')?Number(data.get('start'))-1:null;const end=data.get('end')?Number(data.get('end')):null;if((start===null)!==(end===null)||start!==null&&end<=start)return o.notify('请填写完整且有效的来源范围','error');
                const value=T.createEvent({...e,subject:data.get('subject'),attribute:data.get('attribute'),before:data.get('before'),after:data.get('after'),sourceStartIndex:start,sourceEndIndex:end,status:data.get('status'),locked:data.get('locked')==='on',userEdited:true,invalidated:false,knowledgeScope:activeScope==='public'?'public':'private',observedBy:activeScope==='public'?[]:[activeScope],updatedAt:Date.now()});
                try{busy=true;const events=scopedEvents().filter(item=>item.id!==e.id);events.push(value);await saveTimeline(events,'修改状态时间线前');}catch(error){o.notify(error.message,'error');}finally{busy=false;render();}
            });
        }
        async function addChapter(index){if(!work())return;const targetIndex=Number.isInteger(index)?index:Number(prompt('标记的消息编号',String(o.visibleIndex()+1)))-1;if(!Number.isInteger(targetIndex)||targetIndex<0||targetIndex>=messages().length)return o.notify('消息编号无效','error');const title=prompt('章节或节点名称',W.detectChapter(messages()[targetIndex].content)||'新章节');if(!title?.trim())return;const next={...work(),chapters:W.normalizeChapters([...(work().chapters||[]).filter(c=>c.index!==targetIndex),{id:'chapter_'+Date.now(),index:targetIndex,title:title.trim(),automatic:false}],messages().length)};await o.commitWork(next);if(o.motion.isOpen(overlay))render();}
        overlay.addEventListener('click',async event=>{
            const change=event.target.closest('[data-work-tab]');if(change&&!busy){tab=change.dataset.workTab;render();return;}
            const buttonEl=event.target.closest('[data-work-action]');if(!buttonEl||busy)return;const action=buttonEl.dataset.workAction;
            try{
                if(action==='close'){close();return;}
                if(action==='jump'){close();o.jump(Number(buttonEl.dataset.index));return;}
                if(action==='add-chapter'||action==='rename-chapter'){await addChapter(action==='rename-chapter'?Number(buttonEl.dataset.index):undefined);return;}
                if(action==='delete-chapter'){await o.commitWork({...work(),chapters:(work().chapters||[]).filter(c=>c.index!==Number(buttonEl.dataset.index))});render();return;}
                if(action==='add-event'||action==='edit-event'){editEvent(scopedEvents().find(e=>e.id===buttonEl.dataset.id));return;}
                if(action==='cancel-event'){render();return;}
                if(action==='delete-event'){if(!confirm('删除这条状态变化？原始对话仍保留。'))return;await saveTimeline(scopedEvents().filter(e=>e.id!==buttonEl.dataset.id),'删除状态变化前');return;}
                if(action==='snapshot'){await o.commitWork(A.captureRevision(work(),{mode:o.mode(),label:'手动保存'}));render();return;}
                if(action==='restore-revision'){
                    const revision=(work().revisionHistory||[]).find(r=>r.id===buttonEl.dataset.id);if(!revision)return;
                    body.innerHTML=`<p class="hint">将恢复下列设定，保留当前消息原文。仅当原消息来源未被撤回或改写时恢复快照记忆，否则保留当前记忆，避免复活已删剧情。当前版本也会存入修改历史。</p><pre class="workspace-preview">${esc(JSON.stringify(revision.snapshot||revision.data||revision,null,2))}</pre>${button('confirm-restore','确认恢复',`data-id="${esc(revision.id)}"`)}${button('cancel-event','返回')}`;return;
                }
                if(action==='confirm-restore'){await o.commitWork(A.restoreRevision(work(),buttonEl.dataset.id));render();o.notify('已恢复设定版本','success');return;}
                if(action==='export-all'||action==='export-work'){busy=true;await exportData(action==='export-work');return;}
                if(action==='import'){
                    const strategy=body.querySelector('#workspaceImportStrategy').value;
                    if(strategy==='replace'&&!confirm('确认以备份替换当前作品？将先保留现有作品的完整副本，以便恢复。'))return;
                    busy=true;await o.importBackup(imported,{strategy,targetMode:o.mode(),targetId:work()?.id});imported=null;o.notify('导入完成，原有密钥保持不变','success');
                }
            }catch(error){o.notify(error.message,'error');}finally{if(busy){busy=false;render();}}
        });
        return {open,close,overlay,addChapter,render};
    }
    return {create};
});
