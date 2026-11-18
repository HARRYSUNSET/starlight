const test = require('node:test');
const assert = require('node:assert/strict');
const Book = require('../www/worldbook.js');
const AI = require('../www/worldbook-ai.js');
const P = require('../www/worldbook-progress.js');

function makeWork(mode, enabled = true) {
    const worldBook = Book.normalizeWorldBook({automation:{enabled}});
    return mode === 'story' ? {id:'same', worldBook, conversations:[]} :
        {id:'same', worldBook, messages:[], participants:[{id:'m1',name:'阿青'},{id:'m2',name:'悠悠'}]};
}
function reply(source, scope = 'public', ids = []) {
    return {entries:[{fields:[{label:'具体变化',value:source}],evidence:source,knowledgeScope:scope,characterIds:ids}]};
}
const changed = (work, mode, prior) => P.reconcile(AI, mode, work, P.changedKeys(mode, prior, work));
const rows = work => work.worldBook.automation.sources;
function runner(entries, request) {
    return P.create({ai:AI, works:() => entries, getWork:(mode,id) => entries.find(row => row.mode === mode && row.work.id === id)?.work,
        request, save:() => {}, ready:() => true, blocked:() => false});
}

test('world progress opt-in tracks only newly committed story text including completed automatic chapters', async () => {
    const work = makeWork('story', false);
    work.conversations.push({role:'assistant',content:'旧章节，不追溯。'});
    changed(work, 'story');
    assert.deepEqual(rows(work), []);
    const before = structuredClone(work);
    work.worldBook.automation.enabled = true;
    changed(work, 'story', before);
    assert.deepEqual(rows(work), []);
    work.conversations.push({role:'user',kind:'autoTask',content:'未来计划。'},
        {id:'chapter1',role:'assistant',source:'auto',chapterNumber:1,content:'阿青捡到了钥匙。'});
    changed(work, 'story', before);
    work.incompleteDraft = {text:'未完成候选'};
    let calls = 0;
    const service = runner([{mode:'story',work}], async messages => {
        calls++;
        assert.equal(JSON.parse(messages[1].content).source, '阿青捡到了钥匙。');
        return reply('阿青捡到了钥匙。');
    });
    await Promise.all([service.wake(),service.wake()]);
    assert.equal(calls, 1);
    assert.deepEqual(rows(work).map(r => r.status), ['done']);
    assert.equal(work.worldBook.progressEntries[0].origin.sourceLabel, '第 1 章');
    await service.wake();
    assert.equal(calls, 1);
});

test('room events group one completed turn, exclude previews and metadata, restrict extraction to observed speakers', async () => {
    const room = makeWork('room');
    room.experience = {sceneDraft:{content:'预览'}, candidates:[{raw:'候选'}]};
    room.messages = [{role:'user',turnId:'t',kind:'dialogue',content:'这是给你的。'},
        {role:'system',turnId:'t',kind:'control',content:'生成命令'},
        {role:'system',turnId:'t',kind:'intimacy-node',content:'私密节点'},
        {role:'assistant',speakerId:'m1',id:'msg',turnId:'t',kind:'message',worldWitnessIds:['m1'],content:'收到钥匙。'},
        {role:'user',turnId:'unfinished',kind:'dialogue',content:'单独的用户输入。'}];
    changed(room, 'room');
    const service = runner([{mode:'room',work:room}], async (messages,mode) => {
        assert.equal(mode,'room');
        const input = JSON.parse(messages[1].content).source;
        assert.match(input,/这是给你的。/);
        assert.doesNotMatch(input,/命令|节点|预览|候选|单独/);
        return reply('收到钥匙。');
    });
    await service.wake();
    assert.equal(rows(room).length, 1);
    const entry = room.worldBook.progressEntries[0];
    assert.equal(entry.sourceStartIndex,0);
    assert.equal(entry.sourceEndIndex,3);
    assert.equal(entry.origin.sourceLabel,'房间记录 1–4');
    assert.equal(entry.knowledgeScope, 'private');
    assert.deepEqual(entry.characterIds,['m1']);
    const prior = structuredClone(room);
    room.messages.push({id:'scene',role:'system',turnId:'s',kind:'narration',content:'钟楼熄了灯。',worldWitnessIds:['m1','m2']});
    changed(room, 'room', prior);
    assert.equal(rows(room).at(-1).status, 'pending');
});

test('an in-flight result after undo cannot enter either work with matching ids', async () => {
    const work = makeWork('story'), room = makeWork('room');
    const entries = [{mode:'story',work},{mode:'room',work:room}];
    work.conversations.push({role:'assistant',id:'old',content:'从前的正文。'});
    changed(work, 'story');
    let started, release;
    const waiting = new Promise(resolve => { started = resolve; });
    const service = runner(entries, () => {
        started();
        return new Promise(resolve => { release = resolve; });
    });
    const done = service.wake();
    await waiting;
    const prior = structuredClone(work);
    work.conversations.pop();
    changed(work, 'story', prior);
    release(reply('从前的正文。'));
    await done;
    assert.deepEqual(rows(work), []);
    assert.deepEqual(work.worldBook.progressEntries, []);
    assert.deepEqual(room.worldBook.progressEntries, []);
});

test('invalid extraction is atomic across chunks, failure is durable, retry is explicit', async () => {
    const work = makeWork('story');
    work.conversations.push({role:'assistant',content:'前'.repeat(6000)+'后来补好了屋顶。'});
    changed(work,'story');
    let attempts = 0, fail = true;
    const service = runner([{mode:'story',work}], async messages => {
        attempts++;
        const text = JSON.parse(messages[1].content).source;
        return text.includes('屋顶') && fail ? reply('编造。') : reply(text.slice(-3));
    });
    await service.wake();
    assert.equal(rows(work)[0].status,'failed');
    assert.equal(work.worldBook.progressEntries.length,0);
    await service.wake();
    assert.equal(attempts,2);
    fail = false;
    await service.retry('story', work.id);
    assert.equal(attempts,4);
    assert.equal(rows(work)[0].status,'done');
    assert.equal(work.worldBook.progressEntries.length,2);
});

test('rewriting tracked sources removes derived facts and detaches author edits, even after switching automation off', async () => {
    const work = makeWork('story');
    work.conversations.push({role:'assistant',content:'获得钥匙、辞去教职。'});
    changed(work,'story');
    const service = runner([{mode:'story',work}], async () => ({entries:[...reply('获得钥匙').entries,...reply('辞去教职').entries]}));
    await service.wake();
    work.worldBook.progressEntries[0].fields[0].value='作者决定保留钥匙。';
    work.worldBook.automation.enabled=false;
    const prior = structuredClone(work);
    work.conversations[0].content='后来改写。';
    changed(work,'story',prior);
    assert.deepEqual(rows(work),[]);
    assert.deepEqual(work.worldBook.progressEntries.map(e=>e.fields[0].value),['作者决定保留钥匙。']);
    assert.equal(work.worldBook.progressEntries[0].origin,undefined);
});

test('verified pending jobs resume from the saved work without recruiting earlier chapters', async () => {
    const original = makeWork('story');
    original.conversations.push({role:'assistant',id:'history',content:'旧章。'}, {role:'assistant',id:'current',content:'现在的正式章节。'});
    P.reconcile(AI,'story',original,['story:current']);
    const restored = JSON.parse(JSON.stringify(original));
    restored.worldBook = Book.normalizeWorldBook(restored.worldBook);
    P.reconcile(AI,'story',restored,[],true);
    const queries = [];
    await runner([{mode:'story',work:restored}], async messages => {
        const source = JSON.parse(messages[1].content).source;
        queries.push(source);
        return reply(source);
    }).wake();
    assert.deepEqual(queries,['现在的正式章节。']);
    assert.deepEqual(rows(restored).map(row => row.key),['story:current']);
    assert.deepEqual(restored.worldBook.progressEntries[0].sourceStartIndex,1);
});

test('a failed local write prevents sending the extraction request', async () => {
    const work = makeWork('story');
    work.conversations.push({role:'assistant',id:'durable',content:'正式章节。'});
    changed(work,'story');
    let requests = 0;
    const service = P.create({ai:AI,works:() => [{mode:'story',work}],getWork:() => work,
        ready:() => true,blocked:() => false,save:() => {},
        flush:async () => {throw new Error('容量不足');},request:async () => {requests++;}});
    await service.wake();
    assert.equal(requests,0);
    assert.equal(rows(work)[0].status,'failed');
    assert.equal(work.conversations[0].content,'正式章节。');
});

test('disabling automation while the request runs discards its response, and deleting an edited source never revives it', async () => {
    const work = makeWork('room');
    work.messages.push({role:'system',kind:'narration',id:'s1',content:'花谢了。',worldWitnessIds:['m1']});
    changed(work,'room');
    const service = runner([{mode:'room',work}], async () => {
        work.worldBook.automation.enabled = false;
        return reply('花谢了。');
    });
    await service.wake();
    assert.equal(work.worldBook.progressEntries.length,0);
    assert.equal(rows(work)[0].status,'pending');
    work.messages=[];
    P.reconcile(AI,'room',work,[],true);
    assert.equal(rows(work).length,0);
    work.worldBook.automation.enabled = true;
    await service.wake();
    assert.equal(work.worldBook.progressEntries.length,0);
});
