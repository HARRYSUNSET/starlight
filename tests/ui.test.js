const test = require('node:test');
const assert = require('node:assert/strict');
const UI = require('../www/ui.js');

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
