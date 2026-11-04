(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.StarlightAutoBuildUI=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
    'use strict';
    function create(o){
        const {document:doc,core:A,motion:M}=o;
        const input=doc.getElementById('inputArea'),bar=doc.createElement('div');bar.id='autoBuildBar';bar.hidden=true;bar.className='auto-build-bar';input.after(bar);
        const settings=doc.createElement('div');settings.id='autoBuildSettings';settings.className='modal-overlay auto-build-overlay';settings.hidden=true;
        settings.innerHTML='<div class="auto-build-page" role="dialog" aria-modal="true" aria-labelledby="autoBuildSettingsTitle"><div class="full-page-header"><div><h3 id="autoBuildSettingsTitle">自动构筑设置</h3><p>仅用于当前剧情；保存设置不会发起生成。</p></div><button type="button" class="mini-action-btn" data-auto-close>关闭</button></div><div class="auto-build-fields"><label>下一章编号<input id="autoNextNumber" type="number" min="1" max="1000000"></label><div class="auto-build-range"><label>每章目标字数下限<input id="autoTargetMin" type="number" min="200" max="60000"></label><label>每章目标字数上限<input id="autoTargetMax" type="number" min="200" max="60000"></label></div><p class="hint">目标为不计空白的正文字符数，实际可能有偏差；不会自动追加请求凑字数。沿用“我的”中的模型和输出上限。</p><p class="hint" id="autoStyleSource"></p><label>文风补充<textarea id="autoStyleNote" rows="3" maxlength="4000" placeholder="留空沿用当前文风档案；可补充标点、叙述视角或对白写法"></textarea></label><label>长期创作方向与注意事项<textarea id="autoNotes" rows="5" maxlength="6000" placeholder="例如：自然日常、关系慢慢发展，暂时不揭晓身世。可留空让故事依照既有设定发展。"></textarea></label><label>仅下一章的补充要求<textarea id="autoNextNote" rows="3" maxlength="4000" placeholder="成功写完后自动清空；未完成或重写仍保留本章要求"></textarea></label><label class="auto-build-check"><input id="autoTitles" type="checkbox">正文包含章节标题</label><p class="hint">每次只完整写一章，保存后等待确认。默认一次正文请求；长期记忆仅按已有阈值整理。</p></div><div class="full-page-actions"><button type="button" class="btn-cancel" data-auto-close>取消</button><button type="button" class="btn-confirm" id="autoSaveSettings">保存设置</button></div></div>';
        doc.body.append(settings);
        let active=null,settingsOwner=null,lastRendered='';
        const get=id=>settings.querySelector('#'+id);
        const budgetHint=doc.createElement('p');budgetHint.className='hint';budgetHint.id='autoBudgetHint';get('autoStyleSource').before(budgetHint);
        function updateBudget(){const limit=o.outputLimit?.()||16000,estimate=Math.ceil((Number(get('autoTargetMax').value)||3000)*1.3)+800;budgetHint.textContent=estimate>limit?'当前目标超过保守估算的输出预算。请在“我的”中提高输出上限，或降低本页目标字数后再保存。':'当前目标已预留输出余量；实际字数仍由模型生成结果决定。';}
        get('autoTargetMax').addEventListener('input',updateBudget);
        function render(){
            const work=o.work(),state=work?A.ensure(work):null;
            if(state?.mode==='generating'&&!active){state.mode='paused';o.save();}
            const visible=!!state&&['generating','awaiting'].includes(state.mode);
            bar.hidden=!visible;input.hidden=visible;input.classList.toggle('auto-build-hidden',visible);input.inert=visible;
            const entry=doc.getElementById('btnAutoBuild');if(entry)entry.hidden=!work;
            if(!visible){lastRendered='';return;}
            const signature=state.mode+':'+state.nextNumber+':'+state.lastChapterId;
            if(signature===lastRendered)return;lastRendered=signature;
            bar.innerHTML='<div class="auto-build-status"><span id="autoBuildStatus"></span><button type="button" class="mini-action-btn" id="autoBuildGear" aria-label="自动构筑设置">⚙</button></div><div class="auto-build-actions">'+(state.mode==='generating'?'<button type="button" class="btn-cancel" id="autoBuildStop">停止生成</button>':'<button type="button" class="btn-confirm" id="autoBuildContinue">继续下一章</button><button type="button" class="btn-cancel" id="autoBuildPause">暂停并编辑</button>')+'</div>';
            const status=bar.querySelector('#autoBuildStatus');
            const latest=(work.conversations||[]).findLast(m=>m.chapterId===state.lastChapterId);
            status.textContent=state.mode==='generating'?'正在构筑第 '+state.nextNumber+' 章…':'第 '+(latest?.chapterNumber||state.nextNumber-1)+' 章已保存 · '+A.count(latest?.content).toLocaleString()+' 字';
            bar.querySelector('#autoBuildGear').disabled=state.mode==='generating';
            bar.querySelector('#autoBuildGear').onclick=openSettings;
            bar.querySelector('#autoBuildStop')?.addEventListener('click',stop);
            bar.querySelector('#autoBuildContinue')?.addEventListener('click',run);
            bar.querySelector('#autoBuildPause')?.addEventListener('click',()=>pause());
            M.enter(bar,'message');
        }
        function pause(){
            if(active)return false;
            const work=o.work();if(work){A.ensure(work).mode='paused';o.save();}render();return true;
        }
        function stop(){if(!active)return;active.cancelled=true;o.stop();const b=bar.querySelector('#autoBuildStop');if(b){b.disabled=true;b.textContent='正在停止…';}}
        function openSettings(){
            if(active||o.busy())return o.notify('请先结束当前生成','info');
            const work=o.work();if(!work)return;
            const state=A.ensure(work);settingsOwner=work.id;
            get('autoNextNumber').value=state.nextNumber;get('autoTargetMin').value=state.settings.targetMin;get('autoTargetMax').value=state.settings.targetMax;
            get('autoStyleNote').value=state.settings.styleNote;get('autoNotes').value=state.settings.notes;get('autoNextNote').value=state.settings.nextNote;get('autoTitles').checked=state.settings.titles;
            get('autoStyleSource').textContent=work.styleInfluence?'当前文风：'+work.styleInfluence.name+' · '+work.styleInfluence.strength+'%':'当前沿用剧情设定中的文风；可在文风工坊应用独立档案。';
            updateBudget();
            M.setVisible(settings,true,{hidden:true,kind:'page'});
        }
        function closeSettings(){M.setVisible(settings,false,{hidden:true,kind:'page'});settingsOwner=null;}
        settings.querySelectorAll('[data-auto-close]').forEach(b=>b.onclick=closeSettings);
        get('autoSaveSettings').onclick=()=>{
            const work=o.work();if(!work||work.id!==settingsOwner||active)return;
            const min=Number(get('autoTargetMin').value),max=Number(get('autoTargetMax').value),number=Number(get('autoNextNumber').value);
            if(!Number.isInteger(min)||!Number.isInteger(max)||min<200||max<min||max>60000||!Number.isInteger(number)||number<1||number>1000000)return o.notify('请填写有效章号和 200—60000 字范围，上限不得小于下限','error');
            if(Math.ceil(max*1.3)+800>(o.outputLimit?.()||16000))return o.notify('目标篇幅超过当前输出预算，请降低目标字数，或在“我的”中提高输出上限','error');
            const used=(work.conversations||[]).some(m=>m.chapterNumber===number);
            if(used)return o.notify('该章节编号已使用，请选择未使用的下一章编号','error');
            const state=A.ensure(work);state.nextNumber=number;state.initialized=true;state.settings={targetMin:min,targetMax:max,styleNote:get('autoStyleNote').value,notes:get('autoNotes').value,nextNote:get('autoNextNote').value,titles:get('autoTitles').checked};
            o.save();closeSettings();lastRendered='';render();o.notify('自动构筑设置已保存','success');
        };
        async function run(){
            if(active||o.busy())return;
            const work=o.work();if(!work||!o.canStart())return;
            const task=A.createTask(work),state=work.autoBuild,owner=work.id;
            if(A.outputTokens(task)>(o.outputLimit?.()||16000))return o.notify('目标篇幅超过当前输出预算，请先调整构筑设置或提高输出上限','error');
            active={cancelled:false,owner};const current=active;
            state.mode='generating';state.lastError='';o.save();o.setBusy(true);doc.activeElement?.blur();render();
            let content='',savedAt=0,savedChars=0;
            try{
                const result=await o.generate(work,task,text=>{content=text;const status=bar.querySelector('#autoBuildStatus');if(status)status.textContent='第 '+task.number+' 章 · 已生成 '+A.count(text).toLocaleString()+' 字';
                    work.incompleteDraft={text,createdAt:Date.now(),reason:'生成中的恢复片段',autoTask:task};
                    if(!savedAt||(Date.now()-savedAt>=5000&&text.length-savedChars>=2000)){savedAt=Date.now();savedChars=text.length;o.save();}
                },()=>current.cancelled);
                content=result.content||result.metadata?.partialContent||content;
                if(current.cancelled||result.metadata?.aborted||result.metadata?.finishReason!=='stop'){
                    const error=new Error(result.metadata?.aborted?'生成已停止；已收到的正文保留为未完成稿':'本章未正常完成；已收到的正文保留为未完成稿');error.partialContent=content;throw error;
                }
                const latest=o.work();if(!latest||latest.id!==owner)throw new Error('当前剧情已切换，本次生成未写入其他作品');
                await o.commit(A.result(latest,task,content));
                o.notify('第 '+task.number+' 章已保存，确认后才会写下一章','success');
            }catch(error){
                const latest=o.work();if(latest?.id===owner){const state=A.ensure(latest);state.mode='paused';state.lastError=error.message;
                    const partial=error.partialContent||content;if(partial)latest.incompleteDraft={text:partial,createdAt:Date.now(),reason:error.message,autoTask:task};o.save();}
                o.notify(error.message||'自动构筑已暂停','info');
            }finally{active=null;o.setBusy(false);o.finish();lastRendered='';render();}
        }
        function back(){
            if(M.isOpen(settings)){closeSettings();return true;}
            if(active){if(o.confirm('停止当前章节生成并退出自动构筑？已收到的片段会保存为未完成稿。'))stop();return true;}
            if(o.work()&&A.ensure(o.work()).mode==='awaiting'){pause();return true;}
            return false;
        }
        return {run,render,pause,stop,openSettings,back,get busy(){return !!active;},settings};
    }
    return {create};
});
