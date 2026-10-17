/* Real Chrome layout checks. Uses an isolated profile and mock local conversations. */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const webRoot = path.join(root, 'www');
const chrome = process.env.STARLIGHT_CHROME_PATH || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(file => fs.existsSync(file));
if (!chrome) throw new Error('Chrome not found; set STARLIGHT_CHROME_PATH to its executable.');
const outputIndex = process.argv.indexOf('--screenshots');
const outputDir = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : null;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'starlight-ui-'));
    const server = http.createServer(async (req, res) => {
        try {
            const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
            const file = path.resolve(webRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
            if (!file.startsWith(webRoot + path.sep)) throw new Error('Invalid resource');
            const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'application/javascript' };
            const content = await fsp.readFile(file);
            res.writeHead(200, { 'Content-Type':mime[path.extname(file)] || 'application/octet-stream' });
            res.end(content);
        } catch (error) { res.writeHead(404); res.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = spawn(chrome, ['--headless=new','--no-first-run','--no-default-browser-check',
        '--disable-background-networking','--disable-background-timer-throttling','--disable-renderer-backgrounding',
        // Hosted Linux CI may disallow Chrome's user-namespace sandbox. This
        // isolated fixture browser uses no real data and blocks the API host;
        // production WebView and local interactive browsers are unchanged.
        ...(process.env.CI && process.platform === 'linux' ? ['--no-sandbox','--disable-dev-shm-usage'] : []),
        '--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],
    { windowsHide:true, stdio:['ignore','ignore','pipe'] });
    let socket;
    let sequence = 0;
    let sessionId;
    const pending = new Map();
    const exceptions = [];
    try {
        const wsUrl = await new Promise((resolve, reject) => {
            let log = '';
            const timeout = setTimeout(() => reject(new Error('Chrome did not start in 30 seconds: ' + log.slice(-6000))), 30000);
            browser.on('error', error => { clearTimeout(timeout); reject(error); });
            browser.once('exit', code => { clearTimeout(timeout); reject(new Error('Chrome exited before connection (' + code + '): ' + log.slice(-6000))); });
            browser.stderr.on('data', chunk => {
                log += String(chunk);
                const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
                if (match) { clearTimeout(timeout); resolve(match[1]); }
            });
        });
        socket = new WebSocket(wsUrl);
        await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once:true }); socket.addEventListener('error', reject, { once:true }); });
        socket.addEventListener('message', event => {
            const message = JSON.parse(String(event.data));
            if (message.id && pending.has(message.id)) {
                const callback = pending.get(message.id); pending.delete(message.id);
                if (message.error) callback.reject(new Error(JSON.stringify(message.error))); else callback.resolve(message.result);
            }
            if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
        });
        const send = (method, params = {}, browserLevel = false) => new Promise((resolve, reject) => {
            const id = ++sequence;
            pending.set(id, { resolve,reject });
            socket.send(JSON.stringify({ id,method,params,...(!browserLevel && sessionId ? { sessionId } : {}) }));
        });
        const target = await send('Target.createTarget', { url:'about:blank' }, true);
        const attached = await send('Target.attachToTarget', { targetId:target.targetId, flatten:true }, true);
        sessionId = attached.sessionId;
        await send('Runtime.enable');
        await send('Page.enable');
        await send('Network.enable');
        await send('Network.setBlockedURLs', { urls:['*api.deepseek.com*'] });
        await send('Page.bringToFront');
        await send('Emulation.setTouchEmulationEnabled', { enabled:true, maxTouchPoints:1 });
        const evaluate = async expression => {
            const response = await send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
            if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
            return response.result.value;
        };
        const conversations = Array.from({ length:236 }, (_, index) => ({
            role:index % 2 ? 'assistant' : 'user', content:index % 2
                ? `人物走进图书馆，接着刚才的话题。这里是第${index}条本地测试正文。\n` + '他们继续讨论刚才找到的书。'.repeat(18)
                : `第${Math.floor(index / 2) + 1}章，继续两个人的日常。`,
        }));
        const fixture = {
            activeMode:'story', currentAgentId:'ui-story', apiKey:'sk-local-test-only-not-a-real-key',
            storyMemorySettings:{enabled:false},roomMemorySettings:{enabled:false},
            agents:[{ id:'ui-story', name:'图书馆的午后', subtitle:'日常轻小说 · 本地测试剧情', characterPrompt:'角色A', conversations }],
            rooms:[{ id:'ui-room', name:'放学后的教室', subtitle:'多人互动 · 本地测试房间', roomType:'group',
                participants:[{ id:'member-a', name:'小夏', personaPrompt:'同班同学' },{ id:'member-b', name:'小秋', personaPrompt:'图书委员' }],
                messages:conversations.map((message,index) => ({ ...message, id:`room-msg-${index}`, speakerId:message.role === 'assistant' ? 'member-a' : null })) }],
        };
        await send('Page.addScriptToEvaluateOnNewDocument', { source:`if(location.origin===${JSON.stringify(origin)})localStorage.setItem('deepseek_chat_platform_v2',${JSON.stringify(JSON.stringify(fixture))});` });
        await send('Page.navigate', { url:origin + '/index.html' });
        for (let i = 0; i < 60; i++) {
            if (await evaluate('Boolean(document.querySelector("#homeStoryList .v2-work-card") && window.StarlightBack)')) break;
            await delay(100);
            if (i === 59) throw new Error('Application did not initialize: ' + JSON.stringify(exceptions));
        }
        const settle = () => evaluate('(async () => { await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); await window.StarlightMotion.whenIdle(); await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); })()');
        const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
        const resize = async (width,height) => {
            await send('Emulation.setDeviceMetricsOverride', { width,height,deviceScaleFactor:1,mobile:true });
            await delay(100);
        };
        const screenshot = async name => {
            if (!outputDir) return;
            // Capture the settled appearance, rather than a fade-in's first frame.
            await delay(350);
            await fsp.mkdir(outputDir, { recursive:true });
            const result = await send('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
            await fsp.writeFile(path.join(outputDir,name + '.png'), Buffer.from(result.data,'base64'));
        };
        const checkChat = async label => {
            const layout = await evaluate(`(() => {
                const rect = selector => { const r=document.querySelector(selector).getBoundingClientRect(); return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}; };
                const input=rect('#messageInput'), tools=rect('.composer-tools'), messages=rect('#messagesContainer'), area=rect('#inputArea');
                const viewport=window.StarlightUI.viewportMetrics({innerWidth,innerHeight,visualHeight:visualViewport.height,offsetTop:visualViewport.offsetTop,scale:visualViewport.scale});
                const controls=[...document.querySelectorAll('.composer-tools button')].filter(button=>!button.hidden).map(button=>{
                    const r=button.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
                    return {id:button.id,reachable:Boolean(hit&&button.contains(hit))};
                });
                return {input,tools,messages,area,viewport,controls,overflow:document.documentElement.scrollWidth>innerWidth};
            })()`);
            assert.ok(layout.tools.bottom <= layout.input.top + 1, label + ': tools overlap input');
            assert.ok(layout.messages.bottom <= layout.area.top + 1, label + ': messages overlap composer');
            assert.ok(layout.area.bottom <= layout.viewport.top + layout.viewport.height + 1, label + ': input falls below visible viewport');
            assert.ok(layout.messages.height >= 20, label + ': message viewport collapsed');
            assert.equal(layout.overflow,false,label + ': horizontal page overflow');
            for (const control of layout.controls) assert.equal(control.reachable,true,label + ': unreachable ' + control.id);
            console.log('PASS ' + label);
        };
        const checkPanel = async (label,selector,buttons) => {
            await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollTop=1e8`);
            await delay(100);
            const layout = await evaluate(`(() => {
                const panel=document.querySelector(${JSON.stringify(selector)}),r=panel.getBoundingClientRect();
                return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,overflow:panel.scrollWidth>panel.clientWidth+1,
                    buttons:${JSON.stringify(buttons)}.map(selector=>{const button=document.querySelector(selector);button.scrollIntoView({block:'center',behavior:'instant'});const b=button.getBoundingClientRect();
                        const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
                        return {selector,reachable:Boolean(hit&&button.contains(hit))};})};
            })()`);
            assert.ok(layout.top>=0 && layout.bottom<=await evaluate('innerHeight')+1,label+': panel outside screen');
            assert.equal(layout.overflow,false,label+': panel content overflows horizontally');
            for(const button of layout.buttons)assert.equal(button.reachable,true,label+': unreachable '+button.selector);
            console.log('PASS '+label);
        };
        for (const [width,height] of [[320,568],[390,844],[844,390]]) {
            await resize(width,height);
            await click('[data-home-tab="my"]');
            const scroll = await evaluate(`(() => {const main=document.querySelector('.home-main');main.scrollTop=main.scrollHeight;return {top:main.scrollTop,client:main.clientHeight,scroll:main.scrollHeight,nav:document.querySelector('.bottom-nav').getBoundingClientRect().top,mainBottom:main.getBoundingClientRect().bottom};})()`);
            assert.ok(scroll.top>0 && scroll.scroll>scroll.client, 'My settings cannot scroll');
            assert.ok(scroll.mainBottom <= scroll.nav + 1, 'Navigation covers settings');
            const bottom = await evaluate(`(() => {const r=document.querySelector('#homeMyPage > .my-version-card').getBoundingClientRect();const main=document.querySelector('.home-main').getBoundingClientRect();return r.bottom<=main.bottom&&r.top>=main.top;})()`);
            assert.equal(bottom,true,'Final settings card remains clipped');
            console.log(`PASS My scroll ${width}x${height}`);
            if (width===390) {
                await screenshot('my-settings-bottom');
                await evaluate('document.querySelector(".home-main").scrollTop=0');
                await screenshot('my-settings');
            }
            await click('[data-home-tab="story"]');
            await click('#homeStoryList .v2-work-card');
            await evaluate('document.querySelector("#messageInput").value="";document.querySelector("#messageInput").dispatchEvent(new Event("input"));');
            await checkChat(`story ${width}x${height}`);
            if (width===390) await screenshot('story-chat');
            await evaluate('document.querySelector("#messageInput").value="多行草稿\\n".repeat(12);document.querySelector("#messageInput").dispatchEvent(new Event("input"));');
            await checkChat(`multiline story ${width}x${height}`);
            await click('#btnLastInput');
            const popover = await evaluate(`(() => {const r=document.querySelector('#lastInputPopover').getBoundingClientRect();return {top:r.top,bottom:r.bottom,visible:!document.querySelector('#lastInputPopover').hidden};})()`);
            assert.ok(popover.visible && popover.top >= 0 && popover.bottom <= height,'Previous input popup out of bounds');
            await evaluate('window.StarlightBack();window.StarlightMotion.whenIdle()');
            await click('#btnLocate');
            await evaluate('document.querySelector("#navigatorNumberInput").value="1"');
            await click('#btnNavigatorJump');
            await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            await evaluate('document.querySelector("#messagesContainer").scrollTop=1e8;document.querySelector("#messagesContainer").dispatchEvent(new Event("scroll"));');
            assert.equal(await evaluate('document.querySelector("#btnJumpLatest").hidden'),false,'Historical window lost shortcut to latest');
            await evaluate('document.querySelector("#messagesContainer").scrollTop=0;document.querySelector("#messagesContainer").dispatchEvent(new Event("scroll"));');
            assert.equal(await evaluate('document.querySelector("#btnJumpLatest").hidden'), false,'Jump to latest unavailable');
            await click('#btnJumpLatest');
            await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            assert.equal(await evaluate('document.querySelector("#btnJumpLatest").hidden'),true,'Jump to latest did not reach bottom');
            assert.equal(await evaluate('Number(document.querySelector("#messagesContainer [data-message-index]:last-child").dataset.messageIndex)'),conversations.length-1,'Jump shortcut kept historical window');
            await evaluate('document.querySelector("#messagesContainer [data-message-index]:last-child").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));');
            await settle();
            const menu = await evaluate(`(() => {const r=document.querySelector('#messageActionSheet').getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,visible:!document.querySelector('#messageActionOverlay').hidden};})()`);
            assert.ok(menu.visible && menu.top>=0 && menu.bottom<=height && menu.left>=0 && menu.right<=width,'Message menu out of bounds');
            if(width===390) await screenshot('message-menu');
            await evaluate('window.StarlightBack();window.StarlightMotion.whenIdle()');
            assert.equal(await evaluate('document.querySelector("#messageActionOverlay").hidden'),true,'Back did not close menu');
            await click('#btnChatSettings');
            if(width===390)await screenshot('story-settings');
            await checkPanel(`story editor ${width}x${height}`,'#storyEditor',['#btnStoryEditorClose','#btnConfirmCreate']);
            await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');
            await settle();
            assert.equal(await evaluate('getComputedStyle(document.querySelector("#modalOverlay")).display'),'none','Escape did not close editor');
            assert.equal(await evaluate('document.querySelector("#chatShell").classList.contains("is-hidden")'),false,'Escape closed more than one level');
            await click('#btnMemoryManager');
            await checkPanel(`memory editor ${width}x${height}`,'#memoryEditor',['#btnMemoryEditorClose','#btnResetStoryMemory','#btnCancelMemoryEdit','#btnSaveMemoryEdit']);
            await evaluate('window.StarlightBack();window.StarlightMotion.whenIdle()');
            await click('#btnInspiration');
            await checkPanel(`inspiration panel ${width}x${height}`,'#inspirationOverlay .tool-panel',['#btnCloseInspiration','#btnGenerateInspiration']);
            await evaluate('window.StarlightBack();window.StarlightMotion.whenIdle()');
            await click('#btnHamburger');
        }
        await resize(390,844);
        await click('[data-home-tab="story"]');
        await click('#homeStoryList .v2-work-card');
        await evaluate(`(() => {
            document.querySelector('#messageInput').focus();
            window.__qaViewportDescriptor=Object.getOwnPropertyDescriptor(window,'visualViewport');
            Object.defineProperty(window,'visualViewport',{configurable:true,value:{height:360,offsetTop:24,scale:1}});
            window.dispatchEvent(new Event('resize'));
        })()`);
        await delay(100);
        await checkChat('visual viewport only keyboard');
        assert.equal(await evaluate('document.activeElement.id'),'messageInput','Viewport update cleared input focus');
        await screenshot('keyboard-layout');
        await evaluate(`Object.defineProperty(window,'visualViewport',window.__qaViewportDescriptor);document.querySelector('#messageInput').blur();window.dispatchEvent(new Event('resize'));`);
        await delay(100);
        await click('#btnChatSettings');
        assert.equal(await evaluate('getComputedStyle(document.querySelector("#modalOverlay")).display'), 'flex','Story settings did not open');
        await evaluate('window.StarlightBack();window.StarlightMotion.whenIdle()');
        assert.equal(await evaluate('getComputedStyle(document.querySelector("#modalOverlay")).display'),'none','Back did not close settings');
        await click('#btnHamburger');
        await click('[data-home-tab="room"]');
        await screenshot('room-library');
        for(const [width,height] of [[390,844],[320,568],[844,390]]) {
            await resize(width,height);
            await click('#homeRoomList .v2-work-card');
            await checkChat(`room ${width}x${height}`);
            assert.equal(await evaluate('document.querySelector("#roomInputTools").hidden'),false,'Room controls lost');
            assert.equal(await evaluate('document.querySelector("#btnInspiration").hidden'),true,'Story-only inspiration leaked into room');
            if(width===390)await screenshot('room-chat');
            if(width===390) {
                await evaluate(`(() => {
                    const input=document.querySelector('#messageInput');input.value='房间多行草稿\\n'.repeat(12);input.dispatchEvent(new Event('input'));input.focus();
                    window.__qaViewportDescriptor=Object.getOwnPropertyDescriptor(window,'visualViewport');
                    Object.defineProperty(window,'visualViewport',{configurable:true,value:{height:360,offsetTop:24,scale:1}});
                    window.dispatchEvent(new Event('resize'));
                })()`);
                await delay(100);
                await checkChat('multiline room with keyboard');
                await screenshot('room-keyboard-layout');
                await evaluate(`Object.defineProperty(window,'visualViewport',window.__qaViewportDescriptor);document.querySelector('#messageInput').blur();window.dispatchEvent(new Event('resize'));`);
                await delay(100);
            }
            await click('#btnLocate');
            await evaluate('document.querySelector("#navigatorNumberInput").value="1"');
            await click('#btnNavigatorJump');
            await click('#btnLocate');
            await click('#btnNavigatorLatest');
            assert.equal(await evaluate('Number(document.querySelector("#messagesContainer [data-message-index]:last-child").dataset.messageIndex)'),conversations.length-1,'Room locator reused story rendering state');
            await click('#btnChatSettings');
            await checkPanel(`room editor ${width}x${height}`,'#roomModal',['#btnRoomEditorClose','#btnConfirmRoom']);
            await evaluate('window.StarlightBack();window.StarlightMotion.whenIdle()');
            await click('#btnHamburger');
        }
        await resize(390,844);
        await click('[data-home-tab="my"]');
        await click('#themeToggleBtn');
        assert.equal(await evaluate('document.body.classList.contains("dark-theme")'),true,'Dark theme did not activate');
        await click('[data-home-tab="story"]');
        await click('#homeStoryList .v2-work-card');
        await evaluate('document.querySelector("#messageInput").value="";document.querySelector("#messageInput").dispatchEvent(new Event("input"));');
        await checkChat('dark story 390x844');
        assert.equal(await evaluate('(() => {const event=new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true});document.querySelector("#messageInput").dispatchEvent(event);return event.defaultPrevented;})()'),false,'Phone Enter was intercepted as send');
        await screenshot('story-chat-dark');
        await click('#btnStyleLab');
        await click('#btnAddStyleProfile');
        await checkPanel('style workshop 390x844','.style-workspace',[]);
        await evaluate('document.querySelector("#btnGenerateStylePreview").scrollIntoView({block:"center",behavior:"instant"})');
        assert.equal(await evaluate('(() => {const button=document.querySelector("#btnGenerateStylePreview"),r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()'),true,'Style preview cannot be reached by scrolling');
        await screenshot('style-workshop');
        await evaluate('window.StarlightBack();window.StarlightMotion.whenIdle()');

        // Navigation is interruptible. State changes happen immediately; only visuals may linger.
        await evaluate('window.StarlightBack();window.StarlightMotion.whenIdle()');
        await send('Emulation.setCPUThrottlingRate', { rate:4 });
        await evaluate(`(async () => {
            for(let i=0;i<5;i++) {
                document.querySelector('#homeStoryList .v2-work-card').click();
                await new Promise(resolve=>setTimeout(resolve,25));window.StarlightBack();
                await new Promise(resolve=>setTimeout(resolve,25));
            }
        })()`);
        await settle();
        assert.equal(await evaluate('document.querySelector("#homeShell").classList.contains("is-hidden")'),false,'Rapid navigation left home hidden');
        assert.equal(await evaluate('document.querySelectorAll(".motion-route-out,.motion-route-in,.motion-exiting").length'),0,'Rapid navigation left stale layers');
        assert.equal(await evaluate('document.querySelector("#homeShell").inert'),false,'Rapid navigation left home inert');
        await send('Emulation.setCPUThrottlingRate', { rate:1 });
        await click('#homeStoryList .v2-work-card');
        await evaluate(`(async () => {
            document.querySelector('#btnChatSettings').click();await new Promise(resolve=>setTimeout(resolve,45));
            window.StarlightBack();await new Promise(resolve=>setTimeout(resolve,30));document.querySelector('#btnChatSettings').click();
        })()`);
        await settle();
        assert.equal(await evaluate('window.StarlightMotion.isOpen(document.querySelector("#modalOverlay"))'),true,'Old close animation hid reopened editor');
        await evaluate('window.StarlightBack();window.StarlightMotion.whenIdle()');
        console.log('PASS interruptible navigation / reopen under 4x CPU test');

        // Real app bookmark action must reuse the unchanged rows and their text DOM.
        await evaluate(`window.__qaRows=[...document.querySelectorAll('#messagesContainer [data-message-index]')].map(node=>({node,bubble:node.querySelector('.message-bubble')}));
            window.__qaRows.at(-1).node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));`);
        await settle();
        await click('[data-message-action="bookmark"]');
        const reused=await evaluate(`({rows:window.__qaRows.filter(row=>row.node.isConnected).length,
            text:window.__qaRows.slice(0,-1).filter(row=>row.bubble===row.node.querySelector('.message-bubble')).length,total:window.__qaRows.length})`);
        assert.equal(reused.rows,reused.total,'Bookmark recreated historical rows');
        assert.equal(reused.text,reused.total-1,'Bookmark redrew unrelated message text');
        console.log(`PASS bookmark reuses ${reused.rows} rows / ${reused.text} unchanged bubbles`);

        await send('Emulation.setEmulatedMedia', { features:[{ name:'prefers-reduced-motion',value:'reduce' }] });
        await click('#btnInspiration');
        assert.equal(await evaluate('document.querySelector("#inspirationOverlay").getAnimations({subtree:true}).length'),0,'Reduced-motion preference ignored');
        await evaluate('window.StarlightBack();window.StarlightMotion.whenIdle()');
        await send('Emulation.setEmulatedMedia', { features:[] });
        console.log('PASS reduced motion');

        // Exercise actual story and room streaming with fabricated, in-memory SSE, never paid APIs.
        const mockText='窗边的同学合上书，笑着说：“那就明天再来吧。”';
        await evaluate(`(() => {
            window.__qaCalls=0;window.__qaHold=false;const realFetch=window.fetch.bind(window);
            window.fetch=async (url,options) => {
                if(new URL(url,location.href).hostname!=='api.deepseek.com')return realFetch(url,options);
                window.__qaCalls++;
                const body=JSON.parse(options.body);if(!body.stream)throw new Error('Unexpected non-stream request in offline fixture');
                const text=${JSON.stringify(mockText)};const encoder=new TextEncoder();
                return new Response(new ReadableStream({start(controller){
                    for(const character of text)controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:character}}]})+'\\n\\n'));
                    if(window.__qaHold)options.signal.addEventListener('abort',()=>controller.error(new DOMException('Cancelled','AbortError')),{once:true});
                    else {
                        if(!window.__qaTruncate){
                            controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1000,completion_tokens:30,prompt_cache_hit_tokens:800}})+'\\n\\n'));
                            controller.enqueue(encoder.encode('data: [DONE]\\n\\n'));
                        }
                        controller.close();
                    }
                }}),{status:200,headers:{'Content-Type':'text/event-stream'}});
            };
            window.__qaStable=document.querySelector('#messagesContainer [data-message-index="234"] .message-bubble');
            window.__qaStreamNode=null;
            new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.id==='streamingMessage')window.__qaStreamNode=node;})
                .observe(document.querySelector('#messagesContainer'),{childList:true});
            const input=document.querySelector('#messageInput');input.value='继续本地测试故事。';input.dispatchEvent(new Event('input'));
            document.querySelector('#btnSend').click();
        })()`);
        for(let i=0;i<80;i++) {
            if(await evaluate('Boolean(document.querySelector("#message-237") && !document.querySelector("#btnSend").classList.contains("stop-mode"))'))break;
            await delay(50);if(i===79)throw new Error('Offline story stream did not finish');
        }
        await settle();
        assert.equal(await evaluate('document.querySelector("#message-237 .message-bubble").textContent.trim().startsWith('+JSON.stringify(mockText)+')'),true,'Stream batching lost final story text');
        assert.equal(await evaluate('window.__qaStable===document.querySelector("#message-234 .message-bubble")'),true,'New reply recreated prior text');
        assert.equal(await evaluate('window.__qaStreamNode===document.querySelector("#message-237")'),true,'Finalization recreated streaming row');
        await evaluate(`window.__qaHold=true;document.querySelector('#messageInput').value='测试停止。';document.querySelector('#btnSend').click();`);
        for(let i=0;i<50;i++) {
            if(await evaluate('Boolean(document.querySelector("#streamingMessage"))'))break;
            await delay(30);if(i===49)throw new Error('Offline cancel fixture did not start');
        }
        await click('#btnSend');
        for(let i=0;i<50;i++) {
            if(await evaluate('!document.querySelector("#btnSend").classList.contains("stop-mode")'))break;
            await delay(30);
        }
        assert.equal(await evaluate('Boolean(document.querySelector("#streamingMessage"))'),false,'Stop left streaming bubble or pending writes');
        await evaluate('window.__qaHold=false');
        await click('#btnHamburger');await click('[data-home-tab="room"]');await click('#homeRoomList .v2-work-card');
        await evaluate(`document.querySelector('#messageInput').value='@小夏 继续本地测试。';document.querySelector('#btnSend').click();`);
        for(let i=0;i<80;i++) {
            if(await evaluate('Boolean(document.querySelector("#message-237") && !document.querySelector("#btnSend").classList.contains("stop-mode"))'))break;
            await delay(50);if(i===79)throw new Error('Offline room stream did not finish');
        }
        assert.equal(await evaluate('document.querySelector("#message-237 .message-bubble").textContent.trim().startsWith('+JSON.stringify(mockText)+')'),true,'Stream batching lost room text');
        assert.equal(await evaluate('window.__qaCalls'),3,'Offline generation made unexpected requests');
        console.log('PASS mocked story / room streaming and cancellation; zero external API calls');
        assert.match(await evaluate('document.querySelector("#apiUsageStatus").textContent'), /2 次已统计请求/,'Cancelled response must not invent usage');
        assert.match(await evaluate('document.querySelector("#apiUsageStatus").textContent'), /80\.0%/,'Cache usage must reflect reported input');

        // A clean TCP EOF without SSE completion must never become a canonical
        // assistant message, and the user must be able to send again afterwards.
        await click('#btnHamburger');await click('[data-home-tab="story"]');await click('#homeStoryList .v2-work-card');
        await evaluate(`window.__qaTruncate=true;document.querySelector('#messageInput').value='模拟网络提前结束。';document.querySelector('#btnSend').click();`);
        for(let i=0;i<80;i++) {
            if(await evaluate('window.__qaCalls===4 && !document.querySelector("#btnSend").classList.contains("stop-mode")'))break;
            await delay(50);if(i===79)throw new Error('Interrupted response left send locked');
        }
        assert.equal(await evaluate('document.querySelector("#messagesContainer [data-message-index]:last-child").dataset.messageIndex'),'239','Truncated response was saved as completed');
        assert.equal(await evaluate('Boolean(document.querySelector("#streamingMessage"))'),false,'Truncated response left unfinished streaming state');
        await evaluate(`window.__qaTruncate=false;document.querySelector('#messageInput').value='网络恢复后的下一次输入。';document.querySelector('#btnSend').click();`);
        for(let i=0;i<80;i++) {
            if(await evaluate('window.__qaCalls===5 && !document.querySelector("#btnSend").classList.contains("stop-mode")'))break;
            await delay(50);if(i===79)throw new Error('Sending after interrupted response did not recover');
        }
        assert.equal(await evaluate('document.querySelector("#messagesContainer [data-message-index]:last-child").dataset.messageIndex'),'241');
        assert.match(await evaluate('document.querySelector("#apiUsageStatus").textContent'), /3 次已统计请求/);
        console.log('PASS interrupted EOF rejected / next send recovers / actual token usage');

        // Test the real IndexedDB path, not just an in-memory queue fixture.
        await evaluate(`window.__qaReadState=async()=>{
            const db=await StarlightPersistence.openDatabase({name:'starlight_chat_database'});
            try{return await StarlightPersistence.readState(db);}finally{db.close();}
        };
        const input=document.querySelector('#messageInput');
        for(let i=0;i<20;i++){input.value='快速编辑草稿 '+i;input.dispatchEvent(new Event('input'));}
        document.querySelector('#btnHamburger').click();`);
        await settle();
        for(let i=0;i<60;i++) {
            if(await evaluate(`window.__qaReadState().then(state=>state?.agents.find(item=>item.id==='ui-story')?.draft==='快速编辑草稿 19')`))break;
            await delay(50);if(i===59)throw new Error('Latest draft not committed to IndexedDB');
        }
        const persistedCounts = await evaluate(`window.__qaReadState().then(state=>({story:state.agents[0].conversations.filter(m=>m.role==='assistant').length,room:state.rooms[0].messages.filter(m=>m.role==='assistant').length}))`);
        assert.deepEqual(persistedCounts,{story:120,room:119},'Incomplete response polluted persisted conversation');
        await click('[data-home-tab="room"]');await click('#homeRoomList .v2-work-card');
        assert.notEqual(await evaluate('document.querySelector("#messageInput").value'),'快速编辑草稿 19','Story draft leaked into room');
        await click('#btnHamburger');await click('[data-home-tab="story"]');await click('#homeStoryList .v2-work-card');
        assert.equal(await evaluate('document.querySelector("#messageInput").value'),'快速编辑草稿 19');
        await click('#btnLocate');
        await evaluate(`const search=document.querySelector('#navigatorSearchInput');search.value='网络恢复后的下一次输入。';search.dispatchEvent(new Event('input'));`);
        await delay(200);
        assert.equal(await evaluate('document.querySelectorAll("#navigatorResults .navigator-result").length'),1,'Debounced history search did not update');
        await click('#btnNavigatorClose');
        console.log('PASS actual IndexedDB latest-draft save / mode isolation / debounced search');
        const persistenceChecks=await evaluate(`(${require('../tests/persistence-browser.js').toString()})()`);
        assert.ok(persistenceChecks.checks>=10);
        console.log('PASS IndexedDB migration / atomic abort / changed-record writes / cross-window conflict: '+persistenceChecks.checks+' checks');
        const workspaceChecks=await evaluate(`(${require('../tests/workspace-browser.js').toString()})()`);
        console.log('PASS workspace / timeline / style A-B / refinement / backup: '+workspaceChecks.checks+' checks');
        const inspirationChecks=await evaluate(`(${require('../tests/inspiration-browser.js').toString()})()`);
        console.log('PASS on-demand inspiration / full drafts / no extra learning calls / isolation: '+inspirationChecks.checks+' checks');
        const motionChecks=await evaluate(`(${require('../tests/motion-browser.js').toString()})()`);
        console.log('PASS press / drag-dismiss / cancellation / keyboard-motion coexistence: '+motionChecks.checks+' checks');
        await click('#btnInspiration');
        await screenshot('inspiration-full-v230');
        await click('#btnInspirationBack');
        await screenshot('inspiration-directions-v230');
        await click('#btnCloseInspiration');
        await click('#btnWorkspaceTools');
        await screenshot('workspace-directory-v220');
        await click('[data-work-tab="timeline"]');
        await screenshot('workspace-timeline-v220');
        await click('[data-work-tab="backup"]');
        await screenshot('workspace-backup-v220');
        await click('[data-work-action="close"]');
        await click('#btnStyleLab');
        await evaluate('document.querySelector("#styleAnalysisCard").scrollIntoView({block:"start"})');
        await screenshot('style-strategy-v220');
        await click('#btnStyleLabClose');
        assert.equal(exceptions.length,0,'Runtime errors: ' + JSON.stringify(exceptions));
        console.log('All real-browser layout and motion checks passed; no external API calls were made.');
    } finally {
        socket?.close();
        browser.kill();
        await new Promise(resolve => { if(browser.exitCode!==null)resolve();else { browser.once('exit',resolve);setTimeout(resolve,3000); } });
        await new Promise(resolve => server.close(resolve));
        const resolved = path.resolve(profile);
        if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('starlight-ui-')) {
            await fsp.rm(resolved, { recursive:true, force:true, maxRetries:5, retryDelay:200 });
        }
    }
}
main().catch(error => { console.error(error); process.exitCode=1; });
