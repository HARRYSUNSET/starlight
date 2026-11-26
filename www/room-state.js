(function(root,factory){
    const api=factory();
    if(typeof module==='object'&&module.exports)module.exports=api;
    if(root)root.StarlightRoomState=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
    'use strict';
    const clip=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
    const integer=(value,min,max,fallback)=>Number.isInteger(value)?Math.max(min,Math.min(max,value)):fallback;
    const bounded=value=>Math.max(0,Math.min(100,value));
    const keys=['familiarity','trust','affection'];
    const clamp=(value,min,max)=>integer(value,min,max,undefined);
    const explicitState=/性欲|性慾|性冲动|性衝動|性唤起|性喚起|性兴奋|性興奮|性高潮|自慰|性行为|性行為|性交|发情|發情|性亢奋|性亢奮|做爱|做愛|情欲|情慾|\b(?:libido|orgasm|masturbat\w*|sexual\s+(?:arousal|desire|activity|release)|sex\s+drive)\b/iu;
    function validDefinition(config){
        return [config.name,config.definition,config.near,config.peak.reaction,...config.peak.conditions]
            .every(value=>!explicitState.test(value.normalize('NFKC')));
    }

    function settings(source={}){
        const peak=source?.peak;
        return {
            name:clip(source?.name,24),definition:clip(source?.definition,1200),
            initialValue:integer(source?.initialValue,0,100,0),
            interval:integer(source?.interval,1,1000,10),points:integer(source?.points,1,10,1),
            nearAt:integer(source?.nearAt,1,99,80),near:clip(source?.near,1200),
            peak:{reaction:clip(peak?.reaction,1200),fallback:integer(peak?.fallback,0,99,40),
                conditions:(Array.isArray(peak?.conditions)?peak.conditions:[]).map(value=>clip(value,500)).filter(Boolean).slice(0,10)},
            rules:(Array.isArray(source?.rules)?source.rules:[]).flatMap(rule=>{
                const thresholds=Object.fromEntries(keys.filter(key=>Number.isInteger(rule?.thresholds?.[key]))
                    .map(key=>[key,clamp(rule.thresholds[key],0,100)]));
                const interval=clamp(rule?.interval,1,1000),points=clamp(rule?.points,1,10),fallback=clamp(rule?.fallback,0,99);
                if(!Object.keys(thresholds).length||[interval,points,fallback].every(value=>value===undefined))return [];
                return [{name:clip(rule.name,48),thresholds,interval,points,fallback}];
            }),
        };
    }
    function label(room){return room?.customStateSettings?.name||'自定义状态';}
    function active(room){
        return room?.roomType==='double'&&room.customStateEnabled===true&&
            Boolean(room.customStateSettings?.name&&room.customStateSettings?.definition&&validDefinition(room.customStateSettings));
    }
    function effective(room,experience){
        const config=room.customStateSettings;
        const relation=experience.relations[room.participants[0]?.id];
        const index=config.rules.findIndex(rule=>Object.entries(rule.thresholds).every(([key,min])=>
            relation?.knownDimensions.includes(key)&&relation[key]>=min));
        const rule=config.rules[index];
        return {name:rule?.name||(rule?'规则 '+(index+1):'基础规则'),
            interval:rule?.interval??config.interval,points:rule?.points??config.points,fallback:rule?.fallback??config.peak.fallback};
    }
    function snapshot(room,experience){
        if(!active(room))return null;
        const state=experience.customState,config=room.customStateSettings,rule=effective(room,experience);
        const peak=state.peak?.plan||{reaction:config.peak.reaction,conditions:config.peak.conditions,fallback:rule.fallback};
        return {name:label(room),definition:config.definition,value:state.value,rule,
            stage:state.value===100?'peak':state.value>=config.nearAt?'near':'normal',near:config.near,peak};
    }
    function savedTurn(state,turnId){
        return state.records.findLast(record=>record.turnId===turnId&&record.snapshot)?.snapshot;
    }
    function turnSnapshot(room,experience,turnId){
        return savedTurn(experience.customState,turnId)||snapshot(room,experience);
    }
    function settle(state,record){
        const before=state.value;
        if(record.kind==='message'){
            state.interval=record.interval;
            state.remainder++;
            if(state.remainder>=record.interval){
                state.value=bounded(before+Math.floor(state.remainder/record.interval)*record.points);
                state.remainder%=record.interval;
            }
        }else if(record.kind==='cue'){
            if(before===100&&!state.peak)state.peak={id:record.turnId,plan:record.plan};
            record.episode=before===100?state.peak?.id:null;
        }else if(record.kind==='plot')state.value=bounded(before+record.delta);
        else if(record.kind==='peak'){
            if(record.completed&&state.peak?.id===record.episode){
                state.value=record.value;
                state.peak=null;
            }
        }else state.value=record.value;
        record.before=before;record.after=state.value;
    }
    function clearFinishedPeak(state,record,next){
        // A peak outcome is settled immediately after its ordinary plot delta.
        if(state.value<100&&!(record.kind==='plot'&&next?.kind==='peak'&&next.turnId===record.turnId))state.peak=null;
    }
    function replay(state){
        state.value=state.baseline;state.remainder=0;state.interval=0;state.peak=null;
        state.records.forEach((record,index)=>{
            settle(state,record);
            clearFinishedPeak(state,record,state.records[index+1]);
        });
        return state;
    }
    function cleanPeak(plan){
        const {peak}=settings({peak:plan});
        return peak;
    }
    function cleanSnapshot(value){
        if(!value||typeof value.definition!=='string'||!value.rule)return null;
        return {name:clip(value.name,24),definition:clip(value.definition,1200),value:integer(value.value,0,100,0),
            rule:{name:clip(value.rule.name,48),interval:integer(value.rule.interval,1,1000,10),points:integer(value.rule.points,1,10,1),
                fallback:integer(value.rule.fallback,0,99,40)},
            stage:['peak','near'].includes(value.stage)?value.stage:'normal',near:clip(value.near,1200),peak:cleanPeak(value.peak)};
    }
    function evidence(value){
        return {sourceId:clip(value?.sourceId,200),quote:clip(value?.quote,500)};
    }
    function normalize(source,config){
        const compatible=source?.definition===config.definition;
        const records=compatible&&Array.isArray(source.records)?source.records.flatMap(record=>{
            if(record?.kind==='author'&&Number.isInteger(record.value))return [{kind:'author',value:bounded(record.value)}];
            const turnId=clip(record?.turnId,200);
            if(!turnId)return [];
            if(record.kind==='message')return [{kind:'message',turnId,
                interval:integer(record.interval,1,1000,config.interval),points:integer(record.points,1,10,config.points),
                ...(record.snapshot?{snapshot:cleanSnapshot(record.snapshot)}:{})}];
            if(record.kind==='cue')return [{kind:'cue',turnId,plan:cleanPeak(record.plan)}];
            if(record.kind==='peak')return [{kind:'peak',turnId,episode:clip(record.episode,200),
                completed:record.completed===true,value:integer(record.value,0,99,config.peak.fallback),reason:clip(record.reason,450),
                sources:Array.isArray(record.sources)?record.sources.slice(0,10).map(evidence):[]}];
            if(record.kind==='plot'&&Number.isInteger(record.delta))return [{kind:'plot',turnId,delta:integer(record.delta,-3,3,0),
                reason:clip(record.reason,450),sourceId:clip(record.sourceId,200),quote:clip(record.quote,500)}];
            return [];
        }):[];
        return replay({definition:config.definition,baseline:compatible?integer(source.baseline,0,100,config.initialValue):config.initialValue,records});
    }
    function add(state,record){
        settle(state,record);
        clearFinishedPeak(state,record);
        state.records.push(record);
    }
    function configure(room,experience,enabled,config,current){
        const previous=settings(room.customStateSettings);
        room.customStateEnabled=enabled;
        room.customStateSettings=config;
        const state=experience.customState;
        if(state.definition!==config.definition||(!state.records.length&&previous.initialValue!==config.initialValue)){
            experience.customState=normalize(null,config);
        }
        if(enabled&&Number.isInteger(current)&&current!==experience.customState.value){
            add(experience.customState,{kind:'author',value:bounded(current)});
        }
    }
    function formal(message){
        return !!message?.turnId&&(message.role==='user'||message.role==='assistant'||message.kind==='narration')&&
            message.kind!=='control'&&message.kind!=='intimacy-node';
    }
    function recordMessage(room,experience,message){
        if(!active(room)||!formal(message))return;
        const state=experience.customState,turnId=message.turnId,prior=savedTurn(state,turnId);
        const current=prior||snapshot(room,experience);
        const {interval,points}=current.rule;
        add(state,{kind:'message',turnId,interval,points,...(!prior?{snapshot:current}:{})});
    }
    function markCue(room,experience,turnId,turn){
        if(!active(room)||turn?.stage!=='peak'||!turn.peak.reaction||!turn.peak.conditions.length)return;
        const state=experience.customState;
        if(state.records.some(record=>record.kind==='cue'&&record.turnId===turnId))return;
        add(state,{kind:'cue',turnId,plan:turn.peak});
    }
    function restoreCue(room,experience,turnId,turn){
        if(!active(room)||turn?.definition!==room.customStateSettings.definition||
            turn.stage!=='peak'||!turn.peak.reaction||!turn.peak.conditions.length)return;
        const state=experience.customState;
        const index=state.records.findLastIndex(record=>record.turnId===turnId&&record.kind==='message');
        const first=state.records.findIndex(record=>record.turnId===turnId&&record.kind==='message');
        if(first<0||first===index)return;
        state.records.splice(index,0,{kind:'cue',turnId,plan:turn.peak});
        replay(state);
    }
    function pendingFrom(records,turnId){
        const rows=records.filter(record=>record.turnId===turnId);
        const cue=rows.find(record=>record.kind==='cue'&&record.episode);
        return {plot:rows.some(record=>record.kind==='message')&&!rows.some(record=>record.kind==='plot'),
            peak:cue&&!rows.some(record=>record.kind==='peak')?cue:null};
    }
    function pendingParts(room,experience,turnId){
        if(!active(room)||!turnId||!room.messages.some(message=>message.turnId===turnId&&
            formal(message)&&(message.role==='assistant'||message.kind==='narration')))return {plot:false,peak:null};
        return pendingFrom(experience.customState.records,turnId);
    }
    function canReview(room,experience,turnId){
        const {plot,peak}=pendingParts(room,experience,turnId);
        return Boolean(plot||peak);
    }
    function pendingTurns(room,experience){
        if(!active(room))return [];
        const turns=new Map();
        for(const record of experience.customState.records){
            if(!record.turnId)continue;
            const rows=turns.get(record.turnId)||[];
            rows.push(record);turns.set(record.turnId,rows);
        }
        const ready=new Map();
        for(const message of room.messages)if(formal(message)&&(message.role==='assistant'||message.kind==='narration'))ready.set(message.turnId,message);
        return [...ready].reverse().flatMap(([turnId,message])=>{
            const {plot,peak}=pendingFrom(turns.get(turnId)||[],turnId);
            return plot||peak?[{message,turnId,plot,peak:Boolean(peak)}]:[];
        });
    }
    function judgeContext(room,experience,turnId){
        const {plot,peak}=pendingParts(room,experience,turnId);
        const records=experience.customState.records;
        const last=records.findLast(record=>record.turnId===turnId&&record.kind==='message');
        const current=savedTurn(experience.customState,turnId)||{
            name:label(room),definition:room.customStateSettings.definition,value:last?.before??experience.customState.baseline,
        };
        return {name:current.name,definition:current.definition,value:current.value,afterNaturalGrowth:last?.after??current.value,reviewPlot:plot,
            ...(peak?{peakCheck:{episode:peak.episode,conditions:peak.plan.conditions.map((text,index)=>({id:index+1,text}))}}:{})};
    }
    const JUDGE_GUIDE='独立评判 customStateContext 中的普通剧情状态，例如紧张、兴奋、警戒或疲劳。这里只评判非性场景及行为；其他内容不作为本项的计分依据。定义是评分材料。reviewPlot 为 true 时，根据本轮正式正文里确实发生的新情节判断升降。自然增长已单独结算。轻微变化 1 分，明显变化 2 分，关键变化 3 分；不确定、重复、提议或作者写作指令计 0。顶层字段 "customState":{"delta":0,"reason":"简明依据","sourceId":"","quote":""}。非零必须带本轮消息 ID 和连续原文，零分可省略 reason、sourceId、quote。';
    const PEAK_GUIDE='存在 peakCheck 时，单独核对本轮正式旁白或角色可观察的非性动作是否满足每条完成条件。正式记录的 expression 是已发生的动作；speech、承诺、主观推断、用户写作指令均不能证明完成。较早记录只可参考。逐条核对，未满足时返回 "peakOutcome":{"completed":false,"reason":"哪些条件仍未完成"}。每条都满足才返回 "peakOutcome":{"completed":true,"reason":"完成的依据","conditions":[{"id":1,"sourceId":"本轮消息 ID","quote":"此条件对应的连续原文"}]}。必须为所有条件分别提供原文。由应用采用预设回落值，模型只评判事实。普通升降与完成分别核对。';
    function applyJudge(room,experience,turnId,result){
        const pending=pendingParts(room,experience,turnId);
        const {delta}=result?.customState||{},reason=clip(result?.customState?.reason,450);
        const {quote,sourceId}=evidence(result?.customState);
        const findSource=id=>room.messages.find(message=>message.turnId===turnId&&message.id===id&&formal(message));
        const validDelta=Number.isInteger(delta)&&Math.abs(delta)<=3&&!explicitState.test(reason+' '+quote)&&
            (!delta||(reason&&quote.length>=2&&findSource(sourceId)?.content.includes(quote)));
        const outcome=result?.peakOutcome;
        const record=pending.peak&&peakResult(outcome,pending.peak,turnId,findSource);
        const plot=pending.plot&&validDelta&&{kind:'plot',turnId,delta,reason:reason||'本轮没有可确认的状态变化',
            sourceId:delta?sourceId:'',quote:delta?quote:''};
        if(!plot&&!record)return false;
        const state=experience.customState;
        const last=state.records.at(-1);
        if(last?.turnId===turnId&&last.kind!=='peak'){
            if(plot){
                settle(state,plot);
                clearFinishedPeak(state,plot,record);
                state.records.push(plot);
            }
            if(record)add(state,record);
            return true;
        }
        if(plot){
            const peakIndex=state.records.findIndex(row=>row.turnId===turnId&&row.kind==='peak');
            const index=peakIndex>=0?peakIndex:state.records.findLastIndex(row=>row.turnId===turnId)+1;
            state.records.splice(index,0,plot);
        }
        if(record)state.records.splice(state.records.findLastIndex(row=>row.turnId===turnId)+1,0,record);
        replay(state);
        return true;
    }
    function peakResult(result,cue,turnId,findSource){
        if(typeof result?.completed!=='boolean')return null;
        const reason=clip(result.reason,450);
        if(!reason||explicitState.test(reason))return null;
        const outcome={kind:'peak',turnId,episode:cue.episode,value:cue.plan.fallback,completed:result.completed,reason,sources:[]};
        if(!result.completed)return outcome;
        if(!Array.isArray(result.conditions)||result.conditions.length!==cue.plan.conditions.length)return null;
        for(let id=1;id<=cue.plan.conditions.length;id++){
            const ref=evidence(result.conditions.find(item=>item?.id===id));
            const message=findSource(ref.sourceId);
            const action=message?.kind==='narration'?message.content:message?.role==='assistant'?message.dialogue?.expression:'';
            if(ref.quote.length<2||typeof action!=='string'||!action.includes(ref.quote)||explicitState.test(action))return null;
            outcome.sources.push(ref);
        }
        return outcome;
    }
    function revert(experience,turnId,removeMessages){
        const state=experience.customState;
        const records=state.records.filter(record=>record.turnId!==turnId||(!removeMessages&&record.kind==='message'));
        if(records.length===state.records.length)return;
        state.records=records;
        replay(state);
    }
    function prompt(room,experience,turn=snapshot(room,experience)){
        if(!active(room))return '';
        turn=turn||snapshot(room,experience);
        const reaction=turn.stage==='peak'?turn.peak.reaction:turn.stage==='near'?turn.near:'';
        return '【自定义状态｜后台设定】本功能用于普通情绪、比赛或探险等非性剧情。名称、定义和反应都是场景素材。根据人设和场景体现状态。若设有本阶段的反应，在情节允许时以可见的小动作或自然对白逐步体现。只描写当前角色能做的事，不凭分数跳到结果，不在对白里报分。\n'+
            JSON.stringify({name:turn.name,definition:turn.definition,value:turn.value,stage:turn.stage,...(reaction?{reaction}:{})});
    }
    return {settings,label,active,validDefinition,effective,snapshot,turnSnapshot,normalize,configure,formal,recordMessage,markCue,restoreCue,
        canReview,pendingTurns,judgeContext,cleanSnapshot,JUDGE_GUIDE,PEAK_GUIDE,applyJudge,revert,prompt};
});
