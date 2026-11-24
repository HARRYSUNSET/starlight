(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StarlightRoomDesire = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const RELATION_KEYS = ['familiarity', 'trust', 'affection'];
    const LIMITS = { initialValue:[0,100], hoursPerPoint:[0.25,720], sensitivity:[0,300], resetValue:[0,99] };
    const DEFAULTS = { initialValue:0, hoursPerPoint:6, sensitivity:100, resetValue:8, peakBehavior:'' };
    const active = room => room?.roomType === 'double' && room.desireEnabled === true;
    const numeric = (value, min, max) => typeof value === 'number' && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value)) : undefined;
    const clean = (value, max = 300) => typeof value === 'string' ? value.trim().slice(0,max) : '';
    const score = value => Math.round(numeric(value,0,100)*1e8)/1e8;

    function settings(input = {}) {
        const result = Object.fromEntries(Object.entries(LIMITS)
            .map(([key,range])=>[key,numeric(input?.[key],...range) ?? DEFAULTS[key]]));
        result.peakBehavior = clean(input?.peakBehavior,2000);
        result.rules = (Array.isArray(input?.rules)?input.rules:[]).flatMap(rule=>{
            const thresholds = Object.fromEntries(RELATION_KEYS.flatMap(key=>{
                const value=numeric(rule?.thresholds?.[key],0,100);
                return value===undefined?[]:[[key,value]];
            }));
            const hoursPerPoint=numeric(rule?.hoursPerPoint,...LIMITS.hoursPerPoint);
            const resetValue=numeric(rule?.resetValue,...LIMITS.resetValue);
            return Object.keys(thresholds).length && (hoursPerPoint!==undefined||resetValue!==undefined)
                ? [{thresholds,hoursPerPoint,resetValue}] : [];
        });
        return result;
    }

    function effective(config, relation) {
        const rule=config.rules.find(item=>Object.entries(item.thresholds).every(([key,value])=>
            relation?.knownDimensions.includes(key) && relation[key]>=value));
        return {hoursPerPoint:rule?.hoursPerPoint ?? config.hoursPerPoint, resetValue:rule?.resetValue ?? config.resetValue};
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
        if(!active(room)||!turnId)return false;
        const records=sources(room,turnId);
        return inActivePeriod(room.experience?.desire,records) && records.some(message=>message.role==='assistant');
    }

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
        effect.desireBefore ??= {value:current.value,environment:current.environment,revision:current.revision};
        effect.desireApplied[kind]=true;
        const before=current.value;
        current.value=score(value);
        current.history.push({turnId,kind,before,after:current.value,source});
    }

    function apply(room, experience, turnId, rawSignals, options = {}) {
        if(!active(room))return;
        const records=sources(room,turnId);
        if(!records.some(record=>record.role!=='user'))return;
        const current=experience.desire;
        if(!inActivePeriod(current,records))return;
        const config=room.desireSettings;
        const relation=experience.relations[room.participants[0]?.id];
        const values=effective(config,relation);
        const time=options.minutes!==undefined ? {minutes:options.minutes,source:{id:records[0].id,quote:'采纳时确认的经过时长'}} :
            records.map(record=>{
                const detected=elapsed(record.content);
                return detected&&{minutes:detected.minutes,source:{id:record.id,quote:detected.quote}};
            }).find(Boolean);
        const events=signals(rawSignals).flatMap(signal=>{
            const record=records.find(item=>item.id===signal.sourceId&&item.content.includes(signal.quote));
            return record?[{...signal,source:{id:record.id,quote:signal.quote}}]:[];
        });
        if(!time?.minutes&&!events.length&&!options.environment&&!options.release)return;
        if(!Object.hasOwn(room.turnEffects,turnId)) Object.defineProperty(room.turnEffects,turnId,
            {value:{},writable:true,enumerable:true,configurable:true});
        room.turnEffects[turnId] ??= {};
        const effect=room.turnEffects[turnId];
        effect.desireApplied ??= {};
        if(time?.minutes>0&&!effect.desireApplied.time){
            remember(room,current,turnId,'time',current.value+time.minutes/(60*values.hoursPerPoint),time.source);
        }
        // Apply a round's environment before its completion, regardless of provider field order.
        const signal=events.find(item=>item.type==='environment');
        const fingerprint=!signal?'':signal.direction+':'+signal.factor.normalize('NFKC').replace(/[\p{P}\s]/gu,'').toLowerCase();
        const strength=options.environment ?? (signal&&fingerprint!==current.environment ?
            (signal.direction==='raise'?1:-1)*signal.strength : 0);
        if(strength&&!effect.desireApplied.environment&&!effect.desireApplied.release){
            const source=options.environment===undefined ? signal.source : {id:records[0].id,quote:'采纳时确认的环境变化'};
            remember(room,current,turnId,'environment',current.value+strength*config.sensitivity/100,source);
            current.environment=options.environment===undefined?fingerprint:'';
        }
        const release=events.find(item=>item.type==='release'&&!/(?:如果|假如|想要|试图|差点|还没|尚未|假装|回想|回忆|上一次|almost\b|pretend\b|\bnot yet)/iu.test(item.quote));
        if((options.release||release)&&!effect.desireApplied.release){
            const source=options.release?{id:records[0].id,quote:'采纳时确认的完成事件'}:release.source;
            remember(room,current,turnId,'release',Math.min(current.value,values.resetValue),source);
        }
    }

    function revert(experience,turnId,effect,legacy) {
        const current=experience.desire;
        const before=effect?.desireBefore;
        if(before&&current.revision===before.revision){
            current.value=before.value;
            current.environment=before.environment;
        }else if(!before&&legacy?.knownDimensions?.includes('desire')&&current.revision===0&&current.history.length===0){
            current.value=numeric(legacy.desire,0,100) ?? current.value;
        }
        current.history=current.history.filter(item=>item.turnId!==turnId);
    }

    function calibrate(current,value){
        current.value=score(value);
        current.initialized=true;
        current.revision++;
    }

    function prompt(room,experience){
        if(!active(room))return '';
        const value=experience.desire.value;
        const high=value>=100;
        return ['【角色当前性欲度｜独立状态，只供表演参考】', '当前 '+Math.floor(value)+'/100。',
            high?'已达到峰值。按角色的意愿、习惯与处境主动寻找合适的纾解时机，可以独自处理或简略带过。按人物意愿推进；只有正式剧情确实完成才会结算回落。':'与长期关系分开，结合人设和眼前的情境自然体现。',
            high&&room.desireSettings.peakBehavior?'角色在峰值时的倾向：'+room.desireSettings.peakBehavior:''].filter(Boolean).join('\n');
    }

    return { RELATION_KEYS, LIMITS, SIGNAL_GUIDE, active, settings, effective, state, canJudge, normalizeElapsed, normalizeEnvironment, signals, apply, revert, calibrate, prompt };
});
