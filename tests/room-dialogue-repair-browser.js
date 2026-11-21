module.exports = async function roomDialogueRepairBrowser() {
    let checks = 0;
    const check = (ok, hint) => { if (!ok) throw new Error('房间对白修正 · '+hint); checks++; };
    const node = selector => {
        const element = document.querySelector(selector);
        if (!element) throw new Error('缺少控件 '+selector);
        return element;
    };
    const settle = async () => {
        await StarlightMotion.whenIdle();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    const click = async selector => { node(selector).click(); await settle(); };
    const input = (element,value) => {
        element.value = value; element.dispatchEvent(new Event('input',{bubbles:true}));
    };
    const read = window.__qaReadState;
    const before = await read();
    let id = '';
    const work = async () => (await read()).rooms.find(room => room.id === id);
    const unlocked = () => !node('#btnSend').classList.contains('stop-mode') && !node('#btnSend').disabled;
    const wait = async (predicate,hint) => {
        for (let i=0;i<220;i++) {
            if (await predicate()) return;
            await new Promise(resolve => setTimeout(resolve,35));
        }
        throw new Error('超时 '+hint+'，'+document.querySelector('.toast')?.textContent);
    };
    const calls = [], streams = [], repairs = [];
    let held = null;
    const wrong = quote => JSON.stringify({draft:{visible:'抬眼',quote},memo:'DRAFT_MARKER'});
    const correct = quote => ({speech:quote,expression:'抬眼'});
    const answer = value => new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));
    const originalFetch = window.fetch;
    window.fetch = async (url,options) => {
        if (new URL(url,location.href).hostname !== 'api.deepseek.com') return originalFetch(url,options);
        const body = JSON.parse(options.body);
        const system = body.messages[0].content;
        if (body.stream) {
            calls.push('生成');
            const text = streams.shift();
            if (!text) throw new Error('意外的对白生成请求');
            const events = [
                {delta:{reasoning_content:'PRIVATE_REASON_MARKER'}},
                {delta:{content:text}},
                {delta:{},finish_reason:'stop'},
            ].map(choice => 'data: '+JSON.stringify({choices:[choice]})+'\n\n');
            return new Response(events.join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
        }
        if (system.includes('房间对白格式修正')) {
            calls.push('修正');
            check(body.response_format?.type === 'json_object' && body.thinking?.type === 'disabled','修正使用独立非思考 JSON 请求');
            check(!JSON.stringify(body.messages).includes('DRAFT_MARKER') && !JSON.stringify(body.messages).includes('PRIVATE_REASON_MARKER'),
                '修正不携带草稿元数据和推理过程');
            const step = repairs.shift();
            if (!step) throw new Error('意外的额外修正请求');
            if (step.hold) return new Promise((resolve,reject) => {
                held = {signal:options.signal,release:() => resolve(answer(step.value))};
                options.signal.addEventListener('abort',() => reject(new DOMException('已停止','AbortError')),{once:true});
            });
            return answer(step.value);
        }
        if (system.includes('房间关系证据核对器')) {
            calls.push('核对');
            const data = JSON.parse(body.messages.at(-1).content);
            return answer({judgements:data.characters.map(actor => ({memberId:actor.id,kind:'greeting',
                familiarity:0,trust:0,affection:0,sources:[],reason:''}))});
        }
        throw new Error('意外的模型请求 '+system.slice(0,40));
    };
    const counts = type => calls.filter(value => value === type).length;
    async function send(text) { input(node('#messageInput'),text); await click('#btnSend'); }
    async function regenerate() {
        node('#messagesContainer [data-message-index]:last-child').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
        await settle();
        await click('[data-message-action="regenerate"]');
    }
    async function drafts() { await click('#btnRoomJournal'); await click('[data-room-tab="drafts"]'); }
    try {
        await click('#btnHamburger');await click('[data-home-tab="room"]');await click('#homeAddRoom');
        await click('[data-room-type="group"]');
        const name = '格式修正回归 '+Date.now();
        input(node('#roomNameInput'),name);input(node('#roomUserPersonaInput'),'来访的同学。');
        while (document.querySelectorAll('#roomParticipantsEditor .member-name').length < 2) await click('#btnAddRoomParticipant');
        document.querySelectorAll('#roomParticipantsEditor .member-name').forEach((el,i) => input(el,i?'小梅':'阿桑'));
        document.querySelectorAll('#roomParticipantsEditor .member-persona').forEach(el => input(el,'重视守时。'));
        node('#roomTurnModeSelect').value='all';node('#roomTurnModeSelect').dispatchEvent(new Event('change',{bubbles:true}));
        await click('#btnConfirmRoom');
        await wait(async () => (id = (await read()).rooms.find(r => r.name===name)?.id),'新建房间');

        const first='明天见。';
        streams.push(wrong(first));repairs.push({value:correct(first)});
        await send('@阿桑 明早也来吗？');
        await wait(async () => unlocked() && (await work()).messages.at(-1)?.dialogue?.speech===first,'首次自动修正');
        let room = await work();
        check(room.messages.length===2 && room.messages[0].turnId===room.messages[1].turnId,'成功修正归入同一原始回合');
        check(counts('生成')===1 && counts('修正')===1 && counts('核对')===1 && !room.experience.candidates.length,'只生成一次、修正一次、核对一次');
        check(!JSON.stringify(room.messages).includes('DRAFT_MARKER') && !room.messages.at(-1).content.includes('"speech"'),'正式记录只包含渲染后的对白');
        const old = room.messages.at(-1), second = '我会来的。';
        streams.push(wrong(second));repairs.push({hold:true,value:correct(second)});
        await regenerate();
        await wait(() => held,'重写进入修正阶段');
        check(JSON.stringify((await work()).messages.at(-1))===JSON.stringify(old),'修正中的重写保留完整原回复');
        held.release();held=null;
        await wait(async () => unlocked() && (await work()).messages.at(-1)?.dialogue?.speech===second,'修正后替换原回复');
        room = await work();
        check(room.messages.length===2 && room.messages[1].id!==old.id && room.messages[1].turnId===old.turnId,'重写仅替换对应角色的原回复');

        const saved = JSON.stringify(room.messages.at(-1)), previousJudges = counts('核对');
        streams.push(wrong('推门。'));repairs.push({value:{expression:'',speech:''}});
        await regenerate();
        await wait(async () => unlocked() && (await work()).experience.candidates.length===1,'重写修正失败退出生成状态');
        room = await work();
        check(JSON.stringify(room.messages.at(-1))===saved && counts('核对')===previousJudges,'重写双重失败保留原回复和关系');
        const oldCandidate = room.experience.candidates[0].id;
        const unchangedRepairs = counts('修正');
        streams.push(JSON.stringify(correct('午后见。')));
        await send('@阿桑 那就午后见。');
        await wait(async () => unlocked() && (await work()).messages.at(-1)?.dialogue?.speech==='午后见。','带有待修稿仍能继续发送');
        check(counts('修正')===unchangedRepairs,'后续正常输出无需修正');
        await drafts();
        const stale = document.querySelector('[data-room-draft="'+oldCandidate+'"] [data-draft-repair]');
        if (stale) { stale.click(); await settle(); }
        check(counts('修正')===unchangedRepairs && (await work()).messages.length===4,'过期候选不会付费重试或插回过往消息');
        await click('#roomExperienceClose');

        const third='好的，周四见。', other='我记下日期了。', start = (await work()).messages.length;
        streams.push(wrong(third),JSON.stringify(correct(other)));repairs.push({value:{expression:'',speech:''}});
        await send('周四要不要一起去？');
        await wait(async () => unlocked() && (await work()).messages.at(-1)?.dialogue?.speech===other,'首位角色失败后余下角色继续');
        room=await work();
        const user=room.messages[start], tag=room.experience.candidates.find(d=>d.turnId===user.turnId);
        check(!!tag && room.messages.length===start+2 && room.messages.at(-1).speakerId===room.participants[1].id,'多人轮只隔离失败角色的输出');
        await drafts();
        const card='[data-room-draft="'+tag.id+'"]';
        repairs.push({value:correct(third)});
        const previousGeneration=counts('生成'), previousRepairs=counts('修正');
        await click(card+' [data-draft-repair]');
        await wait(async () => (await work()).messages.some(m=>m.turnId===user.turnId && m.dialogue?.speech===third),'手动重试当前候选并采纳');
        room=await work();
        const turn=room.messages.filter(m=>m.turnId===user.turnId);
        check(turn.length===3 && turn.filter(m=>m.role==='user').length===1 && new Set(turn.filter(m=>m.role==='assistant').map(m=>m.speakerId)).size===2,'修正同时保留另一角色发言且仅发布一份候选');
        check(counts('生成')===previousGeneration && counts('修正')===previousRepairs+1 && !room.experience.candidates.some(c=>c.id===tag.id),'显式重试只执行一次格式修正');
        await click('#roomExperienceClose');

        const beforeStop=room.messages.length, priorStreams=counts('生成'), priorDrafts=room.experience.candidates.length;
        streams.push(wrong('先到这里。'));repairs.push({hold:true,value:correct('先到这里。')});
        await send('那今天先到这里？');
        await wait(() => held,'可停止的修正请求');
        const stopped=held;
        await click('#btnSend');
        await wait(async () => unlocked() && (await work()).messages.length===beforeStop+1,'停止后恢复输入');
        stopped.release();held=null;await settle();
        room=await work();
        check(stopped.signal.aborted && counts('生成')===priorStreams+1 && room.messages.at(-1).role==='user','停止修正不生成剩余角色或发布晚到结果');
        check(room.experience.candidates.length===priorDrafts && !node('#messageInput').disabled,'主动停止没有新增待修稿，输入框可继续使用');

        const previousMessages=room.messages.length, retriesBefore=counts('修正');
        streams.push('   ');
        await send('@阿桑 还有空位吗？');
        await wait(async () => unlocked() && (await work()).messages.length===previousMessages+1,'空白回复留下可重试的用户轮');
        const unanswered=(await work()).messages.at(-1);
        input(node('#messageInput'),'下轮准备发送的草稿。');
        streams.push(JSON.stringify(correct('旁边还有一个空位。')));
        await regenerate();
        await wait(async () => unlocked() && (await work()).messages.at(-1)?.dialogue?.speech==='旁边还有一个空位。','长按用户气泡重试同一轮');
        room=await work();
        check(room.messages.length===previousMessages+2 && room.messages.at(-2).id===unanswered.id &&
            room.messages.at(-1).turnId===unanswered.turnId,'重试沿用原用户消息和回合编号');
        check(node('#messageInput').value==='下轮准备发送的草稿。' && counts('修正')===retriesBefore,
            '重试原轮保留未发送草稿，空白响应不消耗格式修正请求');
        const after=await read();
        check(JSON.stringify(before.agents.find(a=>a.id==='ui-story').conversations)===JSON.stringify(after.agents.find(a=>a.id==='ui-story').conversations),'房间修正保持剧情历史隔离');
        await click('#btnHamburger');await click('[data-home-tab="story"]');await click('#homeStoryList [data-work-id="ui-story"]');
        return {checks};
    } finally {
        held?.release();window.fetch=originalFetch;
    }
};
