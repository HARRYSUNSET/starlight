module.exports = async function roomBuilderBrowser() {
    const $ = s => document.querySelector(s);
    const checks = [];
    const check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
    const settle = async () => {
        await StarlightMotion.whenIdle();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    async function click(s) { $(s).click(); await settle(); }
    function input(s,value,event = 'input') { $(s).value = value; $(s).dispatchEvent(new Event(event,{bubbles:true})); }
    async function wait(fn,label) {
        for (let i = 0; i < 200; i++) {
            if (await fn()) return;
            await new Promise(resolve => setTimeout(resolve,20));
        }
        throw new Error(label + ' ' + $('.rb-status')?.textContent + ' ' + $('.rb-preview small')?.textContent);
    }
    const read = window.__qaReadState;
    const calls = [];
    const firstTurnRequests = [];
    const orig = window.fetch;
    let delivery = 'normal', finishLate;
    const bookFact = '旧书局位于城北。';
    const member = (name,role) => ({name,personaPrompt:role,publicProfile:role,privateGoal:'找到旧信',
        relationshipPolicy:{baseline:'初次见面',preferences:'诚实守约',boundaries:'不动私人信件',conditions:'一起修书'}});
    const base = {name:'北城书局',subtitle:'书页与来客',scenePrompt:'雨夜，书局亮着灯。',userPersona:'书局的新店员',
        participants:[member('阿禾','修书师'),member('林岚','邮差')],
        worldEntries:[{fields:[{label:'地点',value:'城北旧书局'}],knowledgeScope:'public',characterNames:[],evidence:bookFact}]};
    let data = {...base,userPersona:''};
    window.fetch = async (url,options) => {
        if (new URL(url,location.href).hostname !== 'api.deepseek.com') return orig(url,options);
        const body = JSON.parse(options.body);
        if(body.stream) {
            firstTurnRequests.push(body);
            const content = body.response_format ? '   ' : '“你也是来收信的？”';
            return new Response('data: '+JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',
                {headers:{'Content-Type':'text/event-stream'}});
        }
        if(body.messages[0].content.includes('房间关系证据核对器')) {
            return new Response(JSON.stringify({choices:[{message:{content:'{"judgements":[]}'},finish_reason:'stop'}]}));
        }
        const payload = JSON.parse(body.messages.at(-1).content);
        calls.push({body,payload});
        if (delivery === 'error') return new Response('{}',{status:503});
        const response = () => new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}]}));
        if (delivery === 'late') return new Promise(resolve => { finishLate = () => resolve(response()); });
        return response();
    };
    const openBuilder = async () => { await click('.room-builder > summary'); };
    const preview = async () => {
        await click('.rb-generate');
        await wait(() => !$('.rb-accept').hidden,'设定预览未出现');
    };
    const openLibrary = async () => { await click('#btnHamburger'); await click('[data-home-tab="room"]'); };
    const room = async id => (await read()).rooms.find(r => r.id === id);
    try {
        const original = await read();
        await openLibrary();
        await click('#homeAddRoom');
        await openBuilder();
        input('.rb-mode','creative','change');
        input('.rb-text','设计一家雨夜书局，我是新店员。');
        check($('.rb-count').textContent.includes('1 次') && $('.rb-file-pick').hidden,'创作要求预报一次调用');
        delivery = 'error';
        await click('.rb-generate');
        await wait(() => $('.rb-status').textContent.includes('失败'),'没有报告构建错误');
        check(!$('#roomNameInput').value && (await read()).rooms.length === original.rooms.length,'模型失败不写房间和现有栏位');
        delivery = 'late';
        await click('.rb-generate');
        await wait(() => !!finishLate,'延迟响应');
        await click('.rb-stop');
        finishLate();
        await settle();
        check($('.rb-accept').hidden && !$('#roomNameInput').value,'停止后到达的结果不能被应用');
        delivery = 'normal';
        $('#roomInitPolicy').checked = true;
        const beforeAI = calls.length;
        await preview();
        check($('.rb-create').disabled && !$('.rb-self input').checked,'原文或种子未指定用户身份时保留选择权');
        $('.rb-self input').click();
        check(calls.at(-1).payload.mode === 'creative' && calls.at(-1).body.response_format.type === 'json_object','创作要求使用房间结构化请求');
        const choices = [...document.querySelectorAll('.rb-preview .rb-choice input[type=radio]')];
        check(choices.length === 2 && choices.filter(c => c.checked).length === 1,'双人模式允许从两个候选中选择一位');
        choices[1].click();
        check($('.rb-book').checked && $('.rb-growth').checked,'新 AI 房间明确提供两项自动化开关');
        $('.rb-book').click();
        $('.rb-growth').click();
        check($('.room-builder').scrollWidth <= $('.room-builder').clientWidth + 1,'预览在移动端无横向溢出');
        await click('.rb-create');
        await wait(async () => (await read()).rooms.length === original.rooms.length + 1,'双人房间未保存');
        const double = (await read()).rooms.at(-1);
        check(double.roomType === 'double' && double.participants.length === 1 && double.participants[0].name === '林岚','一键创建并进入选定的双人房');
        check(!double.participants[0].developmentEnabled && !double.worldBook.automation.enabled,'AI 建房 opt-out 持久化');
        check(double.participants[0].relationshipPolicy.preferences === '诚实守约' && calls.length === beforeAI+1,'角色偏好与边界随同一次请求生成，没有重复建档');
        check(!double.messages.length && double.userPersona.includes('用户扮演自己'),'显式选择以自己进入，预览内容只形成设定');
        input('#messageInput','有人在吗？');
        await click('#btnSend');
        await wait(async()=>!(document.querySelector('#btnSend').classList.contains('stop-mode')) && (await room(double.id)).messages.length===2,'建房首轮空白后应自动接话');
        const [asked,replied]=(await room(double.id)).messages;
        check(asked.turnId===replied.turnId && replied.speakerId===double.participants[0].id &&
            replied.dialogue.speech==='你也是来收信的？','AI 新房间首轮仅落盘一条用户发言及一条角色对白');
        const [initial,retry] = firstTurnRequests;
        check(firstTurnRequests.length===2 && initial.response_format.type==='json_object' && !retry.response_format &&
            retry.model===initial.model && retry.thinking.type===initial.thinking.type && retry.max_tokens===initial.max_tokens &&
            JSON.stringify(retry.messages)===JSON.stringify(initial.messages),'空白后仅解除服务端 JSON 格式约束，保留设定、历史与用户选择');

        await click('#btnChatSettings');
        await openBuilder();
        data = {...base, name:'风雨书铺',participants:[{...member('林岚','旧城信使'),speakingStyle:'惜字如金'}]};
        input('.rb-mode','creative','change');
        input('.rb-text','修改房间名称与邮差的说话方式。');
        await preview();
        check(calls.at(-1).payload.existing?.name === double.name && !JSON.stringify(calls.at(-1).payload).includes('找到旧信'),
            '已有房间可参考当前公开设定，角色私人目标不进入创作请求');
        const conflict = [...document.querySelectorAll('.rb-overwrite')].find(el => el.textContent.includes('风雨书铺'));
        check(!!conflict && !conflict.querySelector('input').checked,'覆盖已填资料须单独选择');
        conflict.querySelector('input').click();
        await click('.rb-edit');
        check($('#roomNameInput').value === '风雨书铺' && $('.member-persona').value === '邮差' && $('.member-style').value === '惜字如金','只替换选定冲突，空栏直接补齐');
        check((await room(double.id)).name === '北城书局','保存之前原有房间保持原样');
        await click('#btnConfirmRoom');
        await wait(async () => (await room(double.id)).name === '风雨书铺','编辑房间未落盘');
        check((await room(double.id)).participants[0].id === double.participants[0].id && !(await room(double.id)).worldBook.automation.enabled,'更新既有角色保留身份 ID 与自动化选择');

        await openLibrary();
        await click('#homeAddRoom');
        await click('[data-room-type="group"]');
        await click('#btnAddRoomParticipant');
        const slot = $('.participant-editor').dataset.memberId;
        await openBuilder();
        const facts = '北城众人。书页与来客。雨夜，书局亮着灯。我是书局的新店员。阿禾是修书师。林岚是邮差。';
        data = {...base,name:'北城众人',worldEntries:[],evidence:facts,evidenceByField:{name:'北城众人。'},
            participants:[{name:'阿禾',personaPrompt:'修书师',evidence:'阿禾是修书师。',evidenceByField:{personaPrompt:'阿禾是修书师。'}},
                {name:'林岚',personaPrompt:'邮差',evidence:'林岚是邮差。'}]};
        const long = facts + '雨'.repeat(5999-facts.length) + '。' + facts + '下一段。'.repeat(100);
        input('.rb-text',long);
        check($('.rb-count').textContent.includes('2 次'),'长原文预报分段请求数');
        const beforeParts = calls.length;
        await preview();
        check(calls.slice(beforeParts).map(x => x.payload.source).join('') === long,'原文逐段完整送入模型');
        check(document.querySelectorAll('.rb-preview .rb-choice input[type=checkbox]').length === 2,'分段提取的同名成员合并为两名候选');
        check($('.rb-preview').textContent.includes('阿禾是修书师。'),'严格模式展示人物的可核对原文');
        await click('.rb-edit');
        const cards = [...document.querySelectorAll('#roomParticipantsEditor .participant-editor')];
        check(cards.length === 2 && cards[0].dataset.memberId === slot && cards[0].querySelector('.member-name').value === '阿禾','空角色槽保留 ID 并填入识别出的姓名与档案');
        await click('#btnConfirmRoom');
        await wait(async () => (await read()).rooms.length === original.rooms.length+2,'多人房间未保存');
        const group = (await read()).rooms.at(-1);
        check(group.roomType === 'group' && !group.intimacy && group.participants.length === 2 && group.worldBook.automation.enabled,'填入后手动保存也保留多人房间和自动化默认设置');
        const storyData = agents => agents.map(s => [s.id,s.characters,s.worldBook,s.conversations]);
        check(JSON.stringify(storyData((await read()).agents)) === JSON.stringify(storyData(original.agents)),'建房全流程不改动剧情设定与正文');
        await click('#btnHamburger');
        await click('[data-home-tab="story"]');
        await click('#homeStoryList [data-work-id="ui-story"]');
        return {checks:checks.length};
    } finally { window.fetch = orig; }
};
