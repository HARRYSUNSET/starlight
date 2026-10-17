(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StarlightPersistence = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /**
     * Serializes writes while coalescing requests received during a pending write.
     * writeFn reads the current state when invoked and returns a promise that
     * settles when persistence completes (for IndexedDB, on transaction completion).
     * The first write starts synchronously, including when called from pagehide.
     */
    function createCoalescedWriter(writeFn) {
        if (typeof writeFn !== 'function') throw new TypeError('writeFn must be a function');

        let active = false;
        let waiting = [];

        function finish(batch, succeeded, error) {
            active = false;
            for (const waiter of batch) {
                if (succeeded) waiter.resolve();
                else waiter.reject(error);
            }
            // Failure belongs to this batch only; queued newer state still writes.
            start();
        }

        function start() {
            if (active || !waiting.length) return;
            active = true;
            const batch = waiting;
            waiting = [];
            let result;
            try {
                result = writeFn();
            } catch (error) {
                finish(batch, false, error);
                return;
            }
            Promise.resolve(result).then(
                () => finish(batch, true),
                error => finish(batch, false, error)
            );
        }

        function request() {
            return new Promise((resolve, reject) => {
                waiting.push({ resolve, reject });
                start();
            });
        }

        return { request };
    }

    const DATABASE_VERSION = 2;
    const STORES = ['app_meta', 'works', 'messages', 'memories', 'assets'];
    const ASSET_TAG = '$starlightAsset';
    const databaseCaches = new WeakMap();
    const assetCache = new Map();

    function imageId(value) {
        if (assetCache.has(value)) return assetCache.get(value);
        // Two independent hashes plus length. Actual equality is checked below;
        // this is an address for local deduplication, not a security digest.
        let a = 2166136261;
        let b = 5381;
        for (let i = 0; i < value.length; i += 1) {
            a = Math.imul(a ^ value.charCodeAt(i), 16777619);
            b = Math.imul(b, 33) ^ value.charCodeAt(i);
        }
        const id = `image_${value.length}_${a >>> 0}_${b >>> 0}`;
        if (assetCache.size >= 64) assetCache.delete(assetCache.keys().next().value);
        assetCache.set(value, id);
        return id;
    }

    function emptyRecords() {
        return Object.fromEntries(STORES.map(name => [name, new Map()]));
    }

    function encodeAssets(value, assets) {
        if (typeof value === 'string' && /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value)) {
            let key = imageId(value);
            while (assets.has(key) && assets.get(key).value !== value) key += '_collision';
            assets.set(key, { key, value });
            return { [ASSET_TAG]: key };
        }
        if (Array.isArray(value)) return value.map(item => encodeAssets(item, assets));
        if (value && typeof value === 'object') {
            const result = {};
            for (const key of Object.keys(value)) {
                if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('数据包含非法属性');
                if (value[key] !== undefined) result[key] = encodeAssets(value[key], assets);
            }
            return result;
        }
        return value;
    }

    function decodeAssets(value, assets) {
        if (Array.isArray(value)) return value.map(item => decodeAssets(item, assets));
        if (value && typeof value === 'object') {
            if (Object.keys(value).length === 1 && typeof value[ASSET_TAG] === 'string') {
                const asset = assets.get(value[ASSET_TAG]);
                if (!asset) throw new Error('图片记录缺失，已停止加载以免覆盖数据');
                return asset.value;
            }
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeAssets(item, assets)]));
        }
        return value;
    }

    function splitState(state) {
        if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('保存数据格式无效');
        const records = emptyRecords();
        const app = { ...state };
        delete app.agents;
        delete app.rooms;
        const order = { story: [], room: [] };
        for (const [mode, collection] of [['story', state.agents || []], ['room', state.rooms || []]]) {
            if (!Array.isArray(collection)) throw new Error('作品列表格式无效');
            for (const work of collection) {
                if (!work || typeof work.id !== 'string' || !work.id) throw new Error('作品缺少标识');
                const owner = JSON.stringify([mode, work.id]);
                if (records.works.has(owner)) throw new Error('存在重复作品标识');
                order[mode].push(work.id);
                const data = { ...work };
                const messageField = mode === 'story' ? 'conversations' : 'messages';
                const messages = Array.isArray(data[messageField]) ? data[messageField] : [];
                const hasMessages = Object.prototype.hasOwnProperty.call(data, messageField);
                delete data[messageField];
                const memoryFields = mode === 'story' ? ['memory'] : ['sharedMemory', 'characterMemories'];
                const memoryDescriptors = [];
                function storeMemory(memory, scope) {
                    const base = memory && typeof memory === 'object' && !Array.isArray(memory) ? { ...memory } : memory;
                    const lists = {};
                    if (base && typeof base === 'object') {
                        for (const field of ['facts', 'segments']) {
                            if (!Array.isArray(base[field])) continue;
                            lists[field] = base[field].length;
                            base[field].forEach((item, index) => {
                                const key = JSON.stringify([mode, work.id, scope, field, index]);
                                records.memories.set(key, { key, owner, value: encodeAssets(item, records.assets) });
                            });
                            delete base[field];
                        }
                    }
                    const key = JSON.stringify([mode, work.id, scope]);
                    records.memories.set(key, { key, owner, value: encodeAssets(base, records.assets), lists });
                    memoryDescriptors.push(scope);
                }
                for (const field of memoryFields) {
                    if (!Object.prototype.hasOwnProperty.call(data, field) || data[field] === undefined) continue;
                    if (field === 'characterMemories') {
                        for (const [id, memory] of Object.entries(data[field] || {})) storeMemory(memory, ['character', id]);
                        memoryDescriptors.push(['characterContainer']);
                    } else storeMemory(data[field], [field]);
                    delete data[field];
                }
                records.works.set(owner, { key: owner, mode, id: work.id, value: encodeAssets(data, records.assets), hasMessages, messageCount: messages.length, memoryDescriptors });
                messages.forEach((message, index) => {
                    const key = JSON.stringify([mode, work.id, index]);
                    records.messages.set(key, { key, owner, index, value: encodeAssets(message, records.assets) });
                });
            }
        }
        records.app_meta.set('app', { key: 'app', schema: 2, value: encodeAssets(app, records.assets), order });
        return records;
    }

    function joinWork(records, row) {
        const work = decodeAssets(row.value, records.assets);
        if (row.hasMessages) {
            work[row.mode === 'story' ? 'conversations' : 'messages'] = Array.from({ length: row.messageCount }, (_, index) => {
                const item = records.messages.get(JSON.stringify([row.mode, row.id, index]));
                if (!item) throw new Error('消息记录缺失，已停止加载以免覆盖历史');
                return decodeAssets(item.value, records.assets);
            });
        }
        for (const scope of row.memoryDescriptors || []) {
            if (scope[0] === 'characterContainer') { work.characterMemories ||= {}; continue; }
            const record = records.memories.get(JSON.stringify([row.mode, row.id, scope]));
            if (!record) throw new Error('记忆记录缺失，已停止加载以免覆盖历史');
            const memory = decodeAssets(record.value, records.assets);
            for (const [field, length] of Object.entries(record.lists || {})) {
                memory[field] = Array.from({ length }, (_, index) => {
                    const item = records.memories.get(JSON.stringify([row.mode, row.id, scope, field, index]));
                    if (!item) throw new Error('记忆条目缺失，已停止加载');
                    return decodeAssets(item.value, records.assets);
                });
            }
            if (scope[0] === 'character') { work.characterMemories ||= {}; work.characterMemories[scope[1]] = memory; }
            else work[scope[0]] = memory;
        }
        return work;
    }

    function joinState(records) {
        const meta = records.app_meta.get('app');
        if (!meta) return null;
        if (meta.schema !== 2) throw new Error('数据库版本不兼容');
        const state = decodeAssets(meta.value, records.assets);
        for (const [mode, field] of [['story', 'agents'], ['room', 'rooms']]) {
            state[field] = (meta.order[mode] || []).map(id => {
                const row = records.works.get(JSON.stringify([mode, id]));
                if (!row) throw new Error('作品记录缺失，已停止加载以免覆盖历史');
                return joinWork(records, row);
            });
        }
        return state;
    }

    function signatures(records) {
        return Object.fromEntries(STORES.map(name => [name, new Map(Array.from(records[name], ([key, row]) => [key, name === 'assets' ? row.value : JSON.stringify(row)]))]));
    }

    function diffRecords(records, previous) {
        const changes = {};
        for (const name of STORES) {
            const old = previous?.[name] || new Map();
            const puts = [];
            for (const [key, row] of records[name]) if (old.get(key) !== (name === 'assets' ? row.value : JSON.stringify(row))) puts.push(row);
            changes[name] = { puts, deletes: Array.from(old.keys()).filter(key => !records[name].has(key)) };
        }
        return changes;
    }

    function openDatabase(options = {}) {
        return new Promise((resolve, reject) => {
            const provider = options.indexedDB || globalThis.indexedDB;
            if (!provider) { reject(new Error('当前环境不支持 IndexedDB')); return; }
            const request = provider.open(options.name || 'starlight_chat_database', DATABASE_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
                for (const name of STORES) {
                    if (db.objectStoreNames.contains(name)) continue;
                    const store = db.createObjectStore(name, { keyPath: 'key' });
                    if (name === 'messages' || name === 'memories') store.createIndex('owner', 'owner', { unique: false });
                }
            };
            request.onerror = () => reject(request.error || new Error('打开本地数据库失败'));
            request.onblocked = () => reject(new Error('请先关闭其他打开星光的窗口，再重新打开以完成数据库升级'));
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => db.close();
                resolve(db);
            };
        });
    }

    function readRecords(db) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([...STORES, 'state'], 'readonly');
            const records = emptyRecords();
            let legacy;
            for (const name of STORES) {
                const request = transaction.objectStore(name).getAll();
                request.onsuccess = () => {
                    for (const row of request.result) records[name].set(row.key, row);
                    if (name === 'app_meta' && !records.app_meta.has('app')) {
                        const old = transaction.objectStore('state').get('appData');
                        old.onsuccess = () => { legacy = old.result; };
                    }
                };
            }
            transaction.oncomplete = () => resolve({ records, legacy });
            transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('读取本地数据库失败'));
        });
    }

    async function readState(db) {
        const { records, legacy } = await readRecords(db);
        const meta = records.app_meta.get('app');
        databaseCaches.set(db, { signatures: signatures(records), commit: meta?.commit || null });
        if (meta) return joinState(records);
        if (!legacy) return null;
        const prepared = splitState(legacy);
        // Verify the entire round trip before migration. The original state store
        // remains untouched, including on quota, validation or transaction errors.
        const stable = value => JSON.stringify(value, function (key, item) {
            return item && !Array.isArray(item) && typeof item === 'object'
                ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item;
        });
        if (stable(joinState(prepared)) !== stable({ ...legacy, agents: legacy.agents || [], rooms: legacy.rooms || [] })) {
            throw new Error('旧数据迁移校验失败；原始数据仍完整保留');
        }
        await writeState(db, legacy);
        return joinState(prepared);
    }

    function writeState(db, snapshot) {
        if (!databaseCaches.has(db)) {
            return readState(db).then(() => writeState(db, snapshot));
        }
        const previous = databaseCaches.get(db);
        const records = splitState(snapshot);
        const oldMeta = previous.signatures.app_meta.get('app');
        const candidate = records.app_meta.get('app');
        if (oldMeta) candidate.commit = previous.commit;
        const changes = diffRecords(records, previous.signatures);
        const total = Object.values(changes).reduce((sum, change) => sum + change.puts.length + change.deletes.length, 0);
        if (!total) return Promise.resolve({ writes: 0, deletes: 0 });
        const commit = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        candidate.commit = commit;
        changes.app_meta.puts = [candidate];
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORES, 'readwrite');
            let conflict = false;
            const check = transaction.objectStore('app_meta').get('app');
            check.onsuccess = () => {
                if ((check.result?.commit || null) !== previous.commit) {
                    conflict = true;
                    transaction.abort();
                    return;
                }
                for (const name of STORES) {
                    const store = transaction.objectStore(name);
                    for (const row of changes[name].puts) store.put(row);
                    for (const key of changes[name].deletes) store.delete(key);
                }
            };
            transaction.oncomplete = () => {
                databaseCaches.set(db, { signatures: signatures(records), commit });
                resolve({ writes: Object.values(changes).reduce((n, c) => n + c.puts.length, 0), deletes: Object.values(changes).reduce((n, c) => n + c.deletes.length, 0) });
            };
            transaction.onabort = transaction.onerror = () => reject(conflict
                ? new Error('另一窗口已修改作品；请备份当前内容并重新打开，避免覆盖新数据')
                : transaction.error || new Error('本地数据库保存未完成，原记录未被替换'));
        });
    }

    function readLibrary(db) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('works', 'readonly');
            const request = transaction.objectStore('works').getAll();
            transaction.oncomplete = () => resolve(request.result.map(row => ({ mode: row.mode, id: row.id, name: row.value.name, subtitle: row.value.subtitle, messageCount: row.messageCount })));
            transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('读取作品目录失败'));
        });
    }

    function readWork(db, mode, id) {
        return new Promise((resolve, reject) => {
            const owner = JSON.stringify([mode, id]);
            const records = emptyRecords();
            const transaction = db.transaction(['works', 'messages', 'memories', 'assets'], 'readonly');
            let work;
            const request = transaction.objectStore('works').get(owner);
            request.onsuccess = () => { work = request.result; };
            for (const name of ['messages', 'memories', 'assets']) {
                const store = transaction.objectStore(name);
                const rows = name === 'assets' ? store.getAll() : store.index('owner').getAll(owner);
                rows.onsuccess = () => { for (const row of rows.result) records[name].set(row.key, row); };
            }
            transaction.oncomplete = () => {
                try { resolve(work ? joinWork(records, work) : null); } catch (error) { reject(error); }
            };
            transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('读取作品失败'));
        });
    }

    return { createCoalescedWriter, DATABASE_VERSION, STORES, openDatabase, readState, writeState, readLibrary, readWork, splitState, joinState, signatures, diffRecords };
});
