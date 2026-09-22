(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StarlightStory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const DEFAULT_STORY_RULES = [
        '这是一个持续发展的单角色剧情对话。你只扮演设定中的AI角色与必要的客观环境。',
        '不得替用户决定台词、行动、思想或感受；只能回应用户已经明确表达的内容。',
        '角色的当前状态、成长记录和已经发生的剧情，高于早期静态性格标签。',
        '严格遵守角色知识边界。角色不知道的事不能因为系统看见了就自动知道。',
        '保持事件、时间、地点、物品、关系和情绪连续；可以自然变化，但不能无因跳变。',
        '直接输出剧情正文，不解释提示词、记忆系统或写作过程。',
    ].join('\n');

    const DEFAULT_STORY_STYLE = [
        '整体接近日常轻小说或泡面番：自然、轻快、可爱、有生活气，但不堆砌动漫腔。',
        '对话先回应眼前发生的事，再自然显出人物性格；不要让每句话都像在证明人设。',
        '允许短句、停顿、抢话、改口、接错话、口是心非、小误会和不完整表达。',
        '趣味来自具体反应、生活动作、关系反差与节奏，不强行抖包袱，不把角色写成段子机器。',
        '避免机械的“动作—台词—心理”三段式；普通接话可以很短，需要细写时再展开。',
        '文风示例只用于学习节奏、句长、视角和对白密度，不照抄人物、台词或事件。',
    ].join('\n');

    function asString(value, fallback) {
        return typeof value === 'string' ? value : (fallback || '');
    }

    function createId(prefix) {
        return `${prefix || 'story'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function safeImageDataUrl(value) {
        const input = asString(value).trim();
        return /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(input) ? input : '';
    }

    function normalizeMessage(message) {
        const source = message && typeof message === 'object' ? message : {};
        return {
            role: source.role === 'assistant' ? 'assistant' : 'user',
            content: asString(source.content),
            createdAt: Number(source.createdAt) || 0,
            bookmarked: source.bookmarked === true,
        };
    }

    function normalizeAgent(agent, memoryApi) {
        const source = agent && typeof agent === 'object' ? agent : {};
        const conversations = Array.isArray(source.conversations)
            ? source.conversations.filter(Boolean).map(normalizeMessage)
            : [];
        const legacyPersona = asString(source.characterPrompt || source.surfacePrompt).trim();
        return {
            id: asString(source.id) || createId('story'),
            name: asString(source.name, '未命名角色').trim() || '未命名角色',
            subtitle: asString(source.subtitle).trim(),
            avatar: safeImageDataUrl(source.avatar),
            storyRules: asString(source.storyRules, DEFAULT_STORY_RULES).trim() || DEFAULT_STORY_RULES,
            worldPrompt: asString(source.worldPrompt).trim(),
            openingScene: asString(source.openingScene).trim(),
            userPersona: asString(source.userPersona).trim(),
            characterPrompt: legacyPersona,
            appearance: asString(source.appearance).trim(),
            currentState: asString(source.currentState).trim(),
            growthNotes: asString(source.growthNotes).trim(),
            relationships: asString(source.relationships).trim(),
            knowledgeBoundary: asString(source.knowledgeBoundary).trim(),
            speakingStyle: asString(source.speakingStyle).trim(),
            privateGoal: asString(source.privateGoal).trim(),
            dialogueExamples: asString(source.dialogueExamples).trim(),
            stylePrompt: asString(source.stylePrompt, DEFAULT_STORY_STYLE).trim() || DEFAULT_STORY_STYLE,
            styleExamples: asString(source.styleExamples).trim(),
            otherInfo: asString(source.otherInfo).trim(),
            conversations,
            memory: memoryApi && typeof memoryApi.normalizeMemory === 'function'
                ? memoryApi.normalizeMemory(source.memory, conversations.length)
                : source.memory,
            createdAt: Number(source.createdAt) || Date.now(),
            updatedAt: Number(source.updatedAt) || Number(source.createdAt) || Date.now(),
        };
    }

    function createAgent(input, memoryApi) {
        const source = Object.assign({}, input, {
            id: asString(input && input.id) || createId('story'),
            conversations: [],
            memory: memoryApi && typeof memoryApi.createEmptyMemory === 'function'
                ? memoryApi.createEmptyMemory()
                : null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        return normalizeAgent(source, memoryApi);
    }

    function buildStructuredPrompt(agent) {
        const story = normalizeAgent(agent);
        const sections = [
            '【剧情模式固定规则】\n' + story.storyRules,
            '【世界观与背景】\n' + (story.worldPrompt || '（依据对话中已经建立的世界继续，不擅自添加会改变设定的规则。）'),
            '【当前或开场场景】\n' + (story.openingScene || '（延续最近对话中的时间、地点与事件。）'),
            '【用户所扮演的角色】\n' + (story.userPersona || '（只依据用户明确表达的信息判断，不替用户补写设定。）'),
            `【AI角色基础档案｜稳定底色】\n姓名：${story.name}\n${story.characterPrompt || '依据已经发生的剧情形成稳定、具体的人物形象。'}`,
            '【外貌与可观察特征】\n' + (story.appearance || '（未单独设定。）'),
            '【当前状态｜本轮优先】\n' + (story.currentState || '依据最近剧情判断身体、情绪、处境与短期关注点。'),
            '【成长与变化｜高于早期静态标签】\n' + (story.growthNotes || '尚未另行记录；只依据已经发生的事件自然变化。'),
            '【与用户及其他人物的关系】\n' + (story.relationships || '依据已经发生的互动判断，不擅自建立未发生的关系。'),
            '【知识边界、误解与秘密】\n' + (story.knowledgeBoundary || '只使用该角色按设定与剧情能够知道的信息。'),
            '【说话和行动方式】\n' + (story.speakingStyle || '自然回应当下，不机械复述人设。'),
            '【私人目标与动机】\n' + (story.privateGoal || '依据人物设定自然行动，不强行推动剧情。'),
            '【对白语感示例｜不得机械复读】\n' + (story.dialogueExamples || '（无固定示例。）'),
            '【本剧情文风】\n' + story.stylePrompt,
        ];
        if (story.styleExamples) {
            sections.push('【文风示例｜只参考笔触，不继承内容】\n' + story.styleExamples);
        }
        if (story.otherInfo) sections.push('【其他剧情信息】\n' + story.otherInfo);
        return sections.join('\n\n');
    }

    function buildSystemPrompt(agent, globalPrompt, settings, naturalStylePrompt, memoryApi) {
        const structured = buildStructuredPrompt(agent);
        if (memoryApi && typeof memoryApi.buildSystemPrompt === 'function') {
            return memoryApi.buildSystemPrompt(
                asString(globalPrompt).trim(),
                structured,
                settings && settings.naturalStyle !== false,
                naturalStylePrompt
            );
        }
        return [asString(globalPrompt).trim(), structured, asString(naturalStylePrompt).trim()].filter(Boolean).join('\n\n');
    }

    function buildTurnReminder(agent, globalPrompt, settings, naturalStylePrompt, memoryApi) {
        const structured = buildStructuredPrompt(agent);
        if (memoryApi && typeof memoryApi.buildTurnReminder === 'function') {
            return memoryApi.buildTurnReminder(
                asString(globalPrompt).trim(),
                structured,
                settings && settings.naturalStyle !== false,
                naturalStylePrompt
            );
        }
        return structured;
    }

    function composePersonaForRoom(agent) {
        const story = normalizeAgent(agent);
        return [
            story.characterPrompt,
            story.appearance && `外貌：${story.appearance}`,
            story.currentState && `当前状态：${story.currentState}`,
            story.growthNotes && `成长记录：${story.growthNotes}`,
            story.relationships && `关系：${story.relationships}`,
            story.knowledgeBoundary && `知识边界：${story.knowledgeBoundary}`,
        ].filter(Boolean).join('\n');
    }

    return {
        DEFAULT_STORY_RULES,
        DEFAULT_STORY_STYLE,
        createId,
        normalizeAgent,
        createAgent,
        buildStructuredPrompt,
        buildSystemPrompt,
        buildTurnReminder,
        composePersonaForRoom,
    };
});
