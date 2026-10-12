const test = require('node:test');
const assert = require('node:assert/strict');
const Motion = require('../www/motion.js');

function harness(reduce = false) {
    const animations = [];
    const frames = new Map();
    let sequence = 0;
    const win = {
        matchMedia:() => ({ matches:reduce }),
        getComputedStyle:node => ({ display:node.hidden ? 'none' : node.style.display || 'block', transform:'matrix(1, 0, 0, 1, 0, 0)', opacity:'1' }),
        requestAnimationFrame:callback => { frames.set(++sequence,callback); return sequence; },
        cancelAnimationFrame:id => frames.delete(id),
    };
    const element = () => {
        const classes = new Set();
        return {
            ownerDocument:{ defaultView:win }, style:{ display:'none' }, dataset:{}, hidden:false, inert:false, isConnected:true,
            classList:{ add:value=>classes.add(value), remove:value=>classes.delete(value), toggle:(value,on)=>on?classes.add(value):classes.delete(value), contains:value=>classes.has(value) },
            setAttribute() {}, removeAttribute() {},
            animate(keyframes,options) { const animation={ keyframes,options,cancel(){ this.oncancel?.(); } }; animations.push(animation); return animation; },
        };
    };
    return { element,animations,frames, tick(){ for(const [id,callback] of [...frames]) { frames.delete(id);callback(); } } };
}

test('连续开关弹窗只保留最后的可见状态，过期完成回调不会再次隐藏窗口', async () => {
    const h=harness(), panel=h.element();
    Motion.setVisible(panel,true,{ surface:panel });
    const oldFinish=h.animations[0].onfinish;
    Motion.setVisible(panel,false);
    assert.equal(Motion.isOpen(panel),false);
    assert.equal(panel.inert,true);
    Motion.setVisible(panel,true);
    oldFinish();
    Motion.finishAll();
    await Motion.whenIdle();
    assert.equal(Motion.isOpen(panel),true);
    assert.equal(panel.inert,false);
    assert.equal(panel.dataset.motionState,'open');
    assert.equal(panel.classList.contains('motion-exiting'),false);
});

test('退出动画期间逻辑上已关闭，结束后才隐藏可见元素', async () => {
    const h=harness(), panel=h.element();
    panel.style.display='block';
    panel.hidden=true;
    Motion.setVisible(panel,true,{ hidden:true,surface:panel });
    Motion.finishAll(); await Motion.whenIdle();
    Motion.setVisible(panel,false);
    assert.equal(panel.hidden,false);
    assert.equal(Motion.isOpen(panel),false);
    Motion.finishAll(); await Motion.whenIdle();
    assert.equal(panel.hidden,true);
    assert.equal(panel.inert,false);
});

test('减少动态效果或旧WebView没有动画接口时立即完成显隐', async () => {
    const h=harness(true), panel=h.element();
    Motion.setVisible(panel,true,{ surface:panel });
    assert.equal(panel.style.display,'flex');
    Motion.setVisible(panel,false);
    assert.equal(panel.style.display,'none');
    assert.equal(h.animations.length,0);
    const old=harness().element();delete old.animate;
    Motion.setVisible(old,true);Motion.setVisible(old,false);
    assert.equal(old.style.display,'none');
});

test('同一帧的流式更新只绘制最后内容，结束时可同步刷新且移除后不再写入', () => {
    const h=harness(), bubble=h.element(), output=[];
    Motion.writeFrame(bubble,()=>output.push('first'));
    Motion.writeFrame(bubble,()=>output.push('latest'));
    assert.equal(h.frames.size,1);
    h.tick();assert.deepEqual(output,['latest']);
    Motion.writeFrame(bubble,()=>output.push('final'));
    Motion.flushWrite(bubble);assert.deepEqual(output,['latest','final']);
    Motion.writeFrame(bubble,()=>output.push('discarded'));
    Motion.flushWrite(bubble,true);h.tick();assert.deepEqual(output,['latest','final']);
    Motion.writeFrame(bubble,()=>output.push('detached'));
    bubble.isConnected=false;h.tick();assert.deepEqual(output,['latest','final']);
});

test('动效只使用位移与透明度，关闭的页面动画不会留下活动任务', async () => {
    const h=harness(), panel=h.element();
    Motion.setVisible(panel,true,{kind:'page'});
    for(const animation of h.animations)for(const frame of animation.keyframes)assert.ok(Object.keys(frame).every(key=>key==='opacity'||key==='transform'));
    Motion.setVisible(panel,false);
    Motion.finishAll();await Motion.whenIdle();
    assert.equal(panel.style.display,'none');
    assert.equal(panel.classList.contains('motion-running'),false);
});
