const test = require('node:test');
const assert = require('node:assert/strict');
const UI = require('../www/ui.js');

test('旧版复制使用只读透明缓冲区，失败也移除且不会假报成功', () => {
    for (const result of [true,false,'throw']) {
        let removed=0,selected=0;
        const field={style:{},setAttribute(){},select(){selected++;assert.equal(this.readOnly,true);assert.equal(this.tabIndex,-1);},remove(){removed++;}};
        const doc={createElement:()=>field,body:{appendChild(){}},execCommand:command=>{
            assert.equal(command,'copy');
            if(result==='throw')throw new Error('clipboard disabled');
            return result;
        }};
        if(result===true)UI.copyTextFallback('待复制文本',doc);
        else assert.throws(()=>UI.copyTextFallback('待复制文本',doc));
        assert.equal(removed,1);assert.equal(selected,1);assert.equal(field.value,'待复制文本');
        assert.match(field.style.cssText,/position:fixed/);assert.match(field.style.cssText,/opacity:0/);
    }
});

test('移动端只在明确编辑时聚焦，导航与插入文本不唤起键盘', () => {
    let focused = 0;
    const win = { navigator:{ maxTouchPoints:1 } };
    const doc = { defaultView:win, activeElement:null };
    const input = { isConnected:true, ownerDocument:doc, closest:()=>null, getClientRects:()=>[{}], focus:options=>{
        assert.equal(options.preventScroll,true); focused++;
    } };
    assert.equal(UI.focusEditor(input),false);
    assert.equal(focused,0);
    assert.equal(UI.focusEditor(input,{explicit:true}),true);
    assert.equal(focused,1);
    doc.activeElement=input;
    assert.equal(UI.focusEditor(input),true);
    assert.equal(focused,1,'已经输入时不重新调用 focus');
    doc.activeElement=null;
    win.navigator.maxTouchPoints=0;
    assert.equal(UI.focusEditor(input),true);
    win.Capacitor={ getPlatform:()=> 'android' };
    assert.equal(UI.focusEditor(input),false,'Android 配对鼠标后仍不隐式弹键盘');
    delete win.Capacitor;
    win.matchMedia=()=>({matches:true});
    assert.equal(UI.focusEditor(input),false,'粗指针环境也不自动聚焦');
    input.closest=()=>({});
    assert.equal(UI.focusEditor(input,{explicit:true}),false,'显式快捷键不能聚焦隐藏页面');
    input.closest=()=>null;input.isConnected=false;
    assert.equal(UI.focusEditor(input,{explicit:true}),false);
});

test('关闭页面只释放自己的编辑焦点，不抢走无关页面或按钮焦点', () => {
    let blurred=0;
    const active={matches:()=>true,blur:()=>blurred++};
    const doc={activeElement:active};
    assert.equal(UI.dismissKeyboard(doc,{contains:()=>false}),false);
    assert.equal(blurred,0);
    assert.equal(UI.dismissKeyboard(doc,{contains:node=>node===active}),true);
    assert.equal(blurred,1);
    assert.equal(UI.dismissKeyboard(doc),true);
    active.matches=()=>false;
    assert.equal(UI.dismissKeyboard(doc),false);
    assert.equal(blurred,2);
});

test('原生键盘元数据有界，不参与第二次高度减法；网页环境无副作用', async()=>{
    assert.equal(UI.nativeMotionState(null),null);
    const state=UI.nativeMotionState({available:true,insetBottom:Infinity,progress:7,animationScale:-1,keyboardVisible:true});
    assert.equal(state.insetBottom,0);assert.equal(state.progress,1);assert.equal(state.animationScale,0);
    assert.deepEqual(UI.viewportMetrics({innerHeight:500,innerWidth:390,visualHeight:500,nativeInset:300}),{width:390,height:500,top:0});
    assert.equal(await UI.nativeFeedback('longPress',{}),false);
});

test('原生事件丢弃过期序号，移除监听器与减少动态效果状态，触觉失败可降级',async()=>{
    const classes=new Set(),styles=new Map();let receive,removed=0,updated=0;
    const events=new Map();const doc={hidden:false,body:{classList:{toggle:(key,on)=>on?classes.add(key):classes.delete(key),remove:(...keys)=>keys.forEach(key=>classes.delete(key))}},documentElement:{style:{setProperty:(k,v)=>styles.set(k,v),removeProperty:k=>styles.delete(k)}},addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k)};
    const win={setTimeout,clearTimeout,Capacitor:{getPlatform:()=> 'android',Plugins:{StarlightMotion:{addListener:async(name,fn)=>{receive=fn;return{remove:()=>{removed++;}};},getState:async()=>({available:true,sequence:2,animationScale:0,insetsKnown:true,keyboardVisible:true}),feedback:async()=>{throw new Error('disabled');}}}}};
    const dispose=UI.attachNativeMotion(win,doc,()=>updated++);await new Promise(r=>setImmediate(r));
    assert.equal(updated,1);assert.ok(classes.has('native-reduced-motion'));
    receive({available:true,sequence:1,animationScale:1});assert.equal(updated,1);
    assert.equal(await UI.nativeFeedback('longPress',win),false);
    dispose();assert.equal(removed,1);assert.equal(events.size,0);assert.equal(classes.size,0);assert.equal(styles.size,0);
    receive({available:true,sequence:3});assert.equal(updated,1);
});

test('键盘缩小可见区域时应用使用可见高度，旧WebView回退到窗口高度', () => {
    assert.deepEqual(UI.viewportMetrics({ innerWidth:390, innerHeight:844, visualHeight:390, offsetTop:20 }), { width:390, height:390, top:20 });
    assert.equal(UI.viewportMetrics({ innerWidth:390, innerHeight:620 }).height, 620);
    assert.equal(UI.viewportMetrics({ innerWidth:390, innerHeight:400, visualHeight:844 }).height, 400);
});

test('缩放阅读不误认为键盘弹出，保留页面原有布局', () => {
    assert.deepEqual(UI.viewportMetrics({ innerWidth:390, innerHeight:844, visualHeight:400, offsetTop:80, scale:2 }), { width:390, height:844, top:0 });
});

test('消息菜单在屏幕上下边缘或键盘展开时始终落在可见区域', () => {
    for (const viewport of [{ width:320, height:568, top:0 }, { width:390, height:280, top:40 }, { width:844, height:390, top:0 }]) {
        for (const anchor of [{ left:12, top:-300, bottom:30 }, { left:300, top:400, bottom:500 }, { left:40, top:100, bottom:170 }]) {
            const result = UI.floatingPosition(anchor, { width:290, height:360 }, viewport);
            assert.ok(result.left >= 12);
            assert.ok(result.left + result.width <= viewport.width - 12);
            assert.ok(result.top >= viewport.top + 12);
            assert.ok(result.top + result.height <= viewport.top + viewport.height - 12);
        }
    }
});

test('上次输入浮窗优先置于实际输入区上方，不依赖固定底部距离', () => {
    const result = UI.floatingPosition({ left:10, top:650, bottom:840 }, { width:340, height:150 }, { width:390, height:844, top:0 }, true);
    assert.equal(result.top, 492);
    const raised = UI.floatingPosition({ left:10, top:290, bottom:420 }, { width:340, height:150 }, { width:390, height:420, top:0 }, true);
    assert.equal(raised.top, 132);
});

test('浮窗避开横屏刘海与系统手势区，不只限制在窗口矩形内', () => {
    const viewport = {width:844,height:260,top:18,safeArea:{left:44,right:30,top:24,bottom:34}};
    const menu = UI.floatingPosition({left:0,top:0,bottom:0},{width:840,height:900},viewport,true);
    assert.equal(menu.left,44);
    assert.equal(menu.top,42);
    assert.equal(menu.width,770);
    assert.equal(menu.height,202);
    assert.ok(menu.left+menu.width<=viewport.width-30);
    assert.ok(menu.top+menu.height<=viewport.top+viewport.height-34);
});

test('浮窗先限制宽度再测换行高度，旋转变宽后恢复 CSS 自然宽度', () => {
    const win={innerWidth:260,innerHeight:300,getComputedStyle:()=>({getPropertyValue:key=>
        ['--ui-safe-left','--ui-safe-right'].includes(key)?'40px':'20px'})};
    const panel={style:{},ownerDocument:{defaultView:win,documentElement:{}},
        get offsetWidth(){return parseFloat(this.style.width)||290;},
        get offsetHeight(){return this.offsetWidth<200?240:100;}};
    const anchor={getBoundingClientRect:()=>({left:200,top:200,bottom:220})};
    UI.placePanel(panel,anchor);
    assert.equal(panel.style.width,'180px');
    assert.equal(panel.style.top,'30px');
    assert.ok(parseFloat(panel.style.top)+panel.offsetHeight<=280);
    win.innerWidth=844;
    UI.placePanel(panel,anchor);
    assert.equal(panel.style.width,'290px');
    UI.clearPanel(panel);
});

test('短屏多行输入为消息区保留空间，而不是只按屏幕比例挤占房间工具', () => {
    const input = {
        style: {}, scrollHeight:400,
        getBoundingClientRect: () => ({ height:44 }),
        ownerDocument: {
            defaultView: { innerWidth:390, innerHeight:844, visualViewport:{ height:360, offsetTop:0, scale:1 } },
            getElementById: () => ({ getClientRects:() => [{}], getBoundingClientRect:() => ({ height:60 }) }),
        },
    };
    UI.resizeComposer(input);
    assert.equal(input.style.height, '48px');
    assert.equal(input.style.overflowY, 'auto');
    input.ownerDocument.getElementById = () => ({ getClientRects:() => [], getBoundingClientRect:() => ({ height:0 }) });
    UI.resizeComposer(input);
    assert.equal(input.style.height, '97.2px');
});
