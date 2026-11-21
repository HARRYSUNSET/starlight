module.exports = async function roomPolicyBrowser() {
    let checks = 0, calls = 0, responseMode = 'valid';
    const check = (value, label) => { if (!value) throw new Error('建房关系设定 · ' + label); checks++; };
    const $ = selector => document.querySelector(selector);
    const settle = async () => {
        await window.StarlightMotion.whenIdle();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    const click = async selector => { $(selector).click(); await settle(); };
    const edit = (node, text) => { node.value = text; node.dispatchEvent(new Event('input', {bubbles:true})); };
    const wait = async (fn, label) => {
        for (let i = 0; i < 180; i++) {
            if (await fn()) return;
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('等待 ' + label + ' 超时');
    };
    const received = [];
    const originalFetch = window.fetch;
    window.fetch = async (url, options) => {
        if (new URL(url, location.href).hostname !== 'api.deepseek.com') return originalFetch(url, options);
        calls++;
        const body = JSON.parse(options.body), data = JSON.parse(body.messages.at(-1).content);
        received.push(data);
        if (!data.members) throw new Error('建房时发出意外的模型请求');
        if (responseMode === 'skip') {
            return new Promise((resolve,reject) => options.signal.addEventListener('abort',
                () => reject(new DOMException('skip','AbortError')), {once:true}));
        }
        const profiles = data.members.map(member => ({
            id:member.id, baseline:'认识多年的邻居', preferences:'重视归还借书', boundaries:'先问过再借', conditions:'共同整理书架',
        }));
        if (responseMode === 'invalid') profiles[profiles.length - 1].id = '不属于房间的角色';
        return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({profiles})}}]}));
    };
    async function create(mode) {
        responseMode = mode;
        const start = calls, name = '建房关系回归 ' + mode + Date.now();
        await click('#btnHamburger'); await click('[data-home-tab="room"]'); await click('#homeAddRoom');
        check(!$('#roomInitPolicy').checked && !$('#roomInitPolicyRow').hidden, '新建时可选且默认关闭');
        const count = mode === 'invalid' ? 2 : 1;
        if (count > 1) await click('[data-room-type="group"]');
        edit($('#roomNameInput'),name);
        edit($('#roomUserPersonaInput'),'楼下书店的店员');
        edit($('#roomScenePromptInput'),'周六午后的书店');
        while (document.querySelectorAll('#roomParticipantsEditor .member-name').length < count) await click('#btnAddRoomParticipant');
        document.querySelectorAll('#roomParticipantsEditor .member-name').forEach((el,i) => edit(el,'图书管理员' + i));
        document.querySelectorAll('#roomParticipantsEditor .member-persona').forEach(el => edit(el,'在意借书期限，喜欢仔细整理书架。'));
        if (mode !== 'off') await click('#roomInitPolicy');
        $('#btnConfirmRoom').click();
        if (mode === 'skip') {
            await wait(() => calls > start && !$('#roomSkipPolicy').hidden, '出现跳过按钮');
            await click('#roomSkipPolicy');
        }
        await wait(() => $('#currentAgentName').textContent === name, '手动创建房间');
        await settle();
        const state = await window.__qaReadState(), room = state.rooms.find(r => r.name === name);
        check(!!room && !room.messages.length && !room.experience.relationHistory.length, '建档只保存设定，没有编入对白或分数');
        check(calls - start === (mode === 'off' ? 0 : 1), '模型请求次数遵循开关 ' + mode);
        check(room.participants.every(member => member.relationshipPolicy.preferences === (mode === 'valid' ? '重视归还借书' : '')), '档案完整写入或完整放弃 ' + mode);
        if (mode === 'valid') {
            check(received.at(-1).members[0].persona.includes('借书期限') && received.at(-1).userPersona.includes('店员'), '请求使用当前角色与用户的设定');
            await click('#btnRoomJournal');
            if (!$('#roomAuthorView').checked) await click('#roomAuthorView');
            check($('#roomRelationPreferences').value === '重视归还借书' && $('#roomRelationBaseline').value === '认识多年的邻居', '作者视图可查看自动形成的关系资料');
            edit($('#roomRelationBoundaries'),'借书前先登记');
            await click('#roomRelationSave');
            await click('#roomExperienceClose');
            await click('#btnChatSettings');
            check($('#roomInitPolicyRow').hidden, '编辑已有房间不重复初始化');
            await click('#btnConfirmRoom');
            await wait(() => !StarlightMotion.isOpen($('#roomModalOverlay')), '保存编辑');
            const latest = await window.__qaReadState();
            const backup = StarlightArchive.createBackup(latest,{mode:'room',id:room.id});
            const copied = StarlightArchive.parseBackup(JSON.stringify(backup)).state.rooms[0];
            check(copied.participants[0].relationshipPolicy.boundaries === '借书前先登记' && calls - start === 1, '手改的档案可备份且无重复请求');
        }
    }
    async function retryStorageFailure() {
        const name = '建房写入重试 '+Date.now();
        const settings = () => JSON.parse(localStorage.getItem('deepseek_chat_platform_v3_settings') || '{}');
        await click('#btnHamburger'); await click('[data-home-tab="room"]'); await click('#homeAddRoom');
        edit($('#roomNameInput'),name); edit($('#roomUserPersonaInput'),'旧书店的访客');
        if (!$('#roomParticipantsEditor .member-name')) await click('#btnAddRoomParticipant');
        edit($('#roomParticipantsEditor .member-name'),'归档员');
        edit($('#roomParticipantsEditor .member-persona'),'喜欢按月份整理账本。');
        responseMode='valid';
        const beforePolicyRequests=calls;
        await click('#roomInitPolicy');
        const previous = await window.__qaReadState(), owner = settings().currentRoomId;
        const write = StarlightPersistence.writeState;
        let rejectWrite = null, injected = false;
        StarlightPersistence.writeState = (db,snapshot) => {
            if (!injected && snapshot.rooms.some(room => room.name === name)) {
                injected = true;
                return new Promise((resolve,reject) => { rejectWrite = reject; });
            }
            return write(db,snapshot);
        };
        try {
            $('#btnConfirmRoom').click();
            await wait(() => !!rejectWrite,'等待房间写入');
            const whileSaving = await window.__qaReadState();
            check(whileSaving.currentRoomId === previous.currentRoomId && !whileSaving.rooms.some(room => room.name === name) &&
                settings().currentRoomId === owner && $('#currentAgentName').textContent !== name,'写入完成前数据库、启动设置和界面仍指向原作品');
            rejectWrite(new DOMException('测试写入失败','QuotaExceededError')); rejectWrite = null;
            await wait(() => $('#roomModalLoading').hidden,'失败后解除保存锁');
            const failed = await window.__qaReadState();
            check(StarlightMotion.isOpen($('#roomModalOverlay')) && $('#roomNameInput').value === name &&
                $('#roomParticipantsEditor .member-persona').value === '喜欢按月份整理账本。' && !$('#btnConfirmRoom').disabled,'写入失败保留可再次提交的编辑器和人物草稿');
            check(failed.rooms.length === previous.rooms.length && failed.currentRoomId === previous.currentRoomId &&
                settings().currentRoomId === owner,'失败保持房间数量和原活动作品');
            await click('#btnConfirmRoom');
            await wait(() => !StarlightMotion.isOpen($('#roomModalOverlay')) && $('#currentAgentName').textContent === name,'第二次保存进入新房间');
            const saved = await window.__qaReadState(), added = saved.rooms.filter(room => room.name === name);
            check(added.length === 1 && saved.rooms.length === previous.rooms.length + 1 &&
                saved.currentRoomId === added[0].id && settings().currentRoomId === added[0].id,'重试只新增一个房间，持久化后才切换活动作品');
            check(calls === beforePolicyRequests + 1 && added[0].participants[0].relationshipPolicy.preferences === '重视归还借书',
                '重试保留已生成的关系档案，仅调用一次模型');
        } finally {
            rejectWrite?.(new DOMException('结束模拟写入','AbortError'));
            StarlightPersistence.writeState=write;
        }
    }
    try {
        for (const mode of ['off','valid','invalid','skip']) await create(mode);
        await retryStorageFailure();
        await click('#btnHamburger'); await click('[data-home-tab="story"]'); await click('#homeStoryList [data-work-id="ui-story"]');
        return {checks};
    } finally { window.fetch = originalFetch; }
};
