(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.StarlightWorkspace=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
    'use strict';
    function normalizeChapters(entries, length) {
        const seen=new Set();
        return (Array.isArray(entries)?entries:[]).filter(item=>item&&Number.isInteger(item.index)&&item.index>=0&&item.index<length)
            .map(item=>({id:String(item.id||'chapter_'+item.index),index:item.index,title:String(item.title||'未命名章节').trim().slice(0,120),automatic:item.automatic===true}))
            .filter(item=>{if(seen.has(item.index))return false;seen.add(item.index);return true;}).sort((a,b)=>a.index-b.index);
    }
    function detectChapter(content) {
        const first=String(content||'').trim().split('\n')[0].replace(/^#{1,6}\s*/, '').trim();
        return /^(?:第[〇零一二三四五六七八九十百千万两\d]+[章节回幕卷]|chapter\s+\d+|序章|终章|番外)(?:[\s：:，,、.．—-]|$)/i.test(first)?first.slice(0,120):'';
    }
    function chaptersFor(work,messages) {
        const result=normalizeChapters(work?.chapters,messages.length);
        const indexes=new Set(result.map(item=>item.index));
        messages.forEach((message,index)=>{
            if(message.role!=='user'||indexes.has(index))return;
            const title=detectChapter(message.content);
            if(title)result.push({id:'auto_'+index,index,title,automatic:true});
        });
        return result.sort((a,b)=>a.index-b.index);
    }
    function pageRange(total,start,size=200) {
        const first=Math.max(0,Math.min(Math.floor(Number(start)||0),Math.max(0,total-1)));
        return {start:first,end:Math.min(total,first+Math.max(1,size))};
    }
    function normalizeReading(value,length) {
        if(!value||!Number.isInteger(value.index)||value.index<0||value.index>=length)return null;
        return {index:value.index,offset:Number.isFinite(value.offset)?value.offset:0,atLatest:value.atLatest===true};
    }
    return {normalizeChapters,detectChapter,chaptersFor,pageRange,normalizeReading};
});
