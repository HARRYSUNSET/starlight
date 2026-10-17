module.exports=async function checkMotionInBrowser(){
 const checks=[],assert=(v,label)=>{if(!v)throw new Error(label);checks.push(label);};
 const frame=()=>new Promise(r=>requestAnimationFrame(r));
 const overlay=document.createElement('div');overlay.style.cssText='position:fixed;inset:0;z-index:9999;display:none;background:transparent;align-items:center;justify-content:center';
 overlay.innerHTML='<div class="action-sheet" style="height:220px;width:280px"><div class="action-sheet-title">拖动测试</div><button type="button">保留按钮点击</button></div>';
 document.body.appendChild(overlay);const surface=overlay.firstElementChild,handle=surface.firstElementChild,button=surface.querySelector('button');
 let dismissed=0;const dispose=StarlightMotion.bindDismiss(overlay,{surface,handle:'.action-sheet-title',onDismiss:()=>{dismissed++;StarlightMotion.setVisible(overlay,false,{surface});}});
 const pointer=(target,name,x,y)=>target.dispatchEvent(new PointerEvent(name,{bubbles:true,cancelable:true,pointerId:41,isPrimary:true,button:0,clientX:x,clientY:y,pointerType:'touch'}));
 try{
  await StarlightMotion.setVisible(overlay,true,{surface});
  pointer(button,'pointerdown',100,100);assert(button.classList.contains('motion-pressed'),'按下即时反馈');
  pointer(document,'pointermove',100,130);assert(!button.classList.contains('motion-pressed'),'滚动意图取消按压反馈');pointer(document,'pointerup',100,130);
  pointer(handle,'pointerdown',100,100);pointer(document,'pointermove',160,105);pointer(document,'pointerup',160,105);await StarlightMotion.whenIdle();
  assert(dismissed===0&&StarlightMotion.isOpen(overlay),'横向滑动不误关闭菜单');
  pointer(handle,'pointerdown',100,100);pointer(document,'pointermove',100,115);await frame();pointer(document,'pointerup',100,115);await StarlightMotion.whenIdle();
  assert(dismissed===0&&!surface.dataset.motionDragging,'小幅下拉回弹并清理状态');
  pointer(handle,'pointerdown',100,100);pointer(document,'pointermove',100,205);await frame();pointer(document,'pointerup',100,205);await StarlightMotion.whenIdle();
  assert(dismissed===1&&!StarlightMotion.isOpen(overlay),'明确下拉仅关闭一次且没有残留动画');
  await StarlightMotion.setVisible(overlay,true,{surface});
  const pending=StarlightMotion.animate(surface,[{opacity:.1},{opacity:1}],{duration:1000});
  visualViewport?.dispatchEvent(new Event('resize'));await frame();
  assert(surface.classList.contains('motion-running'),'键盘视口变化不强制结束正在运行的动画');
  StarlightMotion.finishAll();await pending;
  const previous=window.__starlightNativeMotion;
  window.__starlightNativeMotion={animationScale:0};
  await StarlightMotion.setVisible(overlay,false,{surface});
  assert(overlay.getAnimations({subtree:true}).length===0,'Android减少动态效果同步到网页动画');
  if(previous)window.__starlightNativeMotion=previous;else delete window.__starlightNativeMotion;
  return{checks:checks.length};
 }finally{dispose();StarlightMotion.finishAll();await StarlightMotion.whenIdle();overlay.remove();}
};
