(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StarlightRoomDesire = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const RELATION_KEYS = ['familiarity', 'trust', 'affection'];
    const LIMITS = { initialValue:[0,100], hoursPerPoint:[0.25,720], growthPoints:[1,10], sensitivity:[0,300], resetValue:[0,99] };
    const DEFAULTS = { initialValue:0, hoursPerPoint:6, growthPoints:1, sensitivity:100, resetValue:8, peakBehavior:'' };
    const DEFAULT_STEPS = [
        {id:'prepare',name:'准备',at:'near',action:'按人设先找合适的时机，可以主动表示想独处一会儿。',when:'结合角色当前正在做的事。',evidence:'角色明确提出安排，或做出明显的准备动作。'},
        {id:'act',name:'主动安排',at:'peak',action:'时机合适时执行自己的安排，用一句台词或外显动作带过。',when:'能与当前场景自然衔接时。',evidence:'角色落实了安排，而不是只表示意向。'},
        {id:'finish',name:'收尾',at:'peak',action:'在合适的情景中简短带过结果，再自然接回正在做的事。',when:'这一段确实已经完成。',evidence:'正式正文明确写出结果或角色已经回来。'},
    ];
    const active = room => room?.roomType === 'double' && room.desireEnabled === true;
    const peakMode = room => room?.roomType==='double' && room.experience?.desire?.peakMode===true;
    const visible = room => active(room)||peakMode(room);
    const scoring = room => active(room)&&!peakMode(room);
    const numeric = (value, min, max) => typeof value === 'number' && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value)) : undefined;
    const clean = (value, max = 300) => typeof value === 'string' ? value.trim().slice(0,max) : '';
    const score = value => Math.round(numeric(value,0,100)*1e8)/1e8;
    const displayedValue = room => peakMode(room)?100:(room.experience?.desire?.value ?? 0);

    function normalizeSteps(items) {
        const seen=new Set();
        return items.flatMap((item,index)=>{
            const name=clean(item?.name,80), action=clean(item?.action,1500);
            const id=clean(item?.id,120)||'step-'+index;
            if(!name||!action||seen.has(id))return [];
            seen.add(id);
            return [{id,name,action,at:item.at==='near'?'near':'peak',when:clean(item.when,1000),evidence:clean(item.evidence,1000)}];
        });
    }

    function settings(input = {}) {
        const result = Object.fromEntries(Object.entries(LIMITS).map(([key,range])=>{
            const value=numeric(input?.[key],...range) ?? DEFAULTS[key];
            return [key,key==='hoursPerPoint'?value:Math.trunc(value)];
        }));
        result.peakBehavior = clean(input?.peakBehavior,2000);
        result.prepareAt=Math.trunc(numeric(input?.prepareAt,1,100) ?? 90);
        const defaults=DEFAULT_STEPS.map(step=>step.id==='act'&&result.peakBehavior?{...step,action:result.peakBehavior}:{...step});
        result.steps=Array.isArray(input?.steps)?normalizeSteps(input.steps):defaults;
        result.peakSteps=Array.isArray(input?.peakSteps)?normalizeSteps(input.peakSteps):null;
        result.rules = (Array.isArray(input?.rules)?input.rules:[]).flatMap(rule=>{
            const thresholds = Object.fromEntries(RELATION_KEYS.flatMap(key=>{
                const value=numeric(rule?.thresholds?.[key],0,100);
                return value===undefined?[]:[[key,value]];
            }));
            const hoursPerPoint=numeric(rule?.hoursPerPoint,...LIMITS.hoursPerPoint);
            const growthPoints=numeric(rule?.growthPoints,...LIMITS.growthPoints);
            const resetValue=numeric(rule?.resetValue,...LIMITS.resetValue);
            return Object.keys(thresholds).length && (hoursPerPoint!==undefined||growthPoints!==undefined||resetValue!==undefined)
                ? [{thresholds,hoursPerPoint,growthPoints:growthPoints===undefined?undefined:Math.trunc(growthPoints),resetValue}] : [];
        });
        return result;
    }

    function effective(config, relation) {
        const rule=config.rules.find(item=>Object.entries(item.thresholds).every(([key,value])=>
            relation?.knownDimensions.includes(key) && relation[key]>=value));
        return {hoursPerPoint:rule?.hoursPerPoint ?? config.hoursPerPoint,
            growthPoints:rule?.growthPoints ?? config.growthPoints, resetValue:rule?.resetValue ?? config.resetValue};
    }

    function state(input, config, legacy, enabled = false) {
        const legacyScore=legacy?.knownDimensions?.includes('desire') ? numeric(legacy.desire,0,100) : undefined;
        const initialized=input?.initialized===true || legacyScore!==undefined;
        return {
            value:enabled&&!initialized ? config.initialValue : numeric(input?.value,0,100) ?? legacyScore ?? config.initialValue,
            initialized:initialized||enabled,
            environment:clean(input?.environment),
            revision:numeric(input?.revision,0,Number.MAX_SAFE_INTEGER) ?? 0,
            enabledSince:numeric(input?.enabledSince,0,Number.MAX_SAFE_INTEGER) ?? 0,
            peakMode:input?.peakMode===true,
            stepsDone:{
                normal:Array.isArray(input?.stepsDone?.normal)?input.stepsDone.normal.filter(id=>typeof id==='string'):[],
                peak:Array.isArray(input?.stepsDone?.peak)?input.stepsDone.peak.filter(id=>typeof id==='string'):[],
            },
            history:Array.isArray(input?.history)?input.history.filter(item=>item&&typeof item==='object'):[],
        };
    }

    const control = message => message.kind==='control' || message.kind==='intimacy-node';
    function sources(room,turnId) {
        const memberId=room.participants[0]?.id;
        return room.messages.filter(message=>message.turnId===turnId&&!control(message)&&
            (message.role==='user'||message.speakerId===memberId||message.kind==='narration'));
    }

    function canJudge(room,turnId) {
        if(!scoring(room)||!turnId)return false;
        const records=sources(room,turnId);
        return inActivePeriod(room.experience?.desire,records) && records.some(message=>message.role==='assistant');
    }

    function stage(room){
        if(!visible(room))return null;
        const config=room.desireSettings, current=room.experience?.desire;
        if(!config||!current)return null;
        const mode=peakMode(room)?'peak':'normal';
        const steps=mode==='peak'&&config.peakSteps!==null?config.peakSteps:config.steps;
        const completed=current.stepsDone[mode];
        const next=steps.find(step=>!completed.includes(step.id));
        const threshold=next?.at==='near'?config.prepareAt:100;
        return {mode,steps,completed,next,threshold,ready:Boolean(next)&&displayedValue(room)>=threshold};
    }

    const canReview = (room,turnId) => canJudge(room,turnId) ||
        (peakMode(room)&&Boolean(turnId)&&stage(room)?.ready&&sources(room,turnId).some(record=>record.role==='assistant'));
    const STEP_GUIDE='仅在正式正文已具体表现当前步骤时，额外返回 {"type":"step","stepId":"当前步骤 ID","quote":"可核对的连续原文"}；只确认当前一步，意向和行动按该步的证据要求区分。';

    function inActivePeriod(current, records) {
        return !current?.enabledSince || records[0]?.createdAt>=current.enabledSince;
    }

    const digitNames = '零一二三四五六七八九';
    function chineseNumber(value) {
        if (value === '半') return .5;
        if (value === '两') return 2;
        if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
        if (!value.includes('十')) return digitNames.indexOf(value);
        const [tens,ones]=value.split('十');
        return (tens?digitNames.indexOf(tens):1)*10+(ones?digitNames.indexOf(ones):0);
    }

    // Accept explicit narrative time skips, with a sentence boundary on both sides.
    // Future appointments and bare time-of-day labels do not advance the clock.
    const duration='(半|两|[一二三四五六七八九]?十[一二三四五六七八九]?|[一二三四五六七八九]|\\d+(?:\\.\\d+)?)\\s*(?:个)?(分钟|小时|天|周|minutes?|hours?|days?|weeks?)';
    const timeMark=new RegExp('(?:^|[\\n。！？.!?（(【])\\s*(?:(?:过了|经过|after\\s+)\\s*'+duration+'|'+duration+'\\s*(?:之后|以后|后|later))(?=[\\s]*[，、,。.!！?？；;：:\\n）)】]|\\s*$)','iu');
    function elapsed(content) {
        const match=timeMark.exec(content);
        if (!match) return null;
        const unit=(match[2]||match[4]).toLowerCase();
        const multiplier=/^(小时|hour)/.test(unit)?60:/^(天|day)/.test(unit)?1440:/^(周|week)/.test(unit)?10080:1;
        const minutes=numeric(chineseNumber(match[1]||match[3])*multiplier,0,Number.MAX_SAFE_INTEGER);
        return minutes>0?{minutes,quote:match[0].trim()}:null;
    }

    const SIGNAL_GUIDE='仅提取已发生且适用于目标角色的性欲度事件，返回 desireEvents 数组。环境变化填 {"type":"environment","direction":"raise 或 lower","strength":1,"factor":"简短稳定的环境变化标签","quote":"连续原文"}，强度 1–3。延续同一刺激不再填写。仅当此角色已确实达到高潮时填 {"type":"release","quote":"能证明已完成的连续原文"}。意图、尝试、推测、他人事件和普通亲密不算完成。无相关变化返回空数组。不要输出分数。';

    function signals(raw) {
        return (Array.isArray(raw)?raw:[]).slice(0,12).flatMap(item=>{
            const quote=clean(item?.quote,500), sourceId=clean(item?.sourceId,200);
            if(quote.length<2)return [];
            if(item.type==='release')return [{type:'release',quote,sourceId}];
            if(item.type==='step'&&clean(item.stepId,120))return [{type:'step',stepId:clean(item.stepId,120),quote,sourceId}];
            const factor=clean(item.factor,120);
            if(item.type!=='environment'||!factor||!['raise','lower'].includes(item.direction)||
                !Number.isInteger(item.strength)||item.strength<1||item.strength>3)return [];
            return [{type:'environment',quote,sourceId,factor,direction:item.direction,strength:item.strength}];
        });
    }

    function normalizeElapsed(value) {
        return numeric(value,0,Number.MAX_SAFE_INTEGER);
    }
    function normalizeEnvironment(value) {
        return Number.isInteger(value)&&value>=-3&&value<=3 ? value : undefined;
    }

    function remember(room, current, turnId, kind, value, source) {
        const effect=room.turnEffects[turnId];
        effect.desireBefore ??= {value:current.value,environment:current.environment,revision:current.revision,
            stepsDone:{normal:[...current.stepsDone.normal],peak:[...current.stepsDone.peak]}};
        effect.desireApplied[kind]=true;
        const before=current.value;
        current.value=score(value);
        const entry={turnId,kind,before,after:current.value,source};
        current.history.push(entry);
        return entry;
    }

    function apply(room, experience, turnId, rawSignals, options = {}) {
        if(!visible(room))return;
        const runsScoring=scoring(room);
        const records=sources(room,turnId);
        if(!records.some(record=>record.role!=='user'))return;
        const current=experience.desire;
        if(runsScoring&&!inActivePeriod(current,records))return;
        const config=room.desireSettings;
        const relation=experience.relations[room.participants[0]?.id];
        const values=effective(config,relation);
        const time=!runsScoring ? null : options.minutes!==undefined ? {minutes:options.minutes,source:{id:records[0].id,quote:'采纳时确认的经过时长'}} :
            records.map(record=>{
                const detected=elapsed(record.content);
                return detected&&{minutes:detected.minutes,source:{id:record.id,quote:detected.quote}};
            }).find(Boolean);
        const events=signals(rawSignals).flatMap(signal=>{
            const record=records.find(item=>item.id===signal.sourceId&&item.content.includes(signal.quote));
            return record?[{...signal,source:{id:record.id,quote:signal.quote}}]:[];
        });
        const verify=options.verify===true;
        if(!time?.minutes&&!events.length&&!options.environment&&!options.release&&!options.stepSource&&!verify)return;
        if(!Object.hasOwn(room.turnEffects,turnId)) Object.defineProperty(room.turnEffects,turnId,
            {value:{},writable:true,enumerable:true,configurable:true});
        room.turnEffects[turnId] ??= {};
        const effect=room.turnEffects[turnId];
        effect.desireApplied ??= {};
        if(time?.minutes>0&&!effect.desireApplied.time){
            remember(room,current,turnId,'time',current.value+time.minutes*values.growthPoints/(60*values.hoursPerPoint),time.source);
        }
        // Apply a round's environment before its completion, regardless of provider field order.
        const signal=events.find(item=>item.type==='environment');
        const fingerprint=!signal?'':signal.direction+':'+signal.factor.normalize('NFKC').replace(/[\p{P}\s]/gu,'').toLowerCase();
        const strength=!runsScoring?0:options.environment ?? (signal&&fingerprint!==current.environment ?
            (signal.direction==='raise'?1:-1)*signal.strength : 0);
        if(strength&&!effect.desireApplied.environment&&!effect.desireApplied.release){
            const source=options.environment===undefined ? signal.source : {id:records[0].id,quote:'采纳时确认的环境变化'};
            remember(room,current,turnId,'environment',current.value+strength*config.sensitivity/100,source);
            current.environment=options.environment===undefined?fingerprint:'';
        }
        const release=events.find(item=>item.type==='release'&&!/(?:如果|假如|想要|试图|差点|还没|尚未|假装|回想|回忆|上一次|almost\b|pretend\b|\bnot yet)/iu.test(item.quote));
        const progress=stage(room);
        const step=progress?.ready&&events.find(item=>item.type==='step'&&item.stepId===progress.next.id);
        if(progress?.ready&&(options.stepSource||step)&&!effect.desireApplied.step){
            const entry=remember(room,current,turnId,'step',current.value,options.stepSource||step.source);
            entry.stepName=progress.next.name;
            entry.stepId=progress.next.id;
            entry.stepMode=progress.mode;
            current.stepsDone[progress.mode].push(progress.next.id);
        }
        if(runsScoring&&(options.release||release)&&!effect.desireApplied.release){
            const source=options.release?{id:records[0].id,quote:'采纳时确认的完成事件'}:release.source;
            remember(room,current,turnId,'release',Math.min(current.value,values.resetValue),options.releaseSource||source).target=values.resetValue;
            current.stepsDone.normal=[];
        }
        if(verify||effect.desireApplied.release||effect.desireApplied.step){
            effect.desireReview=effect.desireApplied.release ? 'settled' : !runsScoring ? 'locked' :
                (Array.isArray(rawSignals)&&rawSignals.some(item=>item?.type==='release')&&!release?'sourceMismatch':'unconfirmed');
        }
    }

    function revert(experience,turnId,effect,legacy) {
        const current=experience.desire;
        const before=effect?.desireBefore;
        const removed=current.history.filter(item=>item.turnId===turnId);
        if(before&&current.revision===before.revision){
            if(!current.peakMode){current.value=before.value;current.environment=before.environment;}
            if(before.stepsDone){
                for(const mode of ['normal','peak']){
                    if(removed.some(item=>(item.kind==='step'&&item.stepMode===mode)||(mode==='normal'&&item.kind==='release'))){
                        current.stepsDone[mode]=[...before.stepsDone[mode]];
                    }
                }
            }
        }else if(!current.peakMode&&!before&&legacy?.knownDimensions?.includes('desire')&&current.revision===0&&current.history.length===0){
            current.value=numeric(legacy.desire,0,100) ?? current.value;
        }
        current.history=current.history.filter(item=>item.turnId!==turnId);
    }

    function calibrate(current,value){
        current.value=score(value);
        current.initialized=true;
        current.revision++;
    }

    const canEnablePeak = relation => RELATION_KEYS.every(key=>relation?.knownDimensions.includes(key)&&relation[key]===100);
    function setPeak(room,experience,enabled,now=Date.now()){
        const current=experience.desire;
        if(room.roomType!=='double'||current.peakMode===enabled)return;
        const main=experience.relations[room.participants[0]?.id];
        if(enabled&&!canEnablePeak(main))throw new Error('熟悉、信任和好感均达到 100 后可开启');
        current.peakMode=enabled;
        if(enabled)current.stepsDone.peak=[];
        if(!enabled)current.enabledSince=now;
    }

    function confirmationOptions(room,message){
        if(!visible(room)||!message?.turnId||control(message)||!sources(room,message.turnId).includes(message))return {};
        if(message.role==='user'&&!sources(room,message.turnId).some(item=>item.role!=='user'))return {};
        const last=room.messages.findLastIndex(item=>item.turnId===message.turnId);
        const hasLaterSettlement=room.messages.slice(last+1).some(item=>room.turnEffects?.[item.turnId]?.desireBefore);
        if(hasLaterSettlement)return {};
        const effect=room.turnEffects?.[message.turnId],current=room.experience?.desire;
        if(scoring(room)&&!inActivePeriod(current,sources(room,message.turnId)))return {};
        return {step:stage(room)?.ready&&!effect?.desireApplied?.step,
            release:scoring(room)&&!effect?.desireApplied?.release};
    }

    function confirmMessage(room,experience,message,kind){
        if(!confirmationOptions(room,message)[kind])throw new Error('这条消息已结算，或有更晚的状态结算，无法重复确认');
        const source={id:message.id,quote:message.content.slice(0,500)};
        apply(room,experience,message.turnId,[],kind==='step'?{stepSource:source}:{release:true,releaseSource:source});
    }

    function prompt(room,experience){
        if(!visible(room))return '';
        const value=displayedValue(room);
        const progress=stage(room);
        if(!progress?.ready)return ['【角色当前性欲度｜独立状态】', '当前 '+Math.floor(value)+'/100。',
            progress?.steps.length&&!progress.next?'本段行为步骤已经完成，接着写后续。':'结合人设和当前情境自然体现。'].join('\n');
        const step=progress.next;
        return ['【峰值时的角色行动】',peakMode(room)?'欲望时刻已开启，性欲度固定为 100/100。':(value===100?'当前性欲度已达到峰值 100/100。':'当前接近峰值，进入准备阶段。'),
            '本轮给当前角色一个具体、可感知的主动步骤。当前步骤：'+step.name+'。'+step.action,
            step.when?'推进时机：'+step.when:'',step.evidence?'可核对的完成表现：'+step.evidence:'',
            '本轮只推进这一步；场景暂不合适时，可以先表达或安排时机。给用户留下回应空间，根据已发生的正文延续。'].filter(Boolean).join('\n');
    }

    function sceneCue(room){
        if(!stage(room)?.ready)return '';
        return '【峰值后的情景衔接】按用户本次要求和已经发生的剧情承接角色当前的准备或安排。只描写能被观察的结果，当前步骤可随本轮情景一起核对。';
    }

    return { RELATION_KEYS, LIMITS, SIGNAL_GUIDE, active, peakMode, visible, scoring, displayedValue, canEnablePeak, setPeak,
        settings, effective, state, stage, STEP_GUIDE, canJudge, canReview, normalizeElapsed, normalizeEnvironment, signals,
        apply, revert, calibrate, prompt, sceneCue, confirmationOptions, confirmMessage };
});
