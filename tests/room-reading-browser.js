module.exports = async function roomReadingBrowser() {
    let checks = 0;
    function check(ok, label) {
        if (!ok) throw new Error('房间阅读 · ' + label);
        checks++;
    }
    const $ = selector => document.querySelector(selector);
    const settle = async () => {
        await window.StarlightMotion.whenIdle();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    const click = async selector => { $(selector).click(); await settle(); };
    const edit = (element, text) => { element.value = text; element.dispatchEvent(new Event('input', {bubbles:true})); };
    const wait = async (test, label) => {
        for (let n = 0; n < 200; n++) {
            if (await test()) return;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error('等待 ' + label + ' 超时');
    };
    const visible = selector => !!$(selector).getClientRects().length;
    const reachable = selector => {
        const node = $(selector), rect = node.getBoundingClientRect();
        return rect.width > 0 && node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    };
    const container = $('#messagesContainer');
    const gap = () => container.scrollHeight - container.scrollTop - container.clientHeight;
    const displacement = node => node.getBoundingClientRect().top - container.getBoundingClientRect().top;
    const originalFetch = window.fetch;
    const reference = (await window.__qaReadState()).rooms.find(room => room.id === 'ui-room').chatPanels;
    const streams = [];
    window.fetch = async (url, options) => {
        if (new URL(url, location.href).hostname !== 'api.deepseek.com') return originalFetch(url, options);
        const body = JSON.parse(options.body);
        if (!body.stream) return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"judgements":[]}'}}]}));
        return new Response(new ReadableStream({ start(controller) {
            const frame = chunk => controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(chunk) + '\n\n'));
            streams.push({
                write(content) { frame({ choices:[{delta:{content}}] }); },
                finish() { frame({ choices:[{delta:{},finish_reason:'stop'}] }); controller.close(); },
            });
        }}), {headers:{'Content-Type':'text/event-stream'}});
    };
    try {
        const name = '阅读交互回归 ' + Date.now();
        await click('#btnHamburger'); await click('[data-home-tab="room"]'); await click('#homeAddRoom');
        await click('[data-room-type="group"]');
        edit($('#roomNameInput'), name);
        edit($('#roomUserPersonaInput'), '借书讨论会的主持人。');
        while (document.querySelectorAll('#roomParticipantsEditor .member-name').length < 3) await click('#btnAddRoomParticipant');
        document.querySelectorAll('#roomParticipantsEditor .member-name').forEach((el,i) => edit(el, '发言者' + (i + 1)));
        document.querySelectorAll('#roomParticipantsEditor .member-persona').forEach(el => edit(el, '同班同学，正在讨论借书。'));
        $('#roomTurnModeSelect').value = 'all';
        await click('#btnConfirmRoom');
        await wait(() => $('#currentAgentName').textContent === name, '打开新房间');
        await settle();
        check(visible('#roomContextBar') && !visible('#roomInputTools') && !visible('#composerTools'), '默认顶部展开、底部简洁');
        await click('#btnRoomHeaderTools');
        check(!visible('#chatQuickTools') && !visible('#roomContextBar') && reachable('#btnHamburger') && reachable('#btnChatSettings'), '顶部收纳后保留返回和设置');
        await click('#btnRoomComposerTools');
        check(visible('#roomInputTools') && visible('#composerTools') && !visible('#roomContextBar'), '上下展开互不影响');
        await click('#btnContinueScene'); await click('#btnRoomComposerTools');
        check($('#messageInput').placeholder.includes('情景') && $('#btnSend').title.includes('预览'), '底部收纳后仍能区分情景预览');
        await click('#btnRoomComposerTools'); await click('#btnRoomDialogue'); await click('#btnRoomComposerTools');
        check(!document.activeElement.matches('input,textarea'), '收纳和展开不弹键盘');

        edit($('#messageInput'), '今天请大家依次讨论借书。\n' + '书目记录。\n'.repeat(42));
        await click('#btnSend');
        await wait(() => streams.length === 1, '第一名角色');
        const firstBubble = $('#roomStreamingMessage .message-bubble');
        const firstPart = '{"expression":"","speech":"第一段。' + '第一名角色讲起今天收到的新书。'.repeat(80);
        streams[0].write(firstPart); await wait(() => firstBubble.textContent.includes('第一段'), '流式首段');
        await settle();
        check(gap() <= 2 && reachable('#btnSend') && $('#btnSend').classList.contains('stop-mode'), '简洁输入栏可停止且首段自动跟读');
        container.dispatchEvent(new WheelEvent('wheel', {deltaY:-400}));
        container.scrollTop = 180;
        container.dispatchEvent(new Event('scroll'));
        const firstRow = $('[data-message-index="0"]'), offset = displacement(firstRow);
        streams[0].write('继续交谈。'.repeat(30) + '"}'); streams[0].finish();
        await wait(() => streams.length === 2, '第二名角色'); await settle();
        check(Math.abs(displacement(firstRow) - offset) <= 2, '换人发言保持首条可见消息偏移');
        check($('#message-1 .message-bubble') === firstBubble, '流式气泡原地成为正式对白');
        check(visible('#btnJumpLatest') && $('#btnJumpLatest').hasAttribute('data-updates'), '回看前文时显示新回复入口');
        await click('#btnRoomHeaderTools');
        check(Math.abs(displacement(firstRow) - offset) <= 2, '展开顶部不会打断正在阅读的位置');
        streams[1].write('{"expression":"","speech":"第二段。' + '书页中夹着一张纸。'.repeat(50));
        await wait(() => $('#roomStreamingMessage').textContent.includes('第二段'), '第二名角色发言');
        check(Math.abs(displacement(firstRow) - offset) <= 2, '新分片到达不打断阅读');
        await click('#btnJumpLatest');
        check(gap() <= 2 && !visible('#btnJumpLatest'), '点新回复恢复跟读');
        streams[1].write('后记。'.repeat(50) + '"}'); streams[1].finish();
        await wait(() => streams.length === 3, '第三名角色');
        streams[2].write('{"expression":"","speech":"第三段。' + '第三名角色拿来了笔记本。'.repeat(28));
        await wait(() => $('#roomStreamingMessage').textContent.includes('第三段'), '第三名角色发言');
        await settle(); check(gap() <= 2, '连贯跟读后续角色');
        container.scrollTop -= 240; container.dispatchEvent(new Event('scroll'));
        container.scrollTop = container.scrollHeight; container.dispatchEvent(new Event('scroll'));
        streams[2].write('最后的答复。'.repeat(40) + '"}'); streams[2].finish();
        await wait(() => !$('#btnSend').classList.contains('stop-mode'), '正式保存'); await settle();
        check(gap() <= 2 && !$('#roomStreamingMessage'), '手动滑回后持续跟读至收尾');
        const readRoom = async () => (await window.__qaReadState()).rooms.find(work => work.name === name);
        await wait(async () => (await readRoom())?.messages.length === 4, '四条记录写入本机存储');
        const room = await readRoom();
        check(room.messages.length === 4 && new Set(room.messages.slice(1).map(item => item.speakerId)).size === 3, '三名角色各自保存一次');

        if (visible('#roomContextBar') === reference.headerExpanded) await click('#btnRoomHeaderTools');
        if (visible('#roomInputTools') === reference.composerExpanded) await click('#btnRoomComposerTools');
        await click('#btnHamburger');
        await click('#homeRoomList [data-work-id="ui-room"]');
        check(visible('#roomContextBar') === reference.headerExpanded && visible('#roomInputTools') === reference.composerExpanded, '其他房间保有独立布局');
        await click('#btnHamburger'); await click('#homeRoomList [data-work-id="' + room.id + '"]');
        check(visible('#roomContextBar') !== reference.headerExpanded && visible('#roomInputTools') !== reference.composerExpanded, '重开房间恢复各自折叠状态');
        await click('#btnHamburger'); await click('[data-home-tab="story"]'); await click('#homeStoryList [data-work-id="ui-story"]');
        check(!visible('#btnRoomHeaderTools') && !visible('#btnRoomComposerTools') && visible('#composerTools') && visible('#chatQuickTools'), '剧情模式的工具完整保留');
        return {checks};
    } finally {
        window.fetch = originalFetch;
    }
};
