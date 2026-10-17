// Executed inside the isolated Chrome test page by scripts/check-ui.js.
// No real user database, API key or network request is used.
module.exports = async function checkPersistenceInBrowser() {
    const P = window.StarlightPersistence;
    const name = `starlight-storage-test-${Date.now()}-${Math.random()}`;
    const image = 'data:image/png;base64,YWJj';
    const original = {
        apiKey: 'fixture-only', agents: [{ id: 'story-a', name: '车站', draft: '', avatar: image,
            conversations: [{ role: 'user', content: '第一章' }, { role: 'assistant', content: '在车站重逢' }],
            memory: { core: '主线', facts: [{ id: 'fact-a', content: '钥匙', locked: true }], segments: [{ summary: '重逢' }] } }],
        rooms: [{ id: 'room-a', name: '茶室', backgroundImage: image, participants: [{ id: 'p1', name: '小雨', avatar: image }],
            messages: [{ role: 'system', content: '清晨' }], sharedMemory: { core: '公共记忆', facts: [] }, characterMemories: { p1: { core: '私密记忆', facts: [{ content: '秘密' }] } } }], styleProfiles: [],
    };
    const stable = value => JSON.stringify(value, function (key, item) {
        return item && !Array.isArray(item) && typeof item === 'object'
            ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item;
    });
    const checks = [];
    const check = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };
    const readLegacy = db => new Promise((resolve, reject) => {
        const tx = db.transaction('state', 'readonly');
        const request = tx.objectStore('state').get('appData');
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = () => reject(tx.error);
    });
    const seedLegacy = dbName => new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('state');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('state', 'readwrite');
            tx.objectStore('state').put(original, 'appData');
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onabort = () => reject(tx.error);
        };
    });
    function interceptWrites(db, abortAfterFirstPut) {
        const native = db.transaction.bind(db);
        const writes = [];
        db.transaction = function (stores, mode) {
            const tx = native(stores, mode);
            if (mode !== 'readwrite') return tx;
            const objectStore = tx.objectStore.bind(tx);
            let abortScheduled = false;
            tx.objectStore = function (name) {
                const store = objectStore(name);
                const put = store.put.bind(store);
                store.put = function (...args) {
                    writes.push(name);
                    const request = put(...args);
                    if (abortAfterFirstPut && !abortScheduled) {
                        abortScheduled = true;
                        request.addEventListener('success', () => tx.abort(), { once: true });
                    }
                    return request;
                };
                return store;
            };
            return tx;
        };
        return { writes, restore: () => { delete db.transaction; } };
    }
    let db;
    let second;
    let failedMigrationDb;
    try {
        await seedLegacy(name);
        db = await P.openDatabase({ name });
        let state = await P.readState(db);
        check(stable(state) === stable(original), 'v1→v2迁移完整往返');
        check(stable(await readLegacy(db)) === stable(original), '迁移保留旧state/appData原件');
        let monitor = interceptWrites(db, false);
        state.agents[0].draft = '下一章';
        const draftResult = await P.writeState(db, state);
        monitor.restore();
        check(draftResult.writes === 2 && monitor.writes.every(store => store === 'works' || store === 'app_meta'), '草稿只更新作品和提交记录');
        monitor = interceptWrites(db, false);
        state.agents[0].conversations.push({ role: 'user', content: '第二章' });
        await P.writeState(db, state);
        monitor.restore();
        check(monitor.writes.filter(store => store === 'messages').length === 1 && !monitor.writes.includes('assets'), '新增消息只写入一条消息且不重写图片');
        monitor = interceptWrites(db, false);
        state.agents[0].memory.facts[0].content = '新的钥匙';
        await P.writeState(db, state);
        monitor.restore();
        check(monitor.writes.filter(store => store === 'memories').length === 1, '修改事实仅更新相应记忆记录');
        const committed = structuredClone(state);
        state.agents[0].name = '不应提交';
        state.agents[0].conversations.push({ role: 'assistant', content: '不应留下' });
        monitor = interceptWrites(db, true);
        let failed = false;
        try { await P.writeState(db, state); } catch (error) { failed = true; }
        monitor.restore();
        check(failed, '事务中止必须报告失败');
        state = await P.readState(db);
        check(stable(state) === stable(committed), '中止事务保留全部原作品消息记忆');
        state.agents[0].conversations.pop();
        const undoResult = await P.writeState(db, state);
        check(undoResult.deletes === 1 && (await P.readState(db)).agents[0].conversations.length === 2, '撤回删除旧消息记录且重开不复活');
        check((await P.readLibrary(db)).length === 2, '目录独立读取作品列表');
        check(stable(await P.readWork(db, 'room', 'room-a')) === stable(state.rooms[0]), '单作品读取保持公共私密记忆和图片');
        second = await P.openDatabase({ name });
        const oldState = await P.readState(second);
        state.agents[0].name = '窗口一的修改';
        await P.writeState(db, state);
        oldState.agents[0].name = '窗口二过时的修改';
        let conflict = false;
        try { await P.writeState(second, oldState); } catch (error) { conflict = /另一窗口/.test(error.message); }
        check(conflict && (await P.readState(second)).agents[0].name === '窗口一的修改', '跨窗口过时状态拒绝覆盖');

        await seedLegacy(name + '-failure');
        failedMigrationDb = await P.openDatabase({ name: name + '-failure' });
        monitor = interceptWrites(failedMigrationDb, true);
        let migrationFailed = false;
        try { await P.readState(failedMigrationDb); } catch (error) { migrationFailed = true; }
        monitor.restore();
        check(migrationFailed && stable(await readLegacy(failedMigrationDb)) === stable(original), '失败迁移保留原件并报告错误');
        check(stable(await P.readState(failedMigrationDb)) === stable(original), '失败迁移可以重试且不丢数据');
        return { checks: checks.length, messages: checks };
    } finally {
        if (db) db.close();
        if (second) second.close();
        if (failedMigrationDb) failedMigrationDb.close();
        for (const dbName of [name, name + '-failure']) {
            await new Promise((resolve, reject) => {
                const request = indexedDB.deleteDatabase(dbName);
                request.onsuccess = resolve;
                request.onerror = () => reject(request.error);
                request.onblocked = () => reject(new Error('测试数据库清理被阻塞'));
            });
        }
    }
};
