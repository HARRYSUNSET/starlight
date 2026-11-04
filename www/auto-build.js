(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.StarlightAutoBuild=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
    'use strict';
    const id=prefix=>prefix+'_'+Date.now()+'_'+Math.random().toString(36).slice(2,9);
    const integer=(n,f,min,max)=>Number.isFinite(Number(n))?Math.min(max,Math.max(min,Math.round(Number(n)))):f;
    const text=(v,max=6000)=>typeof v==='string'?v.slice(0,max):'';
    const count=value=>Array.from(String(value||'').replace(/\s/g,'')).length;
    function normalize(value){
        const v=value||{},s=v.settings||{};
        const targetMin=integer(s.targetMin,2000,200,60000);
        return {version:1,mode:['generating','awaiting','paused'].includes(v.mode)?v.mode:'off',
            nextNumber:integer(v.nextNumber,1,1,1000000),initialized:v.initialized===true,
            settings:{targetMin,targetMax:integer(s.targetMax,Math.max(targetMin,3000),targetMin,60000),
                styleNote:text(s.styleNote,4000),notes:text(s.notes,6000),nextNote:text(s.nextNote,4000),titles:s.titles!==false},
            lastError:text(v.lastError,500),lastChapterId:text(v.lastChapterId,150)};
    }
    function inferNext(work){
        const values=(work.conversations||[]).map(m=>m.chapterNumber).concat((work.chapters||[]).map(c=>c.chapterNumber));
        const numeral=value=>{if(/^\d+$/.test(value))return Number(value);let total=0,current=0;const digits='零一二三四五六七八九';for(const c of value){const n=digits.indexOf(c);if(n>=0){current=n;continue;}const unit={十:10,百:100,千:1000}[c];if(unit){total+=(current||1)*unit;current=0;}}return total+current;};
        const titles=[...(work.chapters||[]).map(c=>c.title),...(work.conversations||[]).map(m=>String(m.content||'').trim().split('\n')[0])];
        for(const title of titles){const match=String(title||'').match(/^(?:#+\s*)?(?:第\s*([零一二三四五六七八九十百千\d]+)\s*[章回节]|chapter\s+(\d+))/i);if(match)values.push(numeral(match[1]||match[2]));}
        return Math.max(0,...values.filter(n=>Number.isInteger(n)&&n>0))+1;
    }
    function ensure(work){
        const state=normalize(work.autoBuild);
        if(!state.initialized)state.nextNumber=inferNext(work);
        work.autoBuild=state;return state;
    }
    function createTask(work){
        const state=ensure(work),settings={...state.settings};
        state.initialized=true;
        return {id:id('autotask'),chapterId:id('chapter'),number:state.nextNumber,settings,createdAt:Date.now()};
    }
    function instructions(task){
        const s=task.settings;
        return ['【自动构筑 · 第'+task.number+'章｜作者的生成任务，不是已发生的剧情】',
            '依据当前世界书、角色、有效记忆和最新正式正文，自主组织并一次写出完整的一章小说。已有正文时承接最新结尾；尚无正文时从开场场景展开。',
            '本章目标约 '+s.targetMin+'—'+s.targetMax+' 字。可以安排多轮对白与自然的场景发展；不要复述上一章，不机械套用起承转合或段尾升华，不提前写下一章。',
            s.titles?'正文开头可给出“第'+task.number+'章”及简短标题。':'仅输出正文，目录中的章号由软件记录。',
            s.styleNote&&'【作者的表达补充｜冲突时优先于文风档案】\n'+s.styleNote,
            s.notes&&'【持续创作要求】\n'+s.notes,
            s.nextNote&&'【仅本章要求】\n'+s.nextNote,
            '各角色根据既有经历、目的与信息自然行动，成长须有剧情依据。创作要求与未来计划不是故事事实；只输出本章成品正文。'].filter(Boolean).join('\n\n');
    }
    function query(work,task){
        const latest=[...(work.conversations||[])].reverse().find(m=>m.role==='assistant');
        return [task.settings.notes,task.settings.nextNote,latest?.content?.slice(-2400),'第'+task.number+'章，承接当前场景与未完成事件'].filter(Boolean).join('\n');
    }
    function messages(work,base,task){
        return [...base,{role:'user',content:instructions(task)}];
    }
    function result(work,task,content){
        const state=normalize(work.autoBuild),body=String(content||'').trim();
        if(!body)throw new Error('本章未返回有效正文，章号未推进');
        const list=[...(work.conversations||[])],index=list.length;
        const taskMessage={id:task.id,role:'user',kind:'autoTask',source:'auto',userAuthored:false,
            content:instructions(task),autoTask:task,createdAt:task.createdAt,inspirationExcluded:true};
        const chapterMessage={id:id('message'),role:'assistant',content:body,chapterId:task.chapterId,
            chapterNumber:task.number,source:'auto',createdAt:Date.now(),bookmarked:false};
        list.push(taskMessage,chapterMessage);
        const first=body.split('\n')[0].replace(/^#+\s*/, '').trim();
        const title=/^第.{1,16}章|^chapter\s+\d+/i.test(first)?first.slice(0,120):'第 '+task.number+' 章';
        state.mode='awaiting';state.lastChapterId=task.chapterId;state.nextNumber=task.number+1;state.lastError='';
        if(state.settings.nextNote===task.settings.nextNote)state.settings.nextNote='';
        return {...work,incompleteDraft:work.incompleteDraft?.autoTask?.id===task.id?null:work.incompleteDraft,conversations:list,chapters:[...(work.chapters||[]),{id:task.chapterId,index:index+1,title,automatic:true,chapterNumber:task.number}],autoBuild:state};
    }
    function undo(work){
        const state=normalize(work.autoBuild),last=(work.conversations||[]).at(-1);
        if(last?.source==='auto'&&Number.isInteger(last.chapterNumber)){state.nextNumber=last.chapterNumber;state.mode='paused';state.lastChapterId='';const task=work.conversations.at(-2)?.autoTask;if(!state.settings.nextNote&&task?.settings?.nextNote)state.settings.nextNote=task.settings.nextNote;}
        return state;
    }
    function outputTokens(task){return Math.ceil(task.settings.targetMax*1.3)+800;}
    return {normalize,ensure,createTask,instructions,query,messages,result,undo,count,inferNext,outputTokens};
});
