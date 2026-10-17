const test = require('node:test');
const assert = require('node:assert/strict');

const Persistence = require('../www/persistence.js');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

test('首次保存请求同步开始写入，无需等到微任务或定时器', async () => {
    const write = deferred();
    let calls = 0;
    const writer = Persistence.createCoalescedWriter(() => {
        calls += 1;
        return write.promise;
    });
    const completion = writer.request();
    assert.equal(calls, 1);
    write.resolve();
    await completion;
});

test('保存期间的多个请求合并，后续写入读取最新状态而不提前复制整库', async () => {
    const state = { messages: ['第一条'] };
    const snapshots = [];
    const writes = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const writer = Persistence.createCoalescedWriter(() => {
        snapshots.push(structuredClone(state));
        const write = deferred();
        writes.push(write);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return write.promise.finally(() => { inFlight -= 1; });
    });
    const first = writer.request();
    state.messages.push('第二条');
    const second = writer.request();
    state.messages.push('第三条');
    const third = writer.request();
    assert.equal(writes.length, 1);
    assert.deepEqual(snapshots, [{ messages: ['第一条'] }]);

    writes[0].resolve();
    await first;
    assert.equal(writes.length, 2);
    assert.deepEqual(snapshots[1], { messages: ['第一条', '第二条', '第三条'] });
    writes[1].resolve();
    await Promise.all([second, third]);
    assert.equal(maxInFlight, 1);
    assert.equal(writes.length, 2);
});

test('每个请求仅在覆盖其状态的批次完成后兑现，并保持完成顺序', async () => {
    const writes = [];
    const completed = [];
    const writer = Persistence.createCoalescedWriter(() => {
        const write = deferred();
        writes.push(write);
        return write.promise;
    });
    const first = writer.request().then(() => { completed.push(1); });
    const second = writer.request().then(() => { completed.push(2); });
    const third = writer.request().then(() => { completed.push(3); });
    writes[0].resolve();
    await first;
    assert.deepEqual(completed, [1]);
    assert.equal(writes.length, 2);
    const fourth = writer.request().then(() => { completed.push(4); });
    writes[1].resolve();
    await Promise.all([second, third]);
    assert.deepEqual(completed, [1, 2, 3]);
    assert.equal(writes.length, 3);
    writes[2].resolve();
    await fourth;
    assert.deepEqual(completed, [1, 2, 3, 4]);
});

test('异步失败传递原始错误，已排队的新状态继续写入且可以再次保存', async () => {
    const writes = [];
    const failure = new Error('数据库暂时不可写');
    const writer = Persistence.createCoalescedWriter(() => {
        const write = deferred();
        writes.push(write);
        return write.promise;
    });
    const first = writer.request();
    const failureCheck = assert.rejects(first, error => error === failure);
    const second = writer.request();
    const third = writer.request();
    writes[0].reject(failure);
    await failureCheck;
    assert.equal(writes.length, 2);
    writes[1].resolve();
    await Promise.all([second, third]);
    const fourth = writer.request();
    assert.equal(writes.length, 3);
    writes[2].resolve();
    await fourth;
});

test('合并批次失败时所有对应请求均拒绝，后续批次不受影响', async () => {
    const writes = [];
    const failure = new Error('事务中止');
    const writer = Persistence.createCoalescedWriter(() => {
        const write = deferred();
        writes.push(write);
        return write.promise;
    });
    const first = writer.request();
    const second = writer.request();
    const third = writer.request();
    const secondCheck = assert.rejects(second, error => error === failure);
    const thirdCheck = assert.rejects(third, error => error === failure);
    writes[0].resolve();
    await first;
    const fourth = writer.request();
    writes[1].reject(failure);
    await Promise.all([secondCheck, thirdCheck]);
    assert.equal(writes.length, 3);
    writes[2].resolve();
    await fourth;
});

test('同步抛错不会卡住队列，下一请求仍同步开始', async () => {
    const failure = new Error('同步失败');
    let calls = 0;
    const writer = Persistence.createCoalescedWriter(() => {
        calls += 1;
        if (calls === 1) throw failure;
    });
    await assert.rejects(writer.request(), error => error === failure);
    const next = writer.request();
    assert.equal(calls, 2);
    await next;
});

test('写入函数同步产生的新请求进入下一批次，当前抛错也不丢失该请求', async () => {
    const failure = new Error('首批写入失败');
    let calls = 0;
    let next;
    const writer = Persistence.createCoalescedWriter(() => {
        calls += 1;
        if (calls === 1) {
            next = writer.request();
            throw failure;
        }
    });
    await assert.rejects(writer.request(), error => error === failure);
    await next;
    assert.equal(calls, 2);
});
