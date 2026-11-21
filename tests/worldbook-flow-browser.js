module.exports = async function worldBookFlowBrowser() {
    let checks = 0;
    function check(value, label) {
        if (!value) throw new Error(label);
        checks++;
    }
    const el = selector => {
        const node = document.querySelector(selector);
        if (!node) throw new Error('找不到 ' + selector);
        return node;
    };
    const settle = async () => {
        await StarlightMotion.whenIdle();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    const click = async selector => { el(selector).click(); await settle(); };
    const type = (selector, value) => {
        el(selector).value = value;
        el(selector).dispatchEvent(new Event('input', {bubbles:true}));
    };
    const read = window.__qaReadState;
    const wait = async (predicate, label) => {
        for (let attempt = 0; attempt < 240; attempt++) {
            if (await predicate()) return;
            await new Promise(resolve => setTimeout(resolve, 40));
        }
        throw new Error('等待超时 ' + label + ' ' + document.querySelector('.toast')?.textContent);
    };
    const findWork = async mode => (await read())[mode === 'story' ? 'agents' : 'rooms']
        .find(item => item.name === (mode === 'story' ? '测试灯塔剧情' : '测试灯塔房间'));
    const texts = entries => entries.flatMap(entry => entry.fields.map(field => field.value));
    const entry = (label, value, evidence) => ({
        fields:[{label, value}], evidence, knowledgeScope:'public', characterIds:[],
    });
    const importText = '临海镇终年多雾，渔民靠灯塔导航。修灯人姓沈，右眼有疤，脾气倔。';
    const imports = [
        entry('世界名称', '临海镇', '临海镇终年多雾，渔民靠灯塔导航。'),
        {...entry('角色名称', '沈师傅', '修灯人姓沈，右眼有疤，脾气倔。'), fields:[
            {label:'角色名称',value:'沈师傅'}, {label:'角色外貌',value:'右眼有疤'}, {label:'角色性格',value:'脾气倔'},
        ]},
    ];
    const storyFact = '林澈拿到了灯塔钥匙。';
    const rewriteFact = '林澈归还了灯塔钥匙。';
    const sceneFact = '天亮时，城南的木桥已经修好。';
    const dialogueFact = '我已经搬回灯塔了。';
    let responseText = storyFact;
    const finish = value => new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));
    const stream = value => new Response('data: ' + JSON.stringify({choices:[{delta:{content:value}}]}) +
        '\n\ndata: ' + JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]}) + '\n\ndata: [DONE]\n\n');
    const originalFetch = window.fetch, originalConfirm = window.confirm, requests = [];
    const extractions = [];
    let badProgress = false;
    window.confirm = () => true;
    window.fetch = async (url, options) => {
        if (new URL(url,location.href).hostname !== 'api.deepseek.com') return originalFetch(url,options);
        const body = JSON.parse(options.body);
        requests.push(body);
        if (body.stream) return stream(body.response_format ? JSON.stringify({expression:'点点头',speech:dialogueFact}) : responseText);
        const system = body.messages[0].content;
        if (system.includes('房间关系证据核对器')) return finish({judgements:[]});
        const payload = JSON.parse(body.messages.at(-1).content);
        if (payload.source === importText) return finish({entries:imports});
        if (typeof payload.source !== 'string') throw new Error('意外请求');
        extractions.push({body, source:payload.source});
        const event = [storyFact,rewriteFact,sceneFact,dialogueFact].find(value => payload.source.includes(value));
        if (!event) throw new Error('提取范围错误 ' + payload.source.slice(0,80));
        const proposed = entry('具体变化',event,badProgress ? '原文里没有的句子' : event);
        if (event === dialogueFact) proposed.characterChanges = [{memberId:payload.participants[0].id,section:'state'}];
        return finish({entries:[proposed]});
    };
    async function action(name) {
        el('#messagesContainer [data-message-index]:last-child').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
        await settle();
        await click('[data-message-action="' + name + '"]');
    }
    try {
        await click('#btnHamburger');
        await click('[data-home-tab="story"]');
        await click('#homeAddStory');
        type('#newAgentName','测试灯塔剧情');
        type('#storyWorldBookEditor .worldbook-field-value','保留我的初始世界');
        await click('#storyWorldBookTools .wb-import summary');
        type('#storyWorldBookTools .wb-source',importText);
        await click('#storyWorldBookTools .wb-analyze');
        await wait(() => !el('#storyWorldBookTools .wb-apply').hidden,'初始卡片');
        check(document.querySelectorAll('#storyWorldBookTools .wb-candidate').length === 2,'分别提取世界与人物卡');
        await click('#storyWorldBookTools .wb-apply');
        await click('#storyWorldBookTools .wb-auto');
        await click('#btnConfirmCreate');
        await wait(async () => !!await findWork('story'), '新剧情落盘');
        let story = await findWork('story');
        check(texts(story.worldBook.initialEntries).includes('保留我的初始世界'),'导入保留已填的旧栏');
        check(texts(story.worldBook.initialEntries).includes('右眼有疤') && texts(story.worldBook.initialEntries).includes('脾气倔'),'人物外貌和性格按栏保存');
        check(requests.length === 1 && story.conversations.length === 0,'保存设定未发起额外调用');
        type('#messageInput','下一章要写主角还没有做到的计划：炸毁钟楼。');
        await click('#btnSend');
        await wait(async () => texts((await findWork('story')).worldBook.progressEntries).includes(storyFact),'普通正文写入进展');
        check(extractions.length === 1 && extractions[0].source === storyFact,'只提取正式剧情正文，提示词计划不作事实');
        check(extractions[0].body.thinking.type === 'disabled' && extractions[0].body.response_format.type === 'json_object','独立非思考结构化整理');
        responseText = rewriteFact;
        await action('regenerate');
        await wait(async () => texts((await findWork('story')).worldBook.progressEntries).includes(rewriteFact),'改写后的进展');
        story = await findWork('story');
        check(!texts(story.worldBook.progressEntries).includes(storyFact) && story.conversations.length === 2,'重写既不多存消息也不复活旧进展');
        await action('undo');
        await wait(async () => (await findWork('story')).worldBook.progressEntries.length === 0,'撤回正文同步撤回来源进展');
        await click('#btnAutoBuild');
        await wait(async () => texts((await findWork('story')).worldBook.progressEntries).includes(rewriteFact),'自动构筑的正式章节');
        story = await findWork('story');
        check(story.autoBuild.mode === 'awaiting' && story.worldBook.progressEntries.length === 1,'构筑章末确认与增量整理可同时工作');
        await click('#autoBuildPause');
        const frozen = JSON.stringify(story.worldBook);
        await click('#btnHamburger');
        await click('[data-home-tab="room"]');
        await click('#homeAddRoom');
        type('#roomNameInput','测试灯塔房间');
        type('#roomUserPersonaInput','灯塔管理员');
        if (!document.querySelector('#roomParticipantsEditor .member-name')) await click('#btnAddRoomParticipant');
        type('#roomParticipantsEditor .member-name','小秋');
        type('#roomParticipantsEditor .member-persona','当地邮差');
        await click('#roomWorldBookTools .wb-import summary');
        type('#roomWorldBookTools .wb-source',importText);
        await click('#roomWorldBookTools .wb-analyze');
        await wait(() => !el('#roomWorldBookTools .wb-apply').hidden,'房间导入候选');
        await click('#roomWorldBookTools .wb-apply');
        await click('#roomWorldBookTools .wb-auto');
        await click('#btnConfirmRoom');
        await wait(async () => !!await findWork('room'),'房间落盘');
        let room = await findWork('room');
        check(room.participants.length === 1 && texts(room.worldBook.initialEntries).includes('沈师傅'),'房间人物档案不改变参与发言的角色');
        const before = extractions.length;
        await click('#btnRoomState');
        await click('#roomSceneManual');
        type('#roomSceneText',sceneFact);
        check(extractions.length === before && !(await findWork('room')).worldBook.progressEntries.length,'情景预览不进入世界书');
        await click('#roomSceneAccept');
        await wait(async () => texts((await findWork('room')).worldBook.progressEntries).includes(sceneFact),'采纳后的房间情景');
        room = await findWork('room');
        check(room.messages.length === 1 && extractions.length === before + 1,'采纳产生一次正式情景和一次整理');
        badProgress = true;
        type('#messageInput','你这周住在哪里？');
        await click('#btnSend');
        await wait(async () => (await findWork('room')).worldBook.automation.sources.some(row => row.status === 'failed'),'无依据的结果被隔离');
        room = await findWork('room');
        check(room.messages.at(-1).content.includes(dialogueFact) && room.worldBook.progressEntries.length === 1,'整理失败保留对白与已有世界书');
        badProgress = false;
        await click('#btnChatSettings');
        await click('#roomWorldBookTools .wb-retry');
        await click('#btnConfirmRoom');
        await wait(async () => texts((await findWork('room')).worldBook.progressEntries).includes(dialogueFact),'用户重试后新进展可用');
        const countBeforeDevelopments = requests.length;
        await click('#btnChatSettings');
        const panel = '#roomParticipantsEditor .member-development';
        await click(panel+' > details > summary');
        check(el(panel+' textarea').value === dialogueFact,'角色设定显示已证实的当前状态');
        check(el(panel+' blockquote').textContent === dialogueFact,'角色记录可展开原文依据');
        type(panel+' textarea','正在灯塔重新安顿生活。');
        await click(panel+' section > button');
        check(!document.querySelector(panel+' textarea'),'从人物设定移除后可单独恢复');
        await click(panel+' section > button');
        check(el(panel+' textarea').value === '正在灯塔重新安顿生活。','恢复使用保留作者修改');
        await click('#btnConfirmRoom');
        await wait(async () => (await findWork('room')).participants[0].developmentEdits?.some(edit => edit.text==='正在灯塔重新安顿生活。'),'编辑落盘');
        room = await findWork('room');
        check(StarlightRoomGrowth.prompt(room,room.participants[0],'').includes('正在灯塔重新安顿生活。') && requests.length === countBeforeDevelopments,'使用编辑后的人物补充，无新增接口调用');
        await action('undo');
        await wait(async () => (await findWork('room')).worldBook.progressEntries.length === 1,'房间只撤回对应对白的进展');
        room = await findWork('room');
        check(texts(room.worldBook.progressEntries).includes(sceneFact),'房间撤回保留更早情景');
        check(!StarlightRoomGrowth.prompt(room,room.participants[0],'').includes('重新安顿'),'来源撤回后人物当前状态不再带入');
        check(JSON.stringify((await findWork('story')).worldBook) === frozen,'两种模式各自保存世界书和自动整理任务');
        const archive = StarlightArchive.parseBackup(JSON.stringify(StarlightArchive.createBackup(await read(),{mode:'room',id:room.id})));
        const normalized = StarlightRooms.normalizeRoom(archive.state.rooms[0],StarlightMemory);
        check(JSON.stringify(normalized.worldBook) === JSON.stringify(room.worldBook),'备份读回保留人物资料、可见范围、来源和整理进度');
        return {checks, storyId:story.id, roomId:room.id};
    } finally {
        window.fetch = originalFetch;
        window.confirm = originalConfirm;
    }
};
