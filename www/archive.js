(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StarlightArchive = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const FORMAT = 'starlight-backup';
    const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
    const MAX_REVISIONS = 12;
    const SECRET_KEYS = new Set(['apiKey', 'apiKeys']);
    const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype', '$starlightAsset']);
    const MEDIA_KEYS = new Set(['avatar', 'backgroundImage']);
    const STORY_FIELDS = ['name', 'subtitle', 'storyRules', 'worldPrompt', 'worldBook', 'openingScene', 'currentScene', 'userPersona', 'characters', 'stylePrompt', 'styleExamples', 'otherInfo', 'styleInfluence', 'memory'];
    const ROOM_FIELDS = ['name', 'subtitle', 'basePrompt', 'worldPrompt', 'worldBook', 'scenePrompt', 'userPersona', 'participants', 'styleEnabled', 'stylePrompt', 'styleExamples', 'otherInfo', 'styleInfluence', 'narrationEnabled', 'turnMode', 'maxSpeakers', 'sharedMemory', 'characterMemories', 'intimacy'];
    const fieldsFor = mode => mode === 'room' ? ROOM_FIELDS : STORY_FIELDS;
    const clone = value => JSON.parse(JSON.stringify(value));
    const byteLength = value => new TextEncoder().encode(value).byteLength;
    const makeId = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    function cleanTree(value, options = {}, depth = 0, counter = { value: 0 }) {
        counter.value += 1;
        if (counter.value > 2000000 || depth > 64) throw new Error('备份结构过大或嵌套过深');
        if (value === null || typeof value === 'boolean') return value;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) throw new Error('备份中存在非法数值');
            return value;
        }
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) return value.map(item => cleanTree(item, options, depth + 1, counter));
        if (!value || typeof value !== 'object') throw new Error('备份包含不支持的数据');
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) throw new Error('备份只能包含普通数据');
        const result = {};
        for (const [key, item] of Object.entries(value)) {
            if (FORBIDDEN_KEYS.has(key)) throw new Error('备份包含非法属性');
            if (SECRET_KEYS.has(key)) continue;
            if (item === undefined) continue;
            if (MEDIA_KEYS.has(key) && item) {
                if (typeof item !== 'string' || !/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(item)) {
                    throw new Error('备份图片必须为 PNG、JPEG、WebP 或 GIF 内嵌图片');
                }
            }
            if (options.omitImages && typeof item === 'string' && /^data:image\//i.test(item)) continue;
            result[key] = cleanTree(item, options, depth + 1, counter);
        }
        return result;
    }

    function validateWorks(works, mode) {
        if (!Array.isArray(works) || works.length > 10000) throw new Error('作品列表格式无效或数量过多');
        const ids = new Set();
        for (const work of works) {
            if (!work || typeof work !== 'object' || Array.isArray(work) || typeof work.id !== 'string' || !work.id || work.id.length > 500 || ids.has(work.id)) throw new Error('作品标识缺失或重复');
            ids.add(work.id);
            const field = mode === 'story' ? 'conversations' : 'messages';
            if (!Array.isArray(work[field])) throw new Error('作品消息格式无效');
            for (const message of work[field]) {
                if (!message || typeof message !== 'object' || typeof message.content !== 'string' || !['user', 'assistant', 'system'].includes(message.role)) throw new Error('消息内容或角色格式无效');
            }
            if (work.name !== undefined && typeof work.name !== 'string') throw new Error('作品名称格式无效');
            if (work.worldBook !== undefined && (!work.worldBook || typeof work.worldBook !== 'object' || Array.isArray(work.worldBook))) throw new Error('世界书格式无效');
        }
    }

    function validateBackup(backup) {
        const value = cleanTree(backup);
        if (value.format !== FORMAT || value.version !== 1) throw new Error('不是受支持的星光完整备份');
        if (!['all', 'story', 'room'].includes(value.scope)) throw new Error('备份范围无效');
        if (!value.state || typeof value.state !== 'object' || Array.isArray(value.state)) throw new Error('备份缺少作品数据');
        validateWorks(value.state.agents, 'story');
        validateWorks(value.state.rooms, 'room');
        if (!Array.isArray(value.state.styleProfiles)) throw new Error('文风资料格式无效');
        const styles = new Set();
        for (const profile of value.state.styleProfiles) {
            if (!profile || typeof profile.id !== 'string' || !profile.id || styles.has(profile.id)) throw new Error('文风标识缺失或重复');
            styles.add(profile.id);
        }
        if (value.scope === 'story' && (value.state.agents.length !== 1 || value.state.rooms.length)) throw new Error('单剧情备份范围不一致');
        if (value.scope === 'room' && (value.state.rooms.length !== 1 || value.state.agents.length)) throw new Error('单房间备份范围不一致');
        return value;
    }

    function createBackup(state, options = {}) {
        const scope = options.mode === 'story' || options.mode === 'room' ? options.mode : 'all';
        let data;
        if (scope === 'all') data = cleanTree(state);
        else {
            const field = scope === 'story' ? 'agents' : 'rooms';
            const work = (state[field] || []).find(item => item.id === options.id);
            if (!work) throw new Error('未找到要导出的作品');
            data = { agents: [], rooms: [], styleProfiles: [] };
            data[field] = [cleanTree(work)];
            const styleIds = new Set();
            function collectStyleIds(value) {
                if (!value || typeof value !== 'object') return;
                if (typeof value.sourceProfileId === 'string') styleIds.add(value.sourceProfileId);
                for (const item of Object.values(value)) collectStyleIds(item);
            }
            collectStyleIds(work);
            data.styleProfiles = cleanTree((state.styleProfiles || []).filter(profile => styleIds.has(profile.id)));
        }
        data.agents ||= [];
        data.rooms ||= [];
        data.styleProfiles ||= [];
        const backup = validateBackup({ format: FORMAT, version: 1, scope, createdAt: new Date().toISOString(), appVersion: options.appVersion || '2.3.1', state: data });
        if (byteLength(JSON.stringify(backup)) > (options.maxBytes || MAX_BACKUP_BYTES)) throw new Error('备份超过 256 MB，请按作品分别导出');
        return backup;
    }

    function parseBackup(text, options = {}) {
        if (typeof text !== 'string') throw new Error('请选择 JSON 备份文件');
        const maxBytes = options.maxBytes || MAX_BACKUP_BYTES;
        if (text.length > maxBytes || byteLength(text) > maxBytes) throw new Error('备份文件超过允许大小');
        let data;
        try { data = JSON.parse(text); } catch (error) { throw new Error('备份不是有效的 JSON 文件'); }
        return validateBackup(data);
    }

    function summarizeBackup(backup) {
        const state = backup.state;
        const works = [...state.agents, ...state.rooms];
        let facts = 0;
        const images = new Set();
        function scan(value, key) {
            if (typeof value === 'string' && /^data:image\//i.test(value)) { images.add(value); return; }
            if (!value || typeof value !== 'object') return;
            if (key === 'facts' && Array.isArray(value)) facts += value.length;
            for (const [name, item] of Object.entries(value)) {
                if (name !== 'revisionHistory') scan(item, name);
            }
        }
        scan(state);
        return {
            stories: state.agents.length, rooms: state.rooms.length,
            messages: works.reduce((count, work) => count + (work.conversations || work.messages || []).length, 0),
            facts, images: images.size, styles: state.styleProfiles.length,
            bytes: byteLength(JSON.stringify(backup)),
        };
    }

    function planImport(current, input, options = {}) {
        const backup = validateBackup(input);
        const strategy = options.strategy || 'copy';
        if (!['copy', 'replace'].includes(strategy)) throw new Error('请选择新增副本或替换指定作品');
        const importedWorks = [...backup.state.agents, ...backup.state.rooms];
        const importedMode = backup.state.agents.length ? 'story' : 'room';
        if (strategy === 'replace') {
            if (importedWorks.length !== 1) throw new Error('替换时备份必须只包含一个作品');
            if (options.targetMode !== importedMode) throw new Error('只能替换相同模式的作品');
            const field = importedMode === 'story' ? 'agents' : 'rooms';
            if (!(current[field] || []).some(work => work.id === options.targetId)) throw new Error('要替换的作品不存在');
        }
        // Preserve this device's credentials and active requests' source objects.
        // The UI must persist this independent candidate before adopting it.
        const next = { ...current, agents: [...(current.agents || [])], rooms: [...(current.rooms || [])], styleProfiles: [...(current.styleProfiles || [])] };
        const usedStyleIds = new Set(next.styleProfiles.map(profile => profile.id));
        const styleMap = new Map();
        for (const original of backup.state.styleProfiles) {
            const matching = next.styleProfiles.find(profile => profile.id === original.id && JSON.stringify(cleanTree(profile)) === JSON.stringify(original));
            if (matching) { styleMap.set(original.id, matching.id); continue; }
            const profile = clone(original);
            let id = profile.id;
            while (usedStyleIds.has(id)) id = makeId('style_import');
            profile.id = id;
            usedStyleIds.add(id);
            styleMap.set(original.id, id);
            next.styleProfiles.push(profile);
        }
        function repairStyles(value) {
            if (!value || typeof value !== 'object') return;
            if (typeof value.sourceProfileId === 'string') {
                // Applied factors remain a snapshot even if its library source
                // was deleted before export; don't attach it to an unrelated ID.
                value.sourceProfileId = styleMap.get(value.sourceProfileId) || '';
            }
            for (const child of Object.values(value)) repairStyles(child);
        }
        const added = [];
        for (const [mode, field] of [['story', 'agents'], ['room', 'rooms']]) {
            const used = new Set(next[field].map(work => work.id));
            for (const original of backup.state[field]) {
                const work = clone(original);
                repairStyles(work);
                if (strategy === 'replace') {
                    work.id = options.targetId;
                    const existing = next[field].find(item => item.id === work.id);
                    const recovery = clone(existing);
                    recovery.id = makeId(`${mode}_recovery`);
                    recovery.name = `${existing.name || '作品'}（替换前备份）`;
                    next[field].push(recovery);
                    next[field] = next[field].map(existing => existing.id === work.id ? work : existing);
                } else {
                    let id = makeId(mode === 'story' ? 'story_import' : 'room_import');
                    while (used.has(id)) id = makeId(`${mode}_import`);
                    work.id = id;
                    work.name = `${work.name || (mode === 'story' ? '剧情' : '房间')}（导入）`;
                    next[field].push(work);
                    used.add(id);
                }
                added.push({ mode, id: work.id, name: work.name });
            }
        }
        // A full archive can restore preferences deliberately. By default it
        // adds works without changing this installation's model/theme/settings.
        if (options.restoreSettings && backup.scope === 'all') {
            const excluded = new Set(['agents', 'rooms', 'styleProfiles', 'currentAgentId', 'currentRoomId', 'activeMode', 'apiKey', 'apiKeys']);
            for (const [key, value] of Object.entries(backup.state)) if (!excluded.has(key)) next[key] = clone(value);
        }
        next.updatedAt = Date.now();
        return { state: next, summary: { ...summarizeBackup(backup), strategy, works: added } };
    }

    function revisionSnapshot(work, mode) {
        const snapshot = {};
        for (const field of fieldsFor(mode)) if (work[field] !== undefined) snapshot[field] = work[field];
        // Settings history deliberately omits messages and image data. Restore
        // reuses matching current character images instead of duplicating them.
        return cleanTree(snapshot, { omitImages: true });
    }

    function normalizeRevisions(value) {
        return (Array.isArray(value) ? value : []).filter(item => item && typeof item.id === 'string' && ['story', 'room'].includes(item.mode) && item.snapshot && typeof item.snapshot === 'object')
            .slice(-MAX_REVISIONS).map(item => ({ id: item.id, mode: item.mode, label: String(item.label || '设定修改').slice(0, 100), createdAt: Number(item.createdAt) || 0, source:item.source && Number.isInteger(item.source.count) && item.source.count>=0 ? {count:item.source.count,fingerprint:String(item.source.fingerprint||'')}:null, snapshot: cleanTree(item.snapshot, { omitImages: true }) }));
    }

    function messageSource(work,mode,count) {
        const messages=work[mode==='room'?'messages':'conversations']||[];
        const size=count===undefined?messages.length:Math.min(count,messages.length);
        let first=2166136261,second=5381;
        for(let i=0;i<size;i++){
            const value=JSON.stringify([messages[i].role,messages[i].speakerId||'',messages[i].content]);
            for(let n=0;n<value.length;n++){const code=value.charCodeAt(n);first=Math.imul(first^code,16777619);second=Math.imul(second,33)^code;}
        }
        return {count:size,fingerprint:(first>>>0).toString(16)+':'+(second>>>0).toString(16)};
    }

    function captureRevision(work, options = {}) {
        const mode = options.mode === 'room' ? 'room' : 'story';
        const history = normalizeRevisions(work.revisionHistory);
        const snapshot = revisionSnapshot(work, mode);
        const source=messageSource(work,mode);
        if (history.length && JSON.stringify(history[history.length - 1].snapshot) === JSON.stringify(snapshot) && JSON.stringify(history[history.length-1].source)===JSON.stringify(source)) return { ...work, revisionHistory: history };
        const limit = Math.min(MAX_REVISIONS, Math.max(1, Number(options.limit) || MAX_REVISIONS));
        history.push({ id: makeId('revision'), mode, label: String(options.label || '修改前').slice(0, 100), createdAt: Date.now(), source, snapshot });
        return { ...work, revisionHistory: history.slice(-limit) };
    }

    function restoreRevision(work, revisionId) {
        const history = normalizeRevisions(work.revisionHistory);
        const revision = history.find(item => item.id === revisionId);
        if (!revision) throw new Error('未找到这条设定历史');
        const captured = captureRevision(work, { mode: revision.mode, label: '恢复前' });
        const restored = { ...captured };
        function keepImages(snapshot, current) {
            if (Array.isArray(snapshot)) return snapshot.map((item, index) => keepImages(item, Array.isArray(current) ? (item?.id ? current.find(value => value?.id === item.id) : current[index]) : undefined));
            if (!snapshot || typeof snapshot !== 'object') return snapshot;
            const result = { ...snapshot };
            for (const key of MEDIA_KEYS) if (current?.[key]) result[key] = current[key];
            for (const key of Object.keys(snapshot)) result[key] = keepImages(snapshot[key], current?.[key]);
            return result;
        }
        for (const field of fieldsFor(revision.mode)) {
            if(['memory','sharedMemory','characterMemories'].includes(field)){
                const source=revision.source;
                if(!source || JSON.stringify(messageSource(work,revision.mode,source.count))!==JSON.stringify(source))continue;
            }
            if (revision.snapshot[field] === undefined) delete restored[field];
            else restored[field] = keepImages(clone(revision.snapshot[field]), work[field]);
        }
        if(revision.mode==='room' && restored.intimacy && work.intimacy){
            for(const key of ['value','recentDeltas','lastReason']) if(work.intimacy[key]!==undefined)restored.intimacy[key]=clone(work.intimacy[key]);
        }
        restored.updatedAt = Date.now();
        return restored;
    }

    return { FORMAT, MAX_BACKUP_BYTES, MAX_REVISIONS, createBackup, parseBackup, validateBackup, summarizeBackup, planImport, captureRevision, restoreRevision, normalizeRevisions, messageSource };
});
