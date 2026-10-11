const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'www', 'index.html'), 'utf8');
const packageJson = require('../package.json');

function functionBody(name, nextName) {
    const start = html.indexOf(`function ${name}`);
    const end = nextName ? html.indexOf(`function ${nextName}`, start + 1) : html.length;
    assert.notEqual(start, -1, `找不到函数 ${name}`);
    assert.notEqual(end, -1, `找不到函数 ${nextName}`);
    return html.slice(start, end);
}

test('内联应用脚本可以通过 JavaScript 语法检查', () => {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1);
    assert.doesNotThrow(() => new Function(scripts[0][1]));
});

test('流式文字增长不会触发程序化滚动', () => {
    assert.match(html, /\.messages-container\s*\{[\s\S]*?scroll-behavior:\s*auto;/);
    assert.match(html, /\.messages-container\s*\{[\s\S]*?overflow-anchor:\s*none;/);
    assert.doesNotMatch(html, /scrollToBottom\(true\)/);
    assert.doesNotMatch(functionBody('updateStreamingBubble', 'finalizeStreamingMessage'), /scrollToBottom/);
    assert.doesNotMatch(functionBody('updateRoomStreamingBubble', 'removeRoomStreamingMessage'), /scrollToBottom/);
    assert.match(functionBody('sendMessage', 'regenerateRoomLastMessage'), /renderMessages\(\{ preserveScroll: true \}\)/);
});

test('图片保存等待压缩完成并强制刷新到持久存储', () => {
    const saveRoom = functionBody('saveRoomFromModal', 'showToast');
    assert.match(saveRoom, /await waitForRoomDraftImages\(\)/);
    assert.match(saveRoom, /await persistFullState\(\)/);
    assert.match(html, /roomDraftBackgroundRevision/);
    assert.match(html, /roomDraftAvatarRevisions/);
});

test('房间记忆使用保持原始序号的转换函数', () => {
    assert.match(functionBody('getRoomMemoryConversation', 'summarizeRoomMemoryChunk'), /Rooms\.roomMessagesForMemory\(room\)/);
});

test('重启应用时会恢复独立的剧情或房间页面，并兼容旧通用模式', () => {
    assert.match(html, /settingsBackup\.activeMode === 'room' \|\| settingsBackup\.activeMode === 'story' \|\| settingsBackup\.activeMode === 'general'/);
    assert.match(functionBody('init', null), /updateModeUI\(\);[\s\S]*?renderMessages\(\);/);
});

test('作品卡片菜单监听器只在主页渲染器中绑定到卡片自身', () => {
    const renderHome = functionBody('renderHomeCollection', 'renderHomeLibraries');
    assert.match(renderHome, /container\.querySelectorAll\('\.v2-work-card'\)/);
    assert.doesNotMatch(renderHome, /document\.addEventListener/);
});

test('应用版本号在 npm 与 Android 配置中一致', () => {
    const gradle = fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8');
    assert.equal(packageJson.version, '2.1.0');
    assert.match(gradle, /versionCode\s+14/);
    assert.match(gradle, /versionName\s+"2\.1\.0"/);
});

test('模型列表只保留 DeepSeek 官方当前模型标识', () => {
    assert.match(html, /value="deepseek-flash"/);
    assert.match(html, /value="deepseek-v4-pro"/);
    assert.doesNotMatch(html, /OpenRouter|liquid\/lfm/i);
    assert.doesNotMatch(html, /value="deepseek-v4-flash"/);
});

test('长对话定位器支持搜索、收藏和分窗跳转', () => {
    assert.match(html, /id="btnLocate"/);
    assert.match(html, /id="navigatorSearchInput"/);
    assert.match(html, /function jumpToMessage/);
    assert.match(html, /MESSAGE_PAGE_SIZE\s*=\s*200/);
    assert.doesNotMatch(html, /renderedMessageLimit/);
});

test('剧情与房间共享定位外壳但读取各自独立消息集合', () => {
    const start = html.indexOf('function renderRoomMessages');
    const end = html.indexOf("$messagesContainer.addEventListener('click'", start);
    const roomRender = html.slice(start, end);
    assert.doesNotMatch(roomRender, /bookmark-btn/);
    assert.doesNotMatch(roomRender, /data-locate-index/);
    assert.match(functionBody('openConversationNavigator', 'closeConversationNavigator'), /getActiveMessages\(\)/);
    assert.match(functionBody('jumpToMessage', null), /setMessageRenderRange/);
});

test('剧情智能体和房间分别使用自己的全屏结构化编辑器', () => {
    assert.match(html, /id="storyEditor"/);
    assert.match(html, /id="storyCharactersEditor"/);
    assert.match(html, /id="btnAddStoryCharacter"/);
    assert.match(html, /story-character-field-label/);
    assert.match(html, /story-character-field-value/);
    assert.match(html, /function addStoryCharacter/);
    assert.match(functionBody('addStoryCharacter', 'collectStoryCharacters'), /Story\.cloneCharacterSchema\(previous\)/);
    assert.match(html, /storyDraftCharacters\.length <= 1/);
    assert.match(html, /character\.fields\.length <= 1/);
    assert.match(html, /room-editor-overlay/);
    assert.match(html, /id="roomStyleExamplesInput"/);
    assert.match(html, /class="member-growth"/);
    assert.match(html, /class="member-knowledge"/);
});

test('剧情与房间拥有分离的记忆设置和消息窗口状态', () => {
    assert.match(html, /storyModel:\s*'deepseek-flash'/);
    assert.match(html, /roomModel:\s*'deepseek-flash'/);
    assert.match(html, /storyMemorySettings:\s*Memory\.normalizeConfig\(\)/);
    assert.match(html, /roomMemorySettings:\s*Memory\.normalizeConfig\(\)/);
    assert.match(html, /storyRenderedMessageRange/);
    assert.match(html, /roomRenderedMessageRange/);
    assert.match(html, /appData\.activeMode === 'room'[\s\S]*?appData\.roomMemorySettings[\s\S]*?appData\.storyMemorySettings/);
});

test('剧情与房间长期记忆提供查看、编辑、事实与重建页面', () => {
    assert.match(html, /id="memoryEditorOverlay"/);
    assert.match(html, /id="memoryCoreInput"/);
    assert.match(html, /memory-segment-summary/);
    assert.match(html, /function saveMemoryEdits/);
    assert.match(html, /id="memoryFactsList"/);
    assert.match(html, /id="roomCharacterMemoryList"/);
    assert.match(html, /btnResetStoryMemory/);
});

test('2.0 使用剧情、房间、我的三级主页且聊天页不再依赖侧边栏', () => {
    assert.match(html, /id="homeStoryPage"/);
    assert.match(html, /id="homeRoomPage"/);
    assert.match(html, /id="homeMyPage"/);
    assert.match(html, /data-home-tab="story"/);
    assert.match(html, /data-home-tab="room"/);
    assert.match(html, /data-home-tab="my"/);
    assert.match(html, /#chatShell \.sidebar,#chatShell \.sidebar-overlay \{ display:none !important; \}/);
});

test('聊天页世界书只有设定页数据源且高频工具不包含世界书', () => {
    assert.match(html, /id="storyWorldBookEditor"/);
    assert.match(html, /id="roomWorldBookEditor"/);
    assert.match(html, /function collectWorldBook/);
    const prepare = functionBody('prepareV2Shell', 'setHomeTab');
    assert.match(prepare, /\$btnLocate, \$btnMemoryManager, \$btnStyleLab/);
    assert.doesNotMatch(prepare, /WorldBook|世界书/);
});

test('候选灵感和文风沙盒都不会写入正式消息或记忆', () => {
    const inspiration = functionBody('generateInspiration', 'getCurrentSnippetTarget');
    assert.match(inspiration, /Inspiration\.requestRecommendations/);
    assert.doesNotMatch(inspiration, /\.conversations\.push|\.messages\.push|sharedMemory\s*=|characterMemories\s*=/);
    assert.match(html, /不会自动发送/);
});

test('手机粗指针设备的 Enter 保留为换行', () => {
    assert.match(html, /matchMedia\?\.\('\(pointer: coarse\)'\)/);
    assert.match(html, /!mobileKeyboard/);
});

test('文风工坊具有独立全屏页面、因子库和应用快照', () => {
    assert.match(html, /<script src="style-lab\.js"><\/script>/);
    assert.match(html, /id="styleLabOverlay"/);
    assert.match(html, /id="styleProfileList"/);
    assert.match(html, /id="styleProfileStrengthRange"/);
    assert.match(html, /id="styleFactorList"/);
    assert.match(html, /styleProfiles:\s*\[\]/);
    assert.match(html, /StyleLab\.createAppliedStyle\(profile\)/);
    assert.match(html, /StyleLab\.buildInfluencePrompt\(agent\?\.styleInfluence\)/);
    assert.match(html, /StyleLab\.buildInfluencePrompt\(room\.styleInfluence\)/);
});

test('沙盒参考文本不写入对话、记忆或房间状态', () => {
    const preview = functionBody('generateStylePreview', 'applySelectedStyle');
    assert.match(preview, /StyleLab\.buildPreviewMessages/);
    assert.match(preview, /previewText/);
    assert.doesNotMatch(preview, /\.conversations\.push|\.messages\.push|sharedMemory|characterMemories|intimacy|turnEffects/);
    const context = functionBody('buildCurrentStylePreviewContext', 'callStylePreview');
    assert.doesNotMatch(context, /\.conversations|\.messages|sharedMemory|characterMemories|intimacy/);
    assert.match(html, /隔离沙盒：这里的文本不是已发生剧情/);
});

test('记忆整理失败不会直接阻断普通发送', () => {
    const send = functionBody('sendMessage', 'regenerateRoomLastMessage');
    assert.match(send, /使用受控最近上下文继续生成/);
    assert.doesNotMatch(send, /长期记忆整理未完成：[\s\S]*?return;/);
});

test('GitHub Actions 按锁文件进行可复现安装', () => {
    const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'main.yml'), 'utf8');
    assert.match(workflow, /run:\s*npm ci/);
    assert.doesNotMatch(workflow, /rm -rf node_modules package-lock\.json/);
});
