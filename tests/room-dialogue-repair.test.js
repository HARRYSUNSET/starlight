const test = require('node:test');
const assert = require('node:assert/strict');
const Room = require('../www/room-engine.js');

test('本地格式修正可读单个带围栏、前缀、注释、尾逗号的对象，并尊重字符串边界', () => {
    const raw = '好的，以下是 JSON 回复：\n```json\n{"speech":"明天见！","expression":"眨眼","note":"转义 \\" } 字符",}\n```\n说明：已整理。';
    const parsed = Room.recoverDialogue(raw);
    assert.deepEqual(parsed,{speech:'明天见！',expression:'眨眼',content:'（眨眼）明天见！'});
    assert.equal(Room.recoverDialogue('{"动作":"点头","台词":"交给我。"}').content,'（点头）交给我。');
    assert.equal(Room.recoverDialogue({expression:null,speech:'来吧。'}).content,'来吧。');
    assert.throws(() => Room.parseDialogue('以下是 JSON：{"speech":"明天见！"}'));
});

test('本地修正辨认普通单人对白、引号和动作，输出与房间原有气泡一致', () => {
    const member = {name:'阿秋'};
    for (const line of ['你把钥匙带来了吗？','明天见。','Hmm？','谢谢你！','🙂']) {
        let value = line;
        if (line === 'Hmm？') value = '“' + line + '”';
        assert.equal(Room.recoverDialogue(value,member)?.content,line);
    }
    assert.equal(Room.recoverDialogue('阿秋：别急，我在这里。',member).speech,'别急，我在这里。');
    assert.equal(Room.recoverDialogue('阿秋说：“把窗打开。”',member).speech,'把窗打开。');
    assert.equal(Room.recoverDialogue('（轻轻点头）「潮汐今天提早了。」',member).content,'（轻轻点头）潮汐今天提早了。');
    assert.equal(Room.recoverDialogue('（抿嘴笑）').content,'（抿嘴笑）');
});

test('草稿不可判定时交给后续修正，禁止将模型说明、心理叙述、其他人物或结构数据写入角色气泡', () => {
    const member = {name:'阿秋'};
    for (const raw of ['小纪：快跑。','我先来。\n小纪：好的。','她心里想着该怎么回答。','她把伞放下了。',
        '作为一个AI，我需要先分析用户请求。','好的，以下是 JSON 格式的对白。','我需要输出符合格式的回复。','（内心很担心）我还好。',
        '“好的。”她说，“明天见。”','<think>我先分析一下。</think>你好吗？',
        '[{"speech":"嗯。"}]','true','null','123','{"thought":"别公布这段。"}','以下是多个回复：{"speech":"甲"} {"speech":"乙"}','以下是示例模板：{"speech":"假定台词"}',
        '{"speech":["好","走吧"],"expression":"点头"}','{"expression":false,"speech":"我先走。"}','{"speech":"你好。","台词":"再见！"}',
        {speech:'',expression:'他心想明天再走也不迟'},'{"draft":{"quote":"明天见！"}}','{"speech":"半句正文',
        '“”','！！！','()','（心中发愁）',[]]) assert.equal(Room.recoverDialogue(raw,member),null,JSON.stringify(raw));
    const result = Room.recoverDialogue({speech:'我先走了！',expression:'她在心里琢磨答案'});
    assert.deepEqual(result,{speech:'我先走了！',expression:'',content:'我先走了！'});
});

test('修正请求仅传给定角色名字和可见候选，保留明确的嵌套台词依据，不发送私密设定或推理内容', () => {
    const data = {draft:{quote:'明天见。',visible:'抬眼',analysis:'秘密推理'},memo:'秘密备忘',reasoning_content:'模型推理'};
    const member = {name:'小纪',knowledgeBoundary:'角色秘密',history:['房间私有历史'],secret:'额外身份'};
    const [system,user] = Room.buildRepairMessages(JSON.stringify(data),member);
    assert.match(system.content,/房间对白格式修正/);
    const body = JSON.parse(user.content);
    assert.equal(body.speaker,'小纪');
    assert.deepEqual(JSON.parse(body.candidate),{draft:{visible:'抬眼',quote:'明天见。'}});
    assert.doesNotMatch(user.content,/秘密|推理|额外身份|私有历史/);
    assert.equal(system.role,'system');
    assert.equal(user.role,'user');
    assert.equal(JSON.parse(Room.buildRepairMessages('<think>机密</think>明天见。',member)[1].content).candidate,'明天见。');
    assert.doesNotMatch(Room.buildRepairMessages({speech:'<think>机密</think>明天见。'},member)[1].content,/机密/);
    for (const raw of [null,'','<think>机密</think>','{"reasoning_content":"机密"}','true','[{"reasoning_content":"机密"}]'])
        assert.equal(Room.buildRepairMessages(raw,member),null);
});

test('模型修正须引用角色原稿，去除引号或调整标点可以，凭空增加台词不能写入；无依据的神态不污染有效台词', () => {
    const raw = JSON.stringify({draft:{visible:'抬眼',quote:'“等、等一下……我忘拿伞了！”'},memo:'另起剧情'});
    const dialogue = {expression:'抬眼',speech:'等等一下，我忘拿伞了。'};
    assert.equal(Room.validateRepairedDialogue(raw,dialogue).content,'（抬眼）等等一下，我忘拿伞了。');
    for (const expression of ['突然拔腿就跑','心里很想赶稿',[],false]) {
        assert.equal(Room.validateRepairedDialogue(raw,{...dialogue,expression}).content,dialogue.speech);
    }
    for (const speech of ['顺便去把门打开。','另起剧情','抬眼','draft'])
        assert.throws(() => Room.validateRepairedDialogue(raw,{speech}),/未出现/);
    assert.throws(() => Room.validateRepairedDialogue(raw,{expression:'另起剧情',speech:''}),/可确认/);
    assert.throws(() => Room.validateRepairedDialogue('{"reasoning_content":"机密"}',{speech:'机密'}),/依据/);
    const wrapped = {speech:['明天见。']};
    assert.equal(Room.recoverDialogue(wrapped),null);
    assert.equal(Room.validateRepairedDialogue(wrapped,{speech:'明天见。'}).content,'明天见。');
});

test('修复路径使用一致的玩家指代，同时保留动作证据要求', () => {
    const raw={draft:{visible:'她把书递给【玩家】',quote:'请收下。'}};
    assert.equal(Room.recoverDialogue('（她把书递给【玩家】）「请收下。」').content,'（她把书递给你）请收下。');
    assert.equal(Room.validateRepairedDialogue(raw,{expression:'她把书递给你',speech:'请收下。'}).content,'（她把书递给你）请收下。');
    assert.equal(Room.validateRepairedDialogue(raw,{expression:'她抱住你',speech:'请收下。'}).content,'请收下。');
});
