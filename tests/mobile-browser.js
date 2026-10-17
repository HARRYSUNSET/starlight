// Runs inside the isolated real Chrome fixture. Browser emulation can verify
// editable focus and viewport geometry, but cannot display Android's real IME.
module.exports = async function checkMobileInBrowser() {
    const checks=[];
    const assert=(value,label)=>{if(!value)throw new Error(label);checks.push(label);};
    const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const settle=async()=>{await StarlightMotion.whenIdle();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));};
    const node=selector=>{const element=document.querySelector(selector);if(!element)throw new Error('Missing '+selector);return element;};
    const click=async selector=>{const element=node(selector);if(element.disabled)throw new Error('Disabled '+selector);element.click();await settle();};
    const editable=element=>Boolean(element&&(element.matches('input,textarea,select')||element.isContentEditable));
    const noEditor=async label=>{await delay(350);assert(!editable(document.activeElement),label+'：不隐式聚焦输入框（当前 '+(document.activeElement?.id||document.activeElement?.tagName)+'）');};
    const focus=selector=>{const element=node(selector);element.focus({preventScroll:true});assert(document.activeElement===element,selector+'：用户仍可主动进入编辑');return element;};
    const checkFont=(element,label)=>assert(parseFloat(getComputedStyle(element).fontSize)>=16,label+'：触屏文字输入字号避免小字号自动放大');
    const viewportDescriptor=Object.getOwnPropertyDescriptor(window,'visualViewport');
    const savedFetch=window.fetch;
    let requests=0;
    window.fetch=async(url,options)=>{
        if(new URL(url,location.href).hostname==='api.deepseek.com'){requests++;throw new Error('Mobile navigation must not call an API');}
        return savedFetch(url,options);
    };
    const restoreViewport=async()=>{Object.defineProperty(window,'visualViewport',viewportDescriptor);window.dispatchEvent(new Event('resize'));await settle();};
    const checkKeyboardPanel=async(selector,label)=>{
        Object.defineProperty(window,'visualViewport',{configurable:true,value:{height:360,offsetTop:24,scale:1}});
        window.dispatchEvent(new Event('resize'));await settle();
        const rect=node(selector).getBoundingClientRect();
        assert(rect.top>=23&&rect.bottom<=385&&rect.left>=-1&&rect.right<=innerWidth+1,label+'：键盘视觉视口内无溢出 '+JSON.stringify({top:rect.top,bottom:rect.bottom}));
        const button=node(selector).querySelector('button');
        button?.scrollIntoView({block:'nearest',behavior:'instant'});
        if(button){const r=button.getBoundingClientRect();assert(button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),label+'：键盘弹出后仍可关闭页面');}
        await restoreViewport();
    };
    const cycle=async({label,open,overlay,close,input,prepare,keyboard})=>{
        focus('#messageInput');
        await click(open);
        assert(StarlightMotion.isOpen(node(overlay)),label+'：打开正确页面');
        await noEditor(label+'打开');
        if(prepare){await prepare();await noEditor(label+'新增编辑项');}
        if(input){const element=focus(input);checkFont(element,label);}
        if(keyboard)await checkKeyboardPanel(keyboard,label);
        await click(close);
        assert(!StarlightMotion.isOpen(node(overlay)),label+'：关闭正确页面');
        await noEditor(label+'关闭');
    };
    try {
        assert(matchMedia('(pointer:coarse)').matches,'回归运行于触屏输入环境');
        document.activeElement?.blur();
        const copyDescriptor=Object.getOwnPropertyDescriptor(document,'execCommand');
        const textareasBefore=document.querySelectorAll('textarea').length;
        try {
            for(const result of [true,false,'throw']) {
                Object.defineProperty(document,'execCommand',{configurable:true,value:command=>{
                    const buffer=document.body.lastElementChild;
                    assert(command==='copy'&&buffer.tagName==='TEXTAREA'&&buffer.readOnly&&buffer.tabIndex===-1,'旧版复制缓冲区只读且不可键盘遍历');
                    assert(getComputedStyle(buffer).opacity==='0'&&getComputedStyle(buffer).position==='fixed','复制缓冲区不闪现也不撑开页面');
                    if(result==='throw')throw new Error('Clipboard blocked');
                    return result;
                }});
                let failed=false;
                try { StarlightUI.copyTextFallback('手机复制测试',document); } catch(error) { failed=true; }
                assert(failed===(result!==true),'复制失败不会假报成功');
                assert(document.querySelectorAll('textarea').length===textareasBefore,'复制结束或失败均无临时编辑框残留');
                await noEditor('旧版复制结束');
            }
        } finally {
            if(copyDescriptor)Object.defineProperty(document,'execCommand',copyDescriptor);
            else delete document.execCommand;
        }
        await cycle({label:'剧情右上角设定',open:'#btnChatSettings',overlay:'#modalOverlay',close:'#btnStoryEditorClose',input:'#newAgentName',keyboard:'#storyEditor'});
        // Old delayed focus callbacks used to resurrect the keyboard after a
        // quick open-close. Do not wait for the entrance animation here.
        focus('#messageInput');node('#btnChatSettings').click();node('#btnStoryEditorClose').click();
        await settle();await noEditor('剧情设定快速关闭后');
        assert(!StarlightMotion.isOpen(node('#modalOverlay')),'快速关闭不留下设定层');
        await cycle({label:'长期记忆',open:'#btnMemoryManager',overlay:'#memoryEditorOverlay',close:'#btnMemoryEditorClose',input:'#memoryCoreInput',keyboard:'#memoryEditor'});
        await cycle({label:'搜索定位',open:'#btnLocate',overlay:'#navigatorOverlay',close:'#btnNavigatorClose',input:'#navigatorSearchInput',keyboard:'#navigatorOverlay .modal'});
        await cycle({label:'灵感推荐',open:'#btnInspiration',overlay:'#inspirationOverlay',close:'#btnCloseInspiration',prepare:async()=>{if(!node('#btnInspirationBack').hidden)await click('#btnInspirationBack');},input:'#inspirationRequestInput',keyboard:'#inspirationOverlay .tool-panel'});
        await cycle({label:'常用语段',open:'#btnSnippets',overlay:'#snippetsOverlay',close:'#btnCloseSnippets',prepare:()=>click('#btnAddSnippet'),input:'#snippetsList .snippet-row:last-child textarea',keyboard:'#snippetsOverlay .tool-panel'});
        const originalDraft=node('#messageInput').value,originalMessages=document.querySelectorAll('#messagesContainer [data-message-index]').length;
        await click('#btnSnippets');await click('#btnAddSnippet');
        const snippet=node('#snippetsList .snippet-row:last-child textarea');
        snippet.value='手机插入测试：仅填入，不发送。';snippet.dispatchEvent(new Event('input',{bubbles:true}));
        snippet.focus({preventScroll:true});await click('#snippetsList .snippet-row:last-child .snippet-use');await noEditor('常用语段填入后');
        assert(node('#messageInput').value.endsWith(snippet.value),'常用语段仍能完整追加到对话框');
        assert(document.querySelectorAll('#messagesContainer [data-message-index]').length===originalMessages,'插入常用语段不发送消息');
        node('#messageInput').value=originalDraft;node('#messageInput').dispatchEvent(new Event('input',{bubbles:true}));
        await cycle({label:'作品目录与状态时间线',open:'#btnWorkspaceTools',overlay:'#workspaceOverlay',close:'[data-work-action="close"]',prepare:async()=>{await click('[data-work-tab="timeline"]');await click('[data-work-action="add-event"]');},input:'#timelineForm [name="subject"]',keyboard:'#workspaceOverlay .workspace-page'});
        await cycle({label:'文风工坊新增因子',open:'#btnStyleLab',overlay:'#styleLabOverlay',close:'#btnStyleLabClose',prepare:()=>click('#btnAddStyleProfile'),input:'#styleProfileNameInput',keyboard:'#styleLabOverlay .modal'});

        // Message tools also enter a full-screen editable page, independently
        // of the main composer and without starting a generation request.
        focus('#messageInput');
        node('#messagesContainer [data-message-index]:last-of-type').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
        await settle();await noEditor('气泡菜单打开');
        await click('[data-message-action="refine"]');await noEditor('文风精修打开');
        checkFont(focus('#refineRequest'),'文风精修');
        await checkKeyboardPanel('#refinementOverlay .workspace-page','文风精修');
        await click('#refineClose');await noEditor('文风精修关闭');

        focus('#messageInput');await click('#btnHamburger');await noEditor('返回剧情库');
        await click('#homeAddStory');await noEditor('新建剧情打开');
        assert(StarlightMotion.isOpen(node('#modalOverlay')),'新建剧情打开全屏编辑页');
        await click('#btnAddStoryCharacter');await noEditor('添加角色');
        await click('#btnStoryEditorClose');await noEditor('取消新建剧情');
        await click('[data-home-tab="my"]');
        const settingsInput=node('#homeMyPage').querySelector('input[type="password"],input[type="text"],textarea');
        assert(Boolean(settingsInput),'我的页面存在可编辑设置');settingsInput.focus({preventScroll:true});
        await click('[data-home-tab="room"]');await noEditor('从我的设置切换房间库');
        await click('#homeAddRoom');await noEditor('新建房间打开');
        assert(StarlightMotion.isOpen(node('#roomModalOverlay')),'新建房间打开全屏编辑页');
        await click('#btnRoomEditorClose');await noEditor('取消新建房间');
        await click('#homeRoomList [data-work-id="ui-room"]');await noEditor('进入房间');
        await cycle({label:'房间右上角设定',open:'#btnChatSettings',overlay:'#roomModalOverlay',close:'#btnRoomEditorClose',input:'#roomNameInput',keyboard:'#roomModal'});
        await cycle({label:'房间长期记忆',open:'#btnMemoryManager',overlay:'#memoryEditorOverlay',close:'#btnMemoryEditorClose',input:'#memoryCoreInput',keyboard:'#memoryEditor'});
        focus('#messageInput');await click('#btnHamburger');await noEditor('返回房间库');
        await click('[data-home-tab="story"]');await click('#homeStoryList [data-work-id="ui-story"]');await noEditor('返回剧情不自动开始编辑');
        assert(requests===0,'手机导航、设定、记忆、文风及工具检查没有模型请求');
        return {checks:checks.length};
    } finally {window.fetch=savedFetch;await restoreViewport();document.activeElement?.blur();}
};
