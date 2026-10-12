const test = require('node:test');
const assert = require('node:assert/strict');
const View = require('../www/message-view.js');

function container() {
    const doc={createElement:() => node()};
    function node() {
        return { ownerDocument:doc, children:[], dataset:{},
            get firstElementChild(){return this.children[0]||null;},
            get nextElementSibling(){return this.parent?.children[this.parent.children.indexOf(this)+1]||null;},
            insertBefore(child,before){child.remove();const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,child);child.parent=this;},
            remove(){if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}},
        };
    }
    return node();
}
const item=(index,text,build=()=>text) => ({ key:`message:${index}`,index,className:'message-wrapper',signature:[text],html:build });

test('未改变的消息保留气泡DOM，修改收藏仅更新目标行且不重播入场动画', () => {
    const parent=container();let builds=0, entrances=0;
    const rows=[item(0,'first',()=>{builds++;return 'first';}),item(1,'second',()=>{builds++;return 'second';})];
    View.reconcile(parent,'story:a',rows,2,()=>entrances++);
    const nodes=[...parent.children];
    View.reconcile(parent,'story:a',rows,2,()=>entrances++);
    assert.equal(builds,2);assert.equal(entrances,0);assert.deepEqual(parent.children,nodes);
    View.reconcile(parent,'story:a',[rows[0],item(1,'changed')],2,()=>entrances++);
    assert.deepEqual(parent.children,nodes);assert.equal(nodes[1].innerHTML,'changed');assert.equal(entrances,0);
});

test('只有真正追加的消息有入场动画，加载历史不重播且切换作品不复用另一作品行', () => {
    const parent=container();let entrances=0;
    View.reconcile(parent,'story:a',[item(8,'eight'),item(9,'nine')],10,()=>entrances++);
    const last=parent.children[1];
    View.reconcile(parent,'story:a',[item(7,'seven'),item(8,'eight'),item(9,'nine'),item(10,'ten')],11,()=>entrances++);
    assert.equal(entrances,1);assert.equal(parent.children[2],last);
    View.reconcile(parent,'room:a',[item(9,'room nine')],10,()=>entrances++);
    assert.notEqual(parent.children[0],last);assert.equal(entrances,1);
});

test('流式气泡在完成后直接接管，不重复创建或播放第二次入场', () => {
    const parent=container();let entrances=0;
    View.reconcile(parent,'story:a',[item(0,'user')],1,()=>entrances++);
    const streaming=parent.ownerDocument.createElement('div');streaming.dataset.viewKey='message:1';
    parent.insertBefore(streaming,null);
    View.reconcile(parent,'story:a',[item(0,'user'),item(1,'final')],2,()=>entrances++);
    assert.equal(parent.children[1],streaming);assert.equal(streaming.innerHTML,'final');assert.equal(entrances,0);
});

test('删除和撤回会清理不再需要的行，不留下错误顺序或窗口控件', () => {
    const parent=container();
    View.reconcile(parent,'a',[item(0,'zero'),item(1,'one'),item(2,'two')],3);
    const first=parent.children[0], third=parent.children[2];
    View.reconcile(parent,'a',[item(2,'two'),item(0,'zero')],3);
    assert.deepEqual(parent.children,[third,first]);
    View.reconcile(parent,'a',[],0);assert.equal(parent.children.length,0);
});
