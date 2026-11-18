module.exports = async function worldBookEditorBrowser() {
    const checks = [];
    const assert = (value, label) => {
        if (!value) throw new Error(label);
        checks.push(label);
    };
    const wait = async fn => {
        for (let i = 0; i < 150; i++) {
            if (fn()) return;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error('世界书编辑页等待超时');
    };
    const settle = async () => {
        await window.StarlightMotion.whenIdle();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    const $ = selector => document.querySelector(selector);
    const tool = selector => $('#storyWorldBookTools ' + selector);
    const open = async () => {
        $('#btnChatSettings').click();
        await settle();
        tool('summary').click();
        await settle();
    };
    const close = async () => { $('#btnStoryEditorClose').click(); await settle(); };
    const canTouch = async node => {
        node.scrollIntoView({ block: 'center', behavior: 'instant' });
        await settle();
        const r = node.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.height >= 40 && r.left >= 0 && r.right <= innerWidth + 1 && node.contains(hit);
    };
    const input = value => {
        tool('.wb-source').value = value;
        tool('.wb-source').dispatchEvent(new Event('input', { bubbles: true }));
    };
    const beforeFetch = window.fetch;
    const requests = [];
    let pending = null;
    let replyMode = 'second-fails';
    window.fetch = async (url, options) => {
        if (new URL(url, location.href).hostname !== 'api.deepseek.com') return beforeFetch(url, options);
        const body = JSON.parse(options.body);
        const source = JSON.parse(body.messages.at(-1).content).source;
        requests.push(source);
        const value = source.slice(0, 8);
        const payload = { entries: [{ fields: [{ label: '书中地点', value }], evidence: value }] };
        const response = () => new Response(JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }],
        }));
        if (replyMode === 'second-fails' && requests.length === 2) return new Response('{}', { status: 503 });
        if (replyMode === 'hold') {
            return new Promise((resolve, reject) => {
                pending = () => resolve(response());
                options.signal.addEventListener('abort', () => reject(new DOMException('已停止', 'AbortError')), { once: true });
            });
        }
        if (replyMode === 'late') return new Promise(resolve => { pending = () => resolve(response()); });
        return response();
    };
    const work = state => state.agents.find(agent => agent.id === 'ui-story');
    const original = JSON.stringify(work(await window.__qaReadState()).worldBook);
    try {
        await open();
        assert(!document.activeElement?.matches('input,textarea'), '展开世界书工具保留移动端键盘关闭状态');
        for (const selector of ['.wb-pick', '.wb-analyze', '.wb-auto-label']) {
            assert(await canTouch(tool(selector)), '世界书编辑控件在屏幕内可点击 ' + selector);
        }
        const text = '北岸旧书店临水而建。' + '海'.repeat(5800) + '。' + '南巷咖啡馆面朝街角。' + '路'.repeat(300);
        const transfer = new DataTransfer();
        transfer.items.add(new File([text], '背景.txt', { type: 'text/plain' }));
        tool('.wb-file').files = transfer.files;
        tool('.wb-file').dispatchEvent(new Event('change'));
        await wait(() => tool('.wb-source').value === text);
        assert(requests.length === 0, '导入 TXT 只填入原文，手动分析前零请求');
        tool('.wb-analyze').click();
        await wait(() => tool('.wb-analyze').textContent === '继续分析');
        assert(requests.length === 2 && !tool('.wb-candidate'), '第二段失败时不提交部分条目');
        tool('.wb-analyze').click();
        await wait(() => tool('.wb-candidate'));
        assert(requests.length === 3 && requests[1] === requests[2], '重试从失败段继续');
        const cards = [...document.querySelectorAll('#storyWorldBookTools .wb-candidate')];
        assert(cards.length === 2 && cards.every(card => card.querySelector('blockquote').textContent), '候选条目逐条显示原文证据');
        cards[0].querySelector('input').click();
        assert(await canTouch(tool('.wb-apply')), '加入所选条目的操作在手机上可触达');
        tool('.wb-apply').click();
        assert($('#storyWorldBookEditor').querySelectorAll('.worldbook-origin').length >= 1, '确认后可在原编辑器查看出处');
        const row = $('#storyWorldBookEditor .worldbook-field');
        const valueBox = row.querySelector('textarea').getBoundingClientRect();
        const orderBox = row.querySelector('.field-order-actions').getBoundingClientRect();
        assert(valueBox.right <= orderBox.left + 1, '移动端世界书栏位操作不会遮住正文输入区');
        assert(JSON.stringify(work(await window.__qaReadState()).worldBook) === original, '设定页保存前不会写入作品');

        input('旧车站的售票厅一直亮着灯。');
        replyMode = 'hold';
        tool('.wb-analyze').click();
        await wait(() => Boolean(pending));
        tool('.wb-cancel').click();
        await wait(() => tool('.wb-status').textContent.includes('已停止'));
        assert(!tool('.wb-candidate') && !tool('.wb-analyze').disabled, '停止后原文可继续分析');
        replyMode = 'late';
        pending = null;
        tool('.wb-analyze').click();
        await wait(() => Boolean(pending));
        const late = pending;
        await close();
        await open();
        late();
        await settle();
        assert(!tool('.wb-candidate') && !tool('.wb-source').value, '关闭后到达的响应不会污染重开的编辑页');
        assert($('#storyEditor').scrollWidth <= $('#storyEditor').clientWidth + 1, '世界书编辑页无横向溢出');
        await close();
        assert(JSON.stringify(work(await window.__qaReadState()).worldBook) === original, '放弃设定后作品与进入前一致');
        return { checks: checks.length };
    } finally {
        window.fetch = beforeFetch;
    }
};
