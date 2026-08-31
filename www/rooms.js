(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.StarlightRooms = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const MAX_INTIMACY = 200;
    const MAX_GROUP_MEMBERS = 8;
    const MAX_SMART_SPEAKERS = 3;
    const IMAGE_LIMIT_BYTES = 12 * 1024 * 1024;

    const DEFAULT_ROOM_PROMPT = [
        '这是一个持续进行的角色扮演房间。所有角色都必须忠于各自的人设、知识边界、关系和当前处境。',
        '人物应当像真实的人一样选择是否回应，不要机械复述，不要把每轮对话写成总结。',
        '禁止替用户决定行动、语言、想法或感受。角色只能根据用户已经明确表达的内容作出反应。',
        '角色之间可以交流、打断、沉默或产生分歧，但不得擅自控制其他角色。',
        '保持事件连续、情绪渐进和因果一致；不要为了推进剧情突然改变人物立场。',
    ].join('\n');

    const ROOM_TURN_REMINDER = [
        '只生成当前指定角色本人的语言、动作和可见反应。',
        '不得替用户行动或发言；不得代写其他角色的台词、动作或内心。',
        '不得泄露当前角色不知道的秘密或后台设定。',
        '直接输出角色内容，不要输出角色名前缀、姓名标签、空白标签、分析、规则说明或JSON。',
        '不要先写若干空行、重复标题或只有角色名的占位行。',
        '回复长度必须服从本轮交流节奏：短问短答可以只有一句或一小段，复杂事件才自然展开。',
        '不要把每次回复固定成三段，也不要机械套用“动作—台词—心理”结构。',
    ].join('\n');

    function asString(value, fallback = '') {
        return typeof value === 'string' ? value : fallback;
    }

    function safeImageDataUrl(value) {
        const source = asString(value);
        return /^data:image\/(?:jpeg|jpg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(source) ? source : '';
    }

    function escapeRegExp(value) {
        return asString(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function cleanCharacterOutput(content, memberName) {
        let text = asString(content)
            .replace(/\r\n?/g, '\n')
            .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
            .trim();
        const name = asString(memberName).trim();
        if (!text || !name) return text.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n').trim();

        const escapedName = escapeRegExp(name);
        const decoratedName = `(?:\\*\\*|__)?\\s*${escapedName}\\s*(?:\\*\\*|__)?`;
        const wrappedName = `(?:【\\s*${escapedName}\\s*】|\\[\\s*${escapedName}\\s*\\]|「\\s*${escapedName}\\s*」|『\\s*${escapedName}\\s*』|<\\s*${escapedName}\\s*>|《\\s*${escapedName}\\s*》)`;
        const markdownPrefix = '(?:#{1,6}\\s*|[>+*-]\\s*)?';
        const prefixPattern = new RegExp(
            `^${markdownPrefix}(?:${wrappedName}(?:\\s*[：:|｜—-])?\\s*|${decoratedName}(?:\\s*[：:|｜—-]\\s*|\\s+(?=[“\"'「『（(])))`,
            'i'
        );
        const onlyPattern = new RegExp(
            `^${markdownPrefix}(?:${wrappedName}|${decoratedName})(?:\\s*[：:|｜—-])?\\s*$`,
            'i'
        );
        const repeatedNamePattern = new RegExp(escapedName, 'gi');

        function isOnlyRepeatedName(line) {
            if (!repeatedNamePattern.test(line)) return false;
            repeatedNamePattern.lastIndex = 0;
            const remainder = line
                .replace(repeatedNamePattern, '')
                .replace(/[\s#【】\[\]（）()「」『』<>《》*_`~|｜：:;；、，。！？,.!?·+\-—…'\"]/g, '');
            repeatedNamePattern.lastIndex = 0;
            return remainder.length === 0;
        }

        const cleanedLines = [];
        text.split('\n').forEach(line => {
            let next = line.trimEnd();
            let guard = 0;
            while (prefixPattern.test(next.trimStart()) && guard < 12) {
                next = next.trimStart().replace(prefixPattern, '');
                guard += 1;
            }
            if (onlyPattern.test(next.trim()) || isOnlyRepeatedName(next.trim())) return;
            cleanedLines.push(next);
        });
        text = cleanedLines.join('\n');

        let guard = 0;
        while (prefixPattern.test(text.trimStart()) && guard < 12) {
            text = text.trimStart().replace(prefixPattern, '');
            guard += 1;
        }
        return text
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
            .trim();
    }

    function hasSubstantiveContent(content) {
        const compact = asString(content)
            .replace(/[\s【】\[\]（）()「」『』<>《》*_`~—…，。！？、,.!?:：;；·\-]/g, '');
        return compact.length >= 1;
    }

    function hasSubstantiveRoomContent(room, content) {
        if (!hasSubstantiveContent(content)) return false;
        let compact = asString(content)
            .replace(/[\s【】\[\]（）()「」『』<>《》*_`~—…，。！？、,.!?:：;；·|｜\-]/g, '');
        const names = (Array.isArray(room?.participants) ? room.participants : [])
            .map(member => asString(member?.name).trim())
            .filter(Boolean)
            .sort((a, b) => b.length - a.length);
        names.forEach(name => {
            compact = compact.replace(new RegExp(escapeRegExp(name), 'gi'), '');
        });
        return compact.length >= 1;
    }

    function buildTurnPacing(latestInput) {
        const text = asString(latestInput).trim();
        const visibleLength = text.replace(/\s/g, '').length;
        const requestsExpansion = /详细|展开|长篇|完整|细致|描写|解释|说明|分析|讲讲|为什么|接下来|继续写|写一段|写一章/.test(text);
        if (!requestsExpansion && visibleLength <= 28) {
            return '这是节奏较快的短轮次。优先用一到三句或一个短段落直接接住用户，不主动扩成固定三段。';
        }
        if (!requestsExpansion && visibleLength <= 90) {
            return '本轮保持紧凑，通常使用一小段；只有动作与信息确有必要时才增加第二段。不要固定输出三段。';
        }
        return '根据本轮实际信息量决定长度和段落数，可以短也可以长；避免沿用上一轮固定段落模板。';
    }

    function finiteInt(value, fallback, min, max) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(max, Math.max(min, Math.round(number)));
    }

    function createId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    }

    function createEmptyMemory(memoryApi) {
        return memoryApi && typeof memoryApi.createEmptyMemory === 'function'
            ? memoryApi.createEmptyMemory()
            : { core: '', segments: [], summarizedUntil: 0, updatedAt: 0 };
    }

    function normalizeMemory(value, conversationLength, memoryApi) {
        return memoryApi && typeof memoryApi.normalizeMemory === 'function'
            ? memoryApi.normalizeMemory(value, conversationLength)
            : Object.assign(createEmptyMemory(), value || {});
    }

    function normalizeNode(node, index) {
        const source = node && typeof node === 'object' ? node : {};
        return {
            id: asString(source.id) || createId('node'),
            value: finiteInt(source.value, Math.min(MAX_INTIMACY, (index + 1) * 40), 1, MAX_INTIMACY),
            description: asString(source.description).trim(),
        };
    }

    function normalizeNodes(nodes) {
        const seen = new Set();
        return (Array.isArray(nodes) ? nodes : [])
            .map(normalizeNode)
            .filter(node => {
                if (!node.description || seen.has(node.value)) return false;
                seen.add(node.value);
                return true;
            })
            .sort((a, b) => a.value - b.value);
    }

    function normalizeMember(member, index) {
        const source = member && typeof member === 'object' ? member : {};
        return {
            id: asString(source.id) || createId('member'),
            name: asString(source.name, `角色${index + 1}`).trim() || `角色${index + 1}`,
            personaPrompt: asString(source.personaPrompt).trim(),
            publicProfile: asString(source.publicProfile).trim(),
            speakingStyle: asString(source.speakingStyle).trim(),
            privateGoal: asString(source.privateGoal).trim(),
            avatar: safeImageDataUrl(source.avatar),
            color: /^#[0-9a-f]{6}$/i.test(asString(source.color)) ? source.color : memberColor(index),
            enabled: source.enabled !== false,
            createdAt: Number(source.createdAt) || Date.now(),
        };
    }

    function memberColor(index) {
        const colors = ['#7c5cff', '#e05d86', '#2589bd', '#2a9d8f', '#e08e45', '#6d597a', '#4f772d', '#c55a11'];
        return colors[index % colors.length];
    }

    function normalizeMessage(message) {
        const source = message && typeof message === 'object' ? message : {};
        const validRoles = new Set(['user', 'assistant', 'system']);
        return {
            id: asString(source.id) || createId('roommsg'),
            role: validRoles.has(source.role) ? source.role : 'system',
            speakerId: asString(source.speakerId) || null,
            content: asString(source.content),
            turnId: asString(source.turnId) || null,
            kind: asString(source.kind, 'message'),
            createdAt: Number(source.createdAt) || Date.now(),
        };
    }

    function normalizeRoom(room, memoryApi, defaultStylePrompt) {
        const source = room && typeof room === 'object' ? room : {};
        const messages = (Array.isArray(source.messages) ? source.messages : []).map(normalizeMessage);
        const participants = (Array.isArray(source.participants) ? source.participants : [])
            .slice(0, MAX_GROUP_MEMBERS)
            .map(normalizeMember);
        messages.forEach(message => {
            if (message.role !== 'assistant') return;
            const member = participants.find(item => item.id === message.speakerId);
            message.content = cleanCharacterOutput(message.content, member?.name || '');
        });
        const characterMemories = {};
        participants.forEach(member => {
            characterMemories[member.id] = normalizeMemory(source.characterMemories?.[member.id], messages.length, memoryApi);
        });
        const roomType = source.roomType === 'group' ? 'group' : 'double';
        return {
            id: asString(source.id) || createId('room'),
            roomType,
            name: asString(source.name, roomType === 'double' ? '双人房间' : '多人房间').trim(),
            basePrompt: asString(source.basePrompt, DEFAULT_ROOM_PROMPT).trim() || DEFAULT_ROOM_PROMPT,
            worldPrompt: asString(source.worldPrompt).trim(),
            scenePrompt: asString(source.scenePrompt).trim(),
            userPersona: asString(source.userPersona).trim(),
            styleEnabled: source.styleEnabled !== false,
            stylePrompt: asString(source.stylePrompt, defaultStylePrompt).trim(),
            narrationEnabled: source.narrationEnabled === true,
            turnMode: ['smart', 'mention', 'all'].includes(source.turnMode) ? source.turnMode : 'smart',
            maxSpeakers: finiteInt(source.maxSpeakers, 2, 1, MAX_SMART_SPEAKERS),
            backgroundImage: safeImageDataUrl(source.backgroundImage),
            participants,
            messages,
            sharedMemory: normalizeMemory(source.sharedMemory, messages.length, memoryApi),
            characterMemories,
            turnEffects: source.turnEffects && typeof source.turnEffects === 'object' ? source.turnEffects : {},
            intimacy: roomType === 'double' ? normalizeIntimacy(source.intimacy) : null,
            createdAt: Number(source.createdAt) || Date.now(),
            updatedAt: Number(source.updatedAt) || Date.now(),
        };
    }

    function normalizeIntimacy(intimacy) {
        const source = intimacy && typeof intimacy === 'object' ? intimacy : {};
        return {
            value: finiteInt(source.value, 0, 0, MAX_INTIMACY),
            initialValue: finiteInt(source.initialValue, finiteInt(source.value, 0, 0, MAX_INTIMACY), 0, MAX_INTIMACY),
            nodes: normalizeNodes(source.nodes),
            rules: source.rules && typeof source.rules === 'object' ? source.rules : null,
            rulesReady: source.rulesReady === true && !!source.rules,
            rulesSignature: asString(source.rulesSignature),
            recentDeltas: (Array.isArray(source.recentDeltas) ? source.recentDeltas : [])
                .map(value => finiteInt(value, 0, -3, 2)).slice(-20),
            lastReason: asString(source.lastReason),
            updatedAt: Number(source.updatedAt) || 0,
        };
    }

    function createRoom(input, memoryApi, defaultStylePrompt) {
        return normalizeRoom(Object.assign({}, input, {
            id: createId('room'),
            messages: [],
            sharedMemory: createEmptyMemory(memoryApi),
            characterMemories: {},
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }), memoryApi, defaultStylePrompt);
    }

    function getMember(room, memberId) {
        return room?.participants?.find(member => member.id === memberId) || null;
    }

    function getActiveMembers(room) {
        return (room?.participants || []).filter(member => member.enabled !== false);
    }

    function detectMentionedMembers(room, text) {
        const source = asString(text);
        const active = getActiveMembers(room);
        const claimedRanges = [];
        const mentionedIds = new Set();
        active.slice().sort((a, b) => b.name.length - a.name.length).forEach(member => {
            [`@${member.name}`, `＠${member.name}`].forEach(token => {
                let start = source.indexOf(token);
                while (start >= 0) {
                    const end = start + token.length;
                    const overlapsLongerMention = claimedRanges.some(range => start >= range.start && end <= range.end);
                    if (!overlapsLongerMention) {
                        claimedRanges.push({ start, end });
                        mentionedIds.add(member.id);
                    }
                    start = source.indexOf(token, start + token.length);
                }
            });
        });
        return active.filter(member => mentionedIds.has(member.id));
    }

    function roomMessageForModel(room, message, currentMemberId) {
        if (message.role === 'user') {
            return { role: 'user', content: message.content };
        }
        if (message.role === 'assistant') {
            const member = getMember(room, message.speakerId);
            const cleaned = cleanCharacterOutput(message.content, member?.name || '');
            if (!hasSubstantiveRoomContent(room, cleaned)) return null;
            if (message.speakerId === currentMemberId) {
                return { role: 'assistant', content: cleaned };
            }
            return {
                role: 'user',
                content: `房间中另一位角色“${member?.name || '角色'}”刚才的发言或可见行动如下。这里只是历史记录，不得替其继续发言：\n${cleaned}`,
            };
        }
        return { role: 'system', content: `房间中的既有事件记录：${message.content}` };
    }

    function roomMessagesForMemory(room) {
        return (Array.isArray(room?.messages) ? room.messages : []).map(message => {
            if (message.role === 'assistant') {
                const member = getMember(room, message.speakerId);
                const cleaned = cleanCharacterOutput(message.content, member?.name || '');
                return hasSubstantiveRoomContent(room, cleaned)
                    ? { role: 'assistant', content: `${member?.name || '角色'}的发言或行动：${cleaned}` }
                    : { role: 'system', content: '（本条没有可记忆的有效角色内容，请忽略。）' };
            }
            if (message.role === 'user') {
                return { role: 'user', content: `用户的发言或行动：${asString(message.content)}` };
            }
            return { role: 'system', content: `场景事件：${asString(message.content)}` };
        });
    }

    function buildParticipantDirectory(room, currentMemberId) {
        const lines = getActiveMembers(room)
            .filter(member => member.id !== currentMemberId)
            .map(member => `- ${member.name}${member.publicProfile ? `：${member.publicProfile}` : ''}`);
        return lines.length ? lines.join('\n') : '（没有其他在场角色）';
    }

    function getAvailableNodes(room) {
        if (room?.roomType !== 'double' || !room.intimacy) return [];
        return room.intimacy.nodes.filter(node => node.value <= room.intimacy.value);
    }

    function buildCharacterSystemPrompt(room, member, contexts) {
        const availableNodes = getAvailableNodes(room);
        const characterMemory = asString(contexts.characterMemory).trim();
        const sharedMemory = asString(contexts.sharedMemory).trim();
        const sections = [
            '【房间模式固定规则】\n' + DEFAULT_ROOM_PROMPT,
            '【本房间底层规则】\n' + (room.basePrompt || '（无附加规则）'),
            '【世界观】\n' + (room.worldPrompt || '（未单独设定）'),
            '【当前场景】\n' + (room.scenePrompt || '（延续最近对话）'),
            '【用户所扮演的角色】\n' + (room.userPersona || '（用户未填写详细设定，只能依据其明确发言判断）'),
            `【当前角色设定】\n姓名：${member.name}\n${member.personaPrompt || '严格依据对话中已经建立的形象行动。'}`,
            '【你的说话与行动风格】\n' + (member.speakingStyle || '自然、符合人物处境，不使用模板化表达。'),
            '【你的私人目标】\n' + (member.privateGoal || '依据人物设定自然行动，不强行推动剧情。'),
            '【其他在场角色的公开身份】\n' + buildParticipantDirectory(room, member.id),
        ];
        if (sharedMemory) sections.push('【房间公共长期记忆】\n' + sharedMemory);
        if (characterMemory) sections.push('【只有你可以使用的角色独立记忆】\n' + characterMemory);
        if (room.roomType === 'double') {
            sections.push(`【当前亲密度】\n${room.intimacy.value}/${MAX_INTIMACY}。亲密度只约束关系进展，不得直接朗读数值。`);
            sections.push('【当前已达到的关系节点】\n' + (availableNodes.length
                ? availableNodes.map(node => `- ${node.value}：${node.description}`).join('\n')
                : '（尚未达到任何自定义节点）'));
            sections.push('达到节点只表示相关互动在人物和情境允许时可以发生，并不要求立刻发生；仍须尊重人设、上下文与用户意愿。');
        }
        if (room.styleEnabled && room.stylePrompt) {
            sections.push('【自然表达规则】\n' + room.stylePrompt);
        }
        sections.push('【本轮强制要求】\n' + ROOM_TURN_REMINDER);
        return sections.join('\n\n');
    }

    function buildCharacterMessages(room, memberId, contexts, recentLimit) {
        const member = getMember(room, memberId);
        if (!member) throw new Error('找不到待发言角色');
        const historyStart = Math.max(
            Number(room.sharedMemory?.summarizedUntil) || 0,
            Math.max(0, room.messages.length - finiteInt(recentLimit, 80, 12, 240))
        );
        const recentMessages = room.messages.slice(historyStart);
        const latestInput = [...recentMessages].reverse().find(message => message.role === 'user' || message.kind === 'control');
        const pacing = buildTurnPacing(latestInput?.content || '');
        return [
            { role: 'system', content: buildCharacterSystemPrompt(room, member, contexts || {}) + `\n\n【本轮节奏】\n${pacing}` },
            ...recentMessages.map(message => roomMessageForModel(room, message, memberId)).filter(Boolean),
        ];
    }

    function buildDirectorMessages(room, latestUserText) {
        const members = getActiveMembers(room);
        const directory = members.map(member => ({
            id: member.id,
            name: member.name,
            public_profile: member.publicProfile,
            persona_excerpt: member.personaPrompt.slice(0, 1200),
            speaking_style: member.speakingStyle.slice(0, 500),
            private_goal: member.privateGoal,
        }));
        const recent = room.messages.slice(-24).map(message => {
            if (message.role === 'assistant') {
                return `${getMember(room, message.speakerId)?.name || '角色'}：${message.content}`;
            }
            return `${message.role === 'user' ? '用户' : '场景'}：${message.content}`;
        }).join('\n');
        return [
            {
                role: 'system',
                content: [
                    '你是多人角色扮演的隐藏发言调度器，不创作台词。',
                    '根据直接点名、问题对象、人物关系、在场状态和自然交流节奏，选择本轮真正需要回应的人。',
                    '不要机械安排所有人发言。通常选1人，确有互动必要时选2人，绝不超过给定上限。',
                    '只输出合法JSON对象：{"speakers":["角色id"],"narration_needed":false,"narration_hint":""}',
                    'speakers按发言顺序排列；只能使用候选列表里的id。',
                ].join('\n'),
            },
            {
                role: 'user',
                content: [
                    `【本轮最多发言人数】${room.maxSpeakers}`,
                    '【候选角色】\n' + JSON.stringify(directory),
                    '【用户角色设定】\n' + (room.userPersona || '（未设定）'),
                    '【场景】\n' + (room.scenePrompt || '延续当前场景'),
                    '【最近对话】\n' + (recent || '（尚无）'),
                    '【用户最新消息】\n' + latestUserText,
                ].join('\n\n'),
            },
        ];
    }

    function buildNarrationMessages(room, hint) {
        const recent = room.messages.slice(-18).map(message => {
            if (message.role === 'assistant') return `${getMember(room, message.speakerId)?.name || '角色'}：${message.content}`;
            if (message.role === 'user') return `用户：${message.content}`;
            return `事件：${message.content}`;
        }).join('\n');
        return [
            {
                role: 'system',
                content: [
                    '你是房间场景旁白，只描写所有在场者可以观察到的环境变化、时间推进或必要动作衔接。',
                    '不得替用户行动、发言、思考或感受；不得替任何角色写台词或内心；不得泄露秘密。',
                    '只有确有必要时才写一到三句简短旁白，直接输出正文，不要加标题和解释。',
                ].join('\n'),
            },
            {
                role: 'user',
                content: [
                    '【世界观】\n' + (room.worldPrompt || '（未设定）'),
                    '【当前场景】\n' + (room.scenePrompt || '（延续当前场景）'),
                    '【调度提示】\n' + (asString(hint) || '自然衔接当前交流'),
                    '【最近对话】\n' + recent,
                ].join('\n\n'),
            },
        ];
    }

    function sanitizeSpeakerIds(room, values) {
        const allowed = new Set(getActiveMembers(room).map(member => member.id));
        const result = [];
        (Array.isArray(values) ? values : []).forEach(value => {
            const id = asString(value);
            if (allowed.has(id) && !result.includes(id) && result.length < room.maxSpeakers) result.push(id);
        });
        return result;
    }

    function buildIntimacyRulesMessages(room) {
        const member = room?.participants?.[0];
        if (!member) throw new Error('双人房间缺少角色');
        return [
            {
                role: 'system',
                content: [
                    '你是角色关系进展规则设计器。根据人物性格、经历、价值观、边界、目标以及用户角色，建立隐藏的亲密度判定依据。',
                    '规则必须体现这个人物独有的偏好和雷区，不能使用通用讨好模板。',
                    '普通寒暄和重复讨好通常不改变数值；真诚、长期一致性和关键事件才可能缓慢提升；冒犯边界、欺骗或背叛会降低。',
                    '只输出合法JSON对象，格式：',
                    '{"relationship_basis":"关系判断核心","positive_signals":[{"signal":"条件","weight":1}],"negative_signals":[{"signal":"条件","weight":-1}],"hard_boundaries":["不可触碰的边界"],"special_events":["可被视为重要事件的情形"]}',
                    'weight只能是-3到2之间的整数。不要输出亲密度节点内容，不要向用户解释规则。',
                ].join('\n'),
            },
            {
                role: 'user',
                content: [
                    `【角色名称】${member.name}`,
                    '【角色完整人设】\n' + member.personaPrompt,
                    '【角色语言与行动风格】\n' + member.speakingStyle,
                    '【角色私人目标】\n' + member.privateGoal,
                    '【用户角色设定】\n' + room.userPersona,
                    '【世界与场景】\n' + [room.worldPrompt, room.scenePrompt].filter(Boolean).join('\n'),
                ].join('\n\n'),
            },
        ];
    }

    function buildIntimacyJudgeMessages(room, turnMessages) {
        const member = room?.participants?.[0];
        if (!member || !room.intimacy?.rulesReady) throw new Error('亲密度判定尚未启用');
        const transcript = (Array.isArray(turnMessages) ? turnMessages : []).map(message => {
            if (message.role === 'user') return `用户：${message.content}`;
            if (message.role === 'assistant') return `${member.name}：${message.content}`;
            return `事件：${message.content}`;
        }).join('\n');
        return [
            {
                role: 'system',
                content: [
                    '你是隐藏的亲密度变化判定器。只评价本轮用户行为对角色关系的真实影响，不评价写作水平。',
                    '绝大多数普通交流应为0。轻微但符合人物偏好的有效互动可为+1；明显而真诚的重要互动最多+2。',
                    '轻微冒犯为-1，明显违背偏好或边界为-2，严重背叛或伤害可为-3。',
                    '不得因为用户重复夸奖、刷同类话术或单纯对话轮数而持续加分。高亲密阶段必须更加谨慎。',
                    '只输出合法JSON：{"delta":0,"significant":false,"reason":"内部简短依据"}',
                ].join('\n'),
            },
            {
                role: 'user',
                content: [
                    `【当前亲密度】${room.intimacy.value}/${MAX_INTIMACY}`,
                    '【隐藏判定规则】\n' + JSON.stringify(room.intimacy.rules),
                    '【角色人设】\n' + member.personaPrompt,
                    '【本轮对话】\n' + transcript,
                ].join('\n\n'),
            },
        ];
    }

    function clampIntimacyDelta(rawDelta, currentValue, significant, recentDeltas) {
        let delta = finiteInt(rawDelta, 0, -3, 2);
        const current = finiteInt(currentValue, 0, 0, MAX_INTIMACY);
        const recent = (Array.isArray(recentDeltas) ? recentDeltas : []).slice(-5);
        if (delta > 0) {
            const cap = current < 60 ? 2 : 1;
            delta = Math.min(delta, cap);
            const recentPositive = recent.filter(value => value > 0).length;
            if (!significant && current >= 170) delta = 0;
            else if (!significant && recentPositive >= 4) delta = 0;
            else if (!significant && recentPositive >= 2) delta = Math.min(delta, 1);
        }
        if (delta < 0 && !significant) delta = Math.max(delta, -2);
        if (current + delta > MAX_INTIMACY) delta = MAX_INTIMACY - current;
        if (current + delta < 0) delta = -current;
        return delta;
    }

    function applyIntimacyResult(room, result) {
        if (!room?.intimacy) return { delta: 0, oldValue: 0, newValue: 0, unlocked: [], relocked: [] };
        const oldValue = room.intimacy.value;
        const delta = clampIntimacyDelta(
            result?.delta,
            oldValue,
            result?.significant === true,
            room.intimacy.recentDeltas
        );
        const newValue = Math.min(MAX_INTIMACY, Math.max(0, oldValue + delta));
        const unlocked = room.intimacy.nodes.filter(node => oldValue < node.value && newValue >= node.value);
        const relocked = room.intimacy.nodes.filter(node => oldValue >= node.value && newValue < node.value);
        room.intimacy.value = newValue;
        room.intimacy.recentDeltas = room.intimacy.recentDeltas.concat(delta).slice(-20);
        room.intimacy.lastReason = asString(result?.reason).slice(0, 500);
        room.intimacy.updatedAt = Date.now();
        room.updatedAt = Date.now();
        return { delta, oldValue, newValue, unlocked, relocked };
    }

    function fallbackIntimacyRules(room) {
        const member = room?.participants?.[0];
        return {
            relationship_basis: `严格依据${member?.name || '角色'}的人设、边界、目标以及与用户角色的长期互动一致性判断`,
            positive_signals: [
                { signal: '尊重明确边界并表现出持续一致的真诚', weight: 1 },
                { signal: '在关键事件中作出符合角色核心价值观的选择', weight: 2 },
            ],
            negative_signals: [
                { signal: '无视角色表达的边界或反复进行角色厌恶的行为', weight: -1 },
                { signal: '欺骗、背叛或故意伤害角色重视的人与事', weight: -3 },
            ],
            hard_boundaries: ['以角色完整人设中明确写出的边界为准'],
            special_events: ['足以改变双方信任或关系认知的关键事件'],
        };
    }

    async function compressImageFile(file, options) {
        const fileType = asString(file?.type).trim();
        if (!file || (fileType && !/^image\//i.test(fileType))) {
            throw new Error('请选择图片文件');
        }
        if (file.size > IMAGE_LIMIT_BYTES) throw new Error('图片不能超过12MB');
        const settings = Object.assign({ maxWidth: 1200, maxHeight: 1200, quality: 0.82, square: false }, options || {});
        const dataUrl = await readFileAsDataUrl(file);
        const image = await loadImage(dataUrl);
        let sourceX = 0;
        let sourceY = 0;
        let sourceWidth = image.naturalWidth || image.width;
        let sourceHeight = image.naturalHeight || image.height;
        if (!sourceWidth || !sourceHeight) throw new Error('图片尺寸无效');
        if (settings.square) {
            const edge = Math.min(sourceWidth, sourceHeight);
            sourceX = (sourceWidth - edge) / 2;
            sourceY = (sourceHeight - edge) / 2;
            sourceWidth = edge;
            sourceHeight = edge;
        }
        const ratio = Math.min(1, settings.maxWidth / sourceWidth, settings.maxHeight / sourceHeight);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sourceWidth * ratio));
        canvas.height = Math.max(1, Math.round(sourceHeight * ratio));
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('当前设备无法处理这张图片');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', settings.quality);
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
            reader.readAsDataURL(file);
        });
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('图片解码失败'));
            image.src = src;
        });
    }

    return {
        MAX_INTIMACY,
        MAX_GROUP_MEMBERS,
        DEFAULT_ROOM_PROMPT,
        createId,
        memberColor,
        normalizeMember,
        normalizeNodes,
        normalizeRoom,
        normalizeIntimacy,
        createRoom,
        getMember,
        getActiveMembers,
        detectMentionedMembers,
        buildCharacterMessages,
        buildDirectorMessages,
        buildNarrationMessages,
        sanitizeSpeakerIds,
        buildIntimacyRulesMessages,
        buildIntimacyJudgeMessages,
        applyIntimacyResult,
        fallbackIntimacyRules,
        getAvailableNodes,
        roomMessageForModel,
        roomMessagesForMemory,
        cleanCharacterOutput,
        hasSubstantiveContent,
        hasSubstantiveRoomContent,
        buildTurnPacing,
        compressImageFile,
    };
});
