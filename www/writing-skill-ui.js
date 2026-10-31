(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.StarlightWritingSkillUI=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
    'use strict';
    function create(o){
        const {document:doc,core:W,styleLab:S,mount}=o;
        const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        let importing=false;
        function field(label,attrs,value){return `<label class="style-field">${label}<textarea ${attrs}>${esc(value)}</textarea></label>`;}
        function update(skill){o.update({skill:W.normalize(skill)});refreshPrompt();}
        function refreshPrompt(){
            const profile=o.profile();if(!profile)return;
            const prompt=S.buildInfluencePrompt(S.createAppliedStyle(profile));
            const preview=mount.querySelector('#writingSkillPrompt');if(preview)preview.textContent=prompt||'当前强度为 0，不发送写作档案。';
            const report=mount.querySelector('#writingSkillBudget');if(report){
                const cap=S.getStrengthStrategy(profile.strength).budget;
                const compile=W.compile(profile.skill,{maxChars:Math.floor(Math.max(0,cap-500)*.67),anchor:profile.anchorMode==='manual'?profile.anchor:''});
                report.textContent=`正式表达提示约 ${prompt.length} 字符 / 预算 ${cap}。${compile.shortened?'部分长说明或样例已缩短，请展开实际发送预览核对。':'核心规则与参考按预算选用。'}完整原文只在分析时发送。`;
            }
        }
        function render(profile){
            if(!profile){mount.innerHTML='';return;}
            const skill=W.normalize(profile.skill);
            const toolbar='<div class="writing-skill-actions"><button type="button" class="style-action" data-writing-action="duplicate">复制档案</button><button type="button" class="style-action" data-writing-action="import">导入 Skill / JSON</button><button type="button" class="style-action" data-writing-action="export-md">导出 SKILL.md</button><button type="button" class="style-action" data-writing-action="export-json">导出完整档案</button></div><input type="file" id="writingSkillFile" accept=".md,.txt,.json,text/plain,text/markdown,application/json" hidden>';
            if(!skill){mount.innerHTML=toolbar+'<p class="hint">旧版因子继续可用。重新分析参考文本可提取分段、标点、对白与情绪等十类写法，也可导入已有写作 Skill。</p>';return;}
            const stats=skill.stats;
            mount.innerHTML=toolbar+(stats?`<details class="writing-skill-details"><summary>上次分析样本的本地统计</summary><p class="hint">${stats.characters} 字符 · ${stats.paragraphs} 段 · 平均段长约 ${stats.averageParagraph} 字符（按空行分段）。以下次数仅作观察，不是写作配额。</p><div class="writing-skill-marks">${Object.entries(stats.punctuation).map(([k,v])=>`<span>${esc(k)} ${v}</span>`).join('')}</div></details>`:'')+
                field('用户指定写法（优先于样本习惯；修改后重新应用）','id="writingSkillUser" rows="3" maxlength="4000"',skill.userInstructions)+
                `<div class="writing-skill-rules">${skill.rules.map(r=>`<details class="writing-skill-details" data-writing-rule="${r.id}"><summary>${esc(r.name)} <small>${r.method?(r.origin==='user'?'用户编辑':'样本提取'):'样本不足'}</small></summary><p class="hint">样本观察：${esc(r.observation||'未提取到足够依据。')}</p>${field('写作方法','data-rule-key="method" rows="3" maxlength="1000"',r.method)}${field('适用边界','data-rule-key="whenNot" rows="2" maxlength="500"',r.whenNot)}<p class="hint">出处：${esc(r.evidenceIds.join('、')||'未指定原文段落；请结合参考文本核对。')}</p></details>`).join('')}</div>`+
                `<details class="writing-skill-details"><summary>代表段落 · 保留原始分段与标点</summary><p class="hint">仅供写法参考。编辑后的片段标记为用户样本，不再作为原文证据。</p><div>${skill.samples.map((s,i)=>`<div class="writing-skill-sample" data-sample-index="${i}"><small>${esc(s.id)} · ${s.start===null?'用户样本':`原文字符 ${s.start+1}—${s.end}`}</small>${field('场景','data-sample-key="scene" rows="1" maxlength="100"',s.scene)}${field('参考段落','data-sample-key="text" rows="6" maxlength="1000"',s.text)}<button type="button" class="style-action" data-writing-action="remove-sample" data-index="${i}">删除此段</button></div>`).join('')}</div><button type="button" class="style-action" data-writing-action="add-sample" ${skill.samples.length>=8?'disabled':''}>＋ 添加自己的代表段落</button></details>`+
                `<details class="writing-skill-details"><summary>高级写作说明与实际发送预览</summary>${field('补充写作说明 / 外部 Skill 正文（优先于自动提取的方法）','id="writingSkillManual" rows="8" maxlength="12000"',skill.manual)}<p class="hint" id="writingSkillBudget"></p><details><summary>实际表达提示 · 不包含人设与历史</summary><pre id="writingSkillPrompt" class="writing-skill-preview"></pre></details><details><summary>可导出的 SKILL.md 内容</summary><pre class="writing-skill-preview">${esc(W.markdown(skill,profile.name))}</pre></details></details>`;
            refreshPrompt();
        }
        mount.addEventListener('input',event=>{
            if(o.busy())return;
            const profile=o.profile(),skill=W.normalize(profile?.skill);if(!skill)return;
            if(event.target.id==='writingSkillUser')skill.userInstructions=event.target.value;
            else if(event.target.id==='writingSkillManual')skill.manual=event.target.value;
            else if(event.target.dataset.ruleKey){const box=event.target.closest('[data-writing-rule]');const r=skill.rules.find(r=>r.id===box.dataset.writingRule);r[event.target.dataset.ruleKey]=event.target.value;r.origin='user';box.querySelector('summary small').textContent='用户编辑';}
            else if(event.target.dataset.sampleKey){
                const i=Number(event.target.closest('[data-sample-index]').dataset.sampleIndex),s=skill.samples[i];if(!s)return;
                const old=s.id;s[event.target.dataset.sampleKey]=event.target.value;
                if(event.target.dataset.sampleKey==='text'){
                    s.id=s.id.startsWith('user_')?s.id:'user_'+s.id;s.start=s.end=null;
                    skill.rules.forEach(r=>{r.evidenceIds=r.evidenceIds.filter(id=>id!==old);});
                    event.target.closest('[data-sample-index]').querySelector('small').textContent=s.id+' · 用户样本';
                }
            }else return;
            update(skill);
        });
        mount.addEventListener('click',async event=>{
            const button=event.target.closest('[data-writing-action]');if(!button||o.busy()||importing)return;
            const action=button.dataset.writingAction,profile=o.profile();if(!profile)return;
            try{
                if(action==='duplicate'){o.add(S.createProfile({...profile,id:S.createId('style'),name:profile.name+'（副本）',baseline:null}));return;}
                if(action==='import'){mount.querySelector('#writingSkillFile').click();return;}
                if(action==='export-md'){
                    const skill=profile.skill||W.normalize({manual:S.buildInfluencePrompt(S.createAppliedStyle(profile))});
                    await o.download('SKILL.md',W.markdown(skill,profile.name),'text/markdown');o.notify('写作 Skill 已导出','success');return;
                }
                if(action==='export-json'){await o.download('starlight-writing-skill.json',W.exportArchive(S.normalizeProfile(profile)),'application/json');o.notify('完整写作档案已导出','success');return;}
                const skill=W.normalize(profile.skill);if(!skill)return;
                if(action==='remove-sample')skill.samples.splice(Number(button.dataset.index),1);
                else if(action==='add-sample')skill.samples.push({id:'user_'+Date.now(),text:'',scene:'通用',start:null,end:null});
                else return;
                update(skill);render(o.profile());
            }catch(error){o.notify(error.message,'error');}
        });
        mount.addEventListener('change',async event=>{
            if(event.target.id!=='writingSkillFile')return;
            const file=event.target.files?.[0];if(!file||o.busy()||importing)return;
            importing=true;
            try{
                if(file.size>W.MAX_IMPORT)throw new Error('请选择不超过 2 MB 的写作档案');
                const input=W.importArchive(await file.text(),file.name);
                if(o.busy())throw new Error('请等待当前任务结束后再导入');
                o.add(S.createProfile(input));o.notify('已导入为新档案；应用前可查看和编辑','success');
            }catch(error){o.notify(error.message,'error');}finally{importing=false;}
        });
        return {render,refreshPrompt};
    }
    return {create};
});
