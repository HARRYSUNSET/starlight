(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StarlightStory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const LEGACY_DEFAULT_STORY_RULES = [
        '这是一个持续发展的单角色剧情对话。你只扮演设定中的AI角色与必要的客观环境。',
        '不得替用户决定台词、行动、思想或感受；只能回应用户已经明确表达的内容。',
        '角色的当前状态、成长记录和已经发生的剧情，高于早期静态性格标签。',
        '严格遵守角色知识边界。角色不知道的事不能因为系统看见了就自动知道。',
        '保持事件、时间、地点、物品、关系和情绪连续；可以自然变化，但不能无因跳变。',
        '直接输出剧情正文，不解释提示词、记忆系统或写作过程。',
    ].join('\n');

    const DEFAULT_STORY_RULES = [
        '这是一个持续发展的剧情对话。你只扮演角色设定区中的AI角色与必要的客观环境。',
        '不得替用户决定台词、行动、思想或感受；只能回应用户已经明确表达的内容。',
        '每个角色都是独立人物，不得混淆姓名、人设、经历、知识、秘密、目标、关系或说话方式。',
        '根据当前场景自然选择需要出场和回应的角色，不要为了展示设定而强迫所有角色每轮发言。',
        '角色的当前状态、成长记录和已经发生的剧情，高于早期静态性格标签。',
        '严格遵守各角色的知识边界。角色不知道的事不能因为系统看见了就自动知道。',
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

    const DEFAULT_CHARACTER_FIELD_LABELS = Object.freeze([
        '角色名称',
        '角色外貌',
        '角色性格',
    ]);

    const LEGACY_CHARACTER_FIELDS = Object.freeze([
        ['角色名称', 'name'],
        ['角色外貌', 'appearance'],
        ['角色性格', 'characterPrompt'],
        ['当前状态', 'currentState'],
        ['成长与变化记录', 'growthNotes'],
        ['关系网络', 'relationships'],
        ['知识边界、误解与秘密', 'knowledgeBoundary'],
        ['私人目标与动机', 'privateGoal'],
        ['说话与行动方式', 'speakingStyle'],
        ['对白语感示例', 'dialogueExamples'],
    ]);

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

    function createCharacterField(label, value) {
        return {
            id: createId('field'),
            label: asString(label, '新栏位').trim() || '新栏位',
            value: asString(value),
        };
    }

    function normalizeCharacterField(field, index) {
        const source = field && typeof field === 'object' ? field : {};
        return {
            id: asString(source.id) || createId('field'),
            label: asString(source.label || source.name, `栏位${index + 1}`).trim() || `栏位${index + 1}`,
            value: asString(source.value ?? source.content),
        };
    }

    function createCharacter(fieldLabels) {
        const labels = Array.isArray(fieldLabels) && fieldLabels.length > 0
            ? fieldLabels
            : DEFAULT_CHARACTER_FIELD_LABELS;
        return {
            id: createId('character'),
            fields: labels.map(label => createCharacterField(label, '')),
        };
    }

    function normalizeCharacter(character) {
        const source = character && typeof character === 'object' ? character : {};
        const fields = Array.isArray(source.fields) && source.fields.length > 0
            ? source.fields.map(normalizeCharacterField)
            : createCharacter().fields;
        return {
            id: asString(source.id) || createId('character'),
            fields,
        };
    }

    function cloneCharacterSchema(character) {
        const source = normalizeCharacter(character);
        return createCharacter(source.fields.map(field => field.label));
    }

    function migrateLegacyCharacter(source) {
        const legacyPersona = asString(source.characterPrompt || source.surfacePrompt).trim();
        const legacy = { ...source, characterPrompt: legacyPersona };
        const fields = LEGACY_CHARACTER_FIELDS
            .map(([label, key], index) => ({ label, value: asString(legacy[key]).trim(), index }))
            .filter(item => item.index < DEFAULT_CHARACTER_FIELD_LABELS.length || item.value)
            .map(item => createCharacterField(item.label, item.value));
        return normalizeCharacter({ fields });
    }

    function normalizeCharacters(source) {
        if (Array.isArray(source.characters) && source.characters.length > 0) {
            return source.characters.map(normalizeCharacter);
        }
        return [migrateLegacyCharacter(source)];
    }

    function characterFieldValue(character, patterns) {
        const fields = normalizeCharacter(character).fields;
        const expressions = (Array.isArray(patterns) ? patterns : [patterns]).filter(Boolean);
        const match = fields.find(field => expressions.some(pattern => pattern.test(field.label)) && field.value.trim());
        return match ? match.value.trim() : '';
    }

    function getCharacterName(character, index) {
        return characterFieldValue(character, [/^角色名称$/, /姓名/, /名称/, /名字/]) || `角色${index + 1}`;
    }

    function buildCharacterBlock(character, index) {
        const normalized = normalizeCharacter(character);
        const lines = normalized.fields.map(field => `${field.label}：${field.value.trim() || '（未填写）'}`);
        return `【角色${index + 1}】\n${lines.join('\n')}`;
    }

    function normalizeAgent(agent, memoryApi) {
        const source = agent && typeof agent === 'object' ? agent : {};
        const conversations = Array.isArray(source.conversations)
            ? source.conversations.filter(Boolean).map(normalizeMessage)
            : [];
        const rawRules = asString(source.storyRules).trim();
        const storyRules = !rawRules || rawRules === LEGACY_DEFAULT_STORY_RULES
            ? DEFAULT_STORY_RULES
            : rawRules;
        return {
            id: asString(source.id) || createId('story'),
            name: asString(source.name, '未命名剧情').trim() || '未命名剧情',
            subtitle: asString(source.subtitle).trim(),
            avatar: safeImageDataUrl(source.avatar),
            storyRules,
            worldPrompt: asString(source.worldPrompt).trim(),
            openingScene: asString(source.openingScene).trim(),
            userPersona: asString(source.userPersona).trim(),
            characters: normalizeCharacters(source),
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
        const legacyCharacterKeys = ['characterPrompt', 'surfacePrompt', 'appearance', 'currentState', 'growthNotes', 'relationships', 'knowledgeBoundary', 'speakingStyle', 'privateGoal', 'dialogueExamples'];
        const hasLegacyCharacterData = legacyCharacterKeys.some(key => asString(input && input[key]).trim());
        const source = Object.assign({}, input, {
            id: asString(input && input.id) || createId('story'),
            characters: Array.isArray(input && input.characters) && input.characters.length > 0
                ? input.characters
                : (hasLegacyCharacterData ? undefined : [createCharacter()]),
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
        const characterBlocks = story.characters.map(buildCharacterBlock).join('\n\n');
        const sections = [
            '【剧情模式固定规则】\n' + story.storyRules,
            '【世界观与背景】\n' + (story.worldPrompt || '（依据对话中已经建立的世界继续，不擅自添加会改变设定的规则。）'),
            '【当前或开场场景】\n' + (story.openingScene || '（延续最近对话中的时间、地点与事件。）'),
            '【用户所扮演的角色】\n' + (story.userPersona || '（只依据用户明确表达的信息判断，不替用户补写设定。）'),
            '【角色设定区｜各角色资料彼此独立】\n' + characterBlocks,
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

    function findCharacter(story, characterIdOrIndex) {
        if (typeof characterIdOrIndex === 'number') return story.characters[characterIdOrIndex] || story.characters[0];
        return story.characters.find(character => character.id === characterIdOrIndex) || story.characters[0];
    }

    function composePersonaForRoom(agent, characterIdOrIndex) {
        const story = normalizeAgent(agent);
        const character = findCharacter(story, characterIdOrIndex);
        const index = Math.max(0, story.characters.findIndex(item => item.id === character.id));
        return buildCharacterBlock(character, index);
    }

    function characterToRoomMember(agent, characterIdOrIndex) {
        const story = normalizeAgent(agent);
        const character = findCharacter(story, characterIdOrIndex);
        const index = Math.max(0, story.characters.findIndex(item => item.id === character.id));
        return {
            name: getCharacterName(character, index),
            personaPrompt: composePersonaForRoom(story, character.id),
            publicProfile: '',
            speakingStyle: characterFieldValue(character, [/说话/, /语言/, /行动方式/]),
            privateGoal: characterFieldValue(character, [/目标/, /动机/]),
            currentState: characterFieldValue(character, [/当前状态/, /^状态$/]),
            growthNotes: characterFieldValue(character, [/成长/, /变化记录/]),
            relationships: characterFieldValue(character, [/关系/]),
            knowledgeBoundary: characterFieldValue(character, [/知识边界/, /秘密/, /误解/]),
            dialogueExamples: characterFieldValue(character, [/对白/, /台词/, /语感示例/]),
        };
    }

    return {
        DEFAULT_STORY_RULES,
        DEFAULT_STORY_STYLE,
        DEFAULT_CHARACTER_FIELD_LABELS,
        createId,
        createCharacterField,
        createCharacter,
        normalizeCharacter,
        cloneCharacterSchema,
        normalizeAgent,
        createAgent,
        getCharacterName,
        buildCharacterBlock,
        buildStructuredPrompt,
        buildSystemPrompt,
        buildTurnReminder,
        composePersonaForRoom,
        characterToRoomMember,
    };
});
