// Isolated real-browser integration checks, with deterministic fabricated API responses.
module.exports = async function checkWorkspaceInBrowser() {
    const checks=[];
    const assert=(value,label)=>{if(!value)throw new Error(label);checks.push(label);};
    const wait=async condition=>{for(let i=0;i<100;i++){if(await condition())return;await new Promise(r=>setTimeout(r,30));}throw new Error('Workspace check timed out');};
    const settle=async()=>{await StarlightMotion.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));};
    const click=async selector=>{const node=document.querySelector(selector);if(!node)throw new Error('Missing '+selector);if(node.disabled)throw new Error('Unexpected disabled control: '+selector);node.click();await settle();};
    const input=(selector,value)=>{const node=document.querySelector(selector);node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));};
    const read=()=>window.__qaReadState();
    const story=state=>state.agents.find(item=>item.id==='ui-story');
    const savedFetch=window.fetch,savedPrompt=window.prompt,savedConfirm=window.confirm,savedCapacitor=window.Capacitor;
    const requests=[];
    let promptAnswers=[];
    window.prompt=()=>promptAnswers.shift()??null;window.confirm=()=>true;
    const initial=await read();
    const originalCount=story(initial).conversations.length;
    try {
        await click('#btnWorkspaceTools');
        assert(document.querySelectorAll('[data-work-action="jump"]').length>50,'自动章节目录从既有用户章节识别');
        const width=document.querySelector('.workspace-page').getBoundingClientRect().width;
        assert(width<=innerWidth+1,'作品工具页没有横向溢出');
        promptAnswers=['3','测试手工章节'];
        await click('[data-work-action="add-chapter"]');
        await wait(async()=>story(await read()).chapters.some(c=>c.title==='测试手工章节'));
        await click('[data-work-tab="timeline"]');
        await click('[data-work-action="add-event"]');
        input('#timelineForm [name="subject"]','小夏');input('#timelineForm [name="attribute"]','装备');
        input('#timelineForm [name="before"]','空手');input('#timelineForm [name="after"]','得到钥匙');
        input('#timelineForm [name="start"]','1');input('#timelineForm [name="end"]','2');
        document.querySelector('#timelineForm').requestSubmit();
        await wait(async()=>story(await read()).memory.timeline.some(e=>e.after==='得到钥匙'));
        assert(story(await read()).memory.timeline[0].userEdited,'手工时间线记录编辑来源');
        await click('[data-work-tab="revisions"]');
        assert(document.querySelectorAll('[data-work-action="restore-revision"]').length>0,'时间线编辑前保留设定快照');
        await click('[data-work-action="close"]');
        assert(!StarlightMotion.isOpen(document.querySelector('#workspaceOverlay')),'保存时间线后关闭按钮重新可用');

        // Both history paging directions keep the DOM bounded.
        const earlier=document.querySelector('[data-action="load-earlier"]');if(earlier){earlier.click();await settle();}
        assert(document.querySelectorAll('#messagesContainer [data-message-index]').length<=200,'连续加载历史保持至多 200 个消息节点');
        await click('#btnWorkspaceTools');await click('[data-work-tab="chapters"]');
        await click('[data-work-action="jump"][data-index="2"]');await settle();
        await click('#btnHamburger');
        await wait(async()=>story(await read()).readingPosition?.atLatest===false);
        const reading=story(await read()).readingPosition;
        await click('#homeStoryList [data-work-id="ui-story"]');
        assert(!!document.querySelector(`[data-message-index="${reading.index}"]`),'重进作品恢复原阅读窗口');

        window.fetch=async(url,options)=>{
            if(new URL(url,location.href).hostname!=='api.deepseek.com')return savedFetch(url,options);
            const request=JSON.parse(options.body);requests.push(request);
            if(!request.stream)return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({summary:'松弛对白',factors:[{name:'接话',description:'先回应对方',instruction:'按当前交流目的接话',principle:'对白有来有往',scenes:['日常']}],examples:[{scene:'日常',context:'虚构的独立练习',text:'“吃什么？”“楼下那家？我还想点昨天的面。”',approved:true}],avoidances:['无依据的意象'],naturalnessChecks:['有实际回应']} )},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:30}}),{headers:{'Content-Type':'application/json'}});
            const text='本地测试候选：她把书合上。“今天先到这里，走吧。”';
            return new Response('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:30}})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
        };
        await click('#btnStyleLab');
        input('#styleSourceTextInput','参考小说中的测试对白与叙述。'.repeat(80));
        await click('#btnAnalyzeStyle');
        await wait(()=>!document.querySelector('#btnAnalyzeStyle').disabled);
        assert(document.querySelector('#styleFactorList').textContent.includes('对白有来有往'),'展示分析原则而非只有抽象标签');
        assert(!document.querySelector('[data-style-example]').checked,'模型不能自行批准写法示例');
        await click('[data-style-example]');
        input('#styleProfileStrengthRange','100');await click('#btnApplyStyle');
        input('#styleProfileStrengthRange','50');
        assert(document.querySelector('#styleAppliedStatus').textContent.includes('实际强度 100%')&&document.querySelector('#styleAppliedStatus').textContent.includes('尚未应用'),'库中强度与实际快照强度明确分开');
        document.querySelector('#stylePreviewModeSelect').value='practice';
        const beforePreview=await read();
        await click('#btnCompareStyle');
        await wait(()=>!document.querySelector('#btnCompareStyle').disabled);
        assert(requests.filter(r=>r.stream).length===2,'A/B 仅手动产生两次试写请求');
        assert(requests.filter(r=>r.stream).every(r=>r.messages.some(m=>m.content.includes('只读快照'))),'实战预览添加只读沙盒边界');
        const afterPreview=await read();
        assert(story(afterPreview).conversations.length===originalCount&&JSON.stringify(story(beforePreview).memory)===JSON.stringify(story(afterPreview).memory),'A/B 预览不污染正式消息和记忆');
        promptAnswers=['更喜欢 B 的自然接话'];await click('[data-style-vote="b"]');
        await wait(async()=>(await read()).styleProfiles.some(p=>p.feedback.length));
        await click('#btnStyleLabClose');

        // Manual refinement is preview-only until explicit adoption; prior text is recoverable.
        await click('#btnJumpLatest');
        document.querySelector('#messagesContainer [data-message-index]:last-of-type')?.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
        await settle();await click('[data-message-action="refine"]');
        await click('#refineGenerate');await wait(()=>!document.querySelector('#refineAccept').disabled);
        assert(story(await read()).conversations.at(-1).content===story(afterPreview).conversations.at(-1).content,'精修候选不自动替换正文');
        await click('#refineAccept');
        await wait(async()=>story(await read()).conversations.at(-1).previousVersions.length===1);
        assert(story(await read()).conversations.at(-1).previousVersions[0].content===story(afterPreview).conversations.at(-1).content,'采纳精修保留原始正文');

        await click('#btnWorkspaceTools');await click('[data-work-tab="backup"]');
        let exported=null;
        window.Capacitor={isNativePlatform:()=>true,Plugins:{StarlightArchive:{saveBackup:async value=>{exported=value;}}}};
        await click('[data-work-action="export-work"]');
        await wait(()=>!!exported);
        assert(exported.name.endsWith('.json')&&!exported.text.includes('sk-local-test-only'),'无JS打包器时使用原生插件导出且不包含密钥');
        window.Capacitor=savedCapacitor;
        const archive=StarlightArchive.createBackup(await read(),{mode:'story',id:'ui-story'});
        assert(!JSON.stringify(archive).includes('sk-local-test-only'),'备份移除接口密钥');
        const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(archive)],'fixture.json',{type:'application/json'}));
        const file=document.querySelector('#workspaceImportFile');file.files=transfer.files;file.dispatchEvent(new Event('change'));
        await wait(()=>!!document.querySelector('[data-work-action="import"]'));
        await click('[data-work-action="import"]');
        await wait(async()=>(await read()).agents.length===initial.agents.length+1);
        const imported=await read();
        assert(imported.apiKey===initial.apiKey,'导入保留本机密钥');
        assert(imported.agents.at(-1).conversations.length===originalCount,'单作品导入保留全部消息');
        assert(imported.rooms.length===initial.rooms.length,'剧情备份导入不改变房间');
        await click('[data-work-action="close"]');
        assert(!StarlightMotion.isOpen(document.querySelector('#workspaceOverlay')),'导出及导入后关闭按钮重新可用');
        return {checks:checks.length,messages:checks};
    } finally {window.fetch=savedFetch;window.prompt=savedPrompt;window.confirm=savedConfirm;window.Capacitor=savedCapacitor;}
};
