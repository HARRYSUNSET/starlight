(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StarlightVoice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // 活人化引擎：只控制「这一轮怎么写」，不审查、不删改内容。
    // 所有输出都是静态规则文本，绝不携带用户原文、历史或记忆。

    const asString = (value, fallback = '') => (typeof value === 'string' ? value : fallback);

    // 许可卡全部是「允许」，不是「禁令」：它只把某一轮允许的写法放宽一格，
    // 让轮与轮之间的节律不一样——活人的不均匀正来自这里。
    const CARDS = Object.freeze([
        '这一轮可以只写一句话，甚至只写一个动作。不必把每轮都写成完整段落。',
        '角色可以误解用户的一个词，或者没听清、听岔了；发现误会后不必立刻解释清楚。',
        '这一轮允许角色没接住话，或者故意不回答，只做一个与话题无关的小动作。',
        '这一轮可以不用任何比喻、排比或金句，只写最朴素的事实和动作。',
        '角色正在做一件小事（喝水、找钥匙、看手机），回应因此被打断或延迟。',
        '这一轮允许话说到一半停下，被环境打断，或者由别人接走话头。',
        '这一轮只写台词和必要的小动作，不写心理活动，不替情绪下结论。',
        '角色可以答非所问，把话题轻轻带偏，不解释为什么。',
        '这一轮角色可以主动问一个和当前话题无关的小问题，然后不再追问。',
        '这一轮允许用否定、反问或半句话表达，不追求把意思说完整。',
        '这一轮让情绪只通过一个具体动作露出（如把杯子转了半圈），不直接说出情绪词。',
        '这一轮可以写重复、结巴或临时改口，说话不必一次成型。',
    ]);

    function hashSeed(value) {
        let hash = 2166136261;
        const text = asString(value);
        for (let index = 0; index < text.length; index += 1) {
            hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
        }
        return hash >>> 0;
    }

    // 确定性抽卡：同一作品、同一轮次永远抽到同一张卡；约每三轮空一轮，
    // 保证节奏不均匀，也让测试可复现。不依赖 Date 或随机数。
    function permissionCard(turnIndex, seed = '') {
        const index = Number.isFinite(Number(turnIndex)) ? Math.max(0, Math.floor(Number(turnIndex))) : 0;
        if (index % 3 === 2) return { text: '', applied: false };
        const offset = hashSeed(seed) % CARDS.length;
        return { text: CARDS[(index + offset) % CARDS.length], applied: true };
    }

    function lengthGuidance(userText) {
        const visibleLength = asString(userText).replace(/\s/g, '').length;
        if (visibleLength <= 12) return '本轮非常短：一到两句即可，可以只回一句话或一个动作，不要为了凑长度补内容。';
        if (visibleLength <= 40) return '本轮偏短：一个短段落以内；普通接话不必写全动作、台词、心理三件套。';
        if (visibleLength <= 120) return '本轮中等：一到两个自然段落，按信息量取舍；没有新信息就写短。';
        return '本轮较长：按实际信息量自然展开，段长随节奏变化；不写总结段。';
    }

    const STORY_BEAT = '本轮只推进一拍：一个动作，或一句台词，或一个反应。不要在本轮把事件写完整；允许话没说完、允许被打断、允许只回应其中一部分、允许不回应。不写段尾总结或升华，不替情绪作解释。';
    const ROOM_BEAT = '本轮只写这一拍的反应：可以只回半句话，可以不回答而只做一个动作；不替本轮事件收尾，不解释情绪。';

    // 组合后的整块提醒。只包含静态规则，可安全拼在最后一条用户消息之前。
    function turnBlock(options = {}) {
        const room = options.room === true;
        const parts = [
            '【本轮节奏与篇幅】',
            lengthGuidance(options.lastUserText),
            '【单拍推进】',
            room ? ROOM_BEAT : STORY_BEAT,
        ];
        const card = permissionCard(options.turnIndex, options.seed);
        if (card.applied) parts.push('【本轮许可】', card.text);
        return parts.join('\n');
    }

    function sceneAnchor(text) {
        const scene = asString(text).trim();
        if (!scene) return '';
        return '【当前场景｜每轮自动带入】\n' + scene;
    }

    // ---------- AI 腔体检：纯本地正则，不调用接口，不修改、不审查正文 ----------

    const PATTERNS = Object.freeze([
        { type: '模板转折', pattern: /不是[^。！？\n]{1,12}而是/g },
        { type: '模板转折', pattern: /与其说[^。！？\n]{1,16}不如说/g },
        { type: '套语·嘴角', pattern: /嘴角[^。！？\n]{0,8}(勾起|上扬|弯起|微扬)/g },
        { type: '套语·眼神', pattern: /眼神[^。！？\n]{0,10}(复杂|深邃|闪过一丝|暗了暗|一沉|一凝|微微)/g },
        { type: '套语·空气', pattern: /空气[^。！？\n]{0,8}(凝固|安静|仿佛静止)/g },
        { type: '套语·深吸气', pattern: /(深深|轻轻)地?吸了?一口(气|凉气)/g },
        { type: '套语·情绪泛起', pattern: /(心底|心中|心里)[^。！？\n]{0,8}(泛起|涌起|升起|一软|一动)/g },
        { type: '模板·下意识', pattern: /下意识(地)?/g },
        { type: '模板·不由得', pattern: /不由得|不禁(?!问)/g },
        { type: '段尾总结', pattern: /(这一刻|那一刻|此时|从此)[^。！？\n]{0,20}(明白|释然|懂得|知道|意识到|觉得)/g },
    ]);

    const DENSITY_RULES = Object.freeze([
        { type: '仿佛/似乎密度', pattern: /仿佛|似乎|像是/g, threshold: 2 },
        { type: '省略号密度', pattern: /……/g, threshold: 2 },
        { type: '破折号密度', pattern: /——/g, threshold: 3 },
    ]);

    function detectTells(text) {
        const source = asString(text);
        if (!source) return [];
        const found = [];
        const seen = new Set();
        for (const rule of PATTERNS) {
            const match = rule.pattern.exec(source);
            if (!match) continue;
            if (seen.has(rule.type)) continue;
            seen.add(rule.type);
            found.push({ type: rule.type, sample: match[0].slice(0, 40) });
            rule.pattern.lastIndex = 0;
        }
        for (const rule of DENSITY_RULES) {
            const matches = source.match(rule.pattern) || [];
            if (matches.length > rule.threshold) {
                found.push({ type: rule.type, sample: `${matches.length} 处` });
            }
        }
        return found;
    }

    function tellReport(text) {
        const items = detectTells(text);
        if (!items.length) return { count: 0, items, summary: '未发现常见 AI 腔套语。' };
        const names = [...new Set(items.map(item => item.type))];
        return { count: items.length, items, summary: `发现 ${items.length} 处常见 AI 腔（${names.join('、')}）。` };
    }

    function cleanupHint(items) {
        const list = (Array.isArray(items) ? items : []).filter(Boolean);
        if (!list.length) return '';
        const names = [...new Set(list.map(item => item.type))];
        return `请只调整表达，不改事实与剧情：减少「${names.join('」「')}」这类模板化表达，让句子像真实对话。`;
    }

    return {
        CARDS,
        hashSeed,
        permissionCard,
        lengthGuidance,
        STORY_BEAT,
        ROOM_BEAT,
        turnBlock,
        sceneAnchor,
        detectTells,
        tellReport,
        cleanupHint,
    };
});
