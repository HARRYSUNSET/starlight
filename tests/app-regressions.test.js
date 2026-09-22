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

test('重启应用时会恢复完整的模式界面，通用模式也能覆盖旧房间状态', () => {
    assert.match(html, /settingsBackup\.activeMode === 'room' \|\| settingsBackup\.activeMode === 'general'/);
    assert.match(functionBody('init', null), /updateModeUI\(\);[\s\S]*?renderMessages\(\);/);
});

test('全局智能体菜单监听器不会在每次渲染时重复注册', () => {
    const matches = html.match(/document\.addEventListener\('click'/g) || [];
    assert.equal(matches.length, 1);
});

test('应用版本号在 npm 与 Android 配置中一致', () => {
    const gradle = fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8');
    assert.equal(packageJson.version, '1.4.0');
    assert.match(gradle, /versionCode\s+8/);
    assert.match(gradle, /versionName\s+"1\.4\.0"/);
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

test('剧情房间使用全屏结构化编辑器', () => {
    assert.match(html, /room-editor-overlay/);
    assert.match(html, /id="roomStyleExamplesInput"/);
    assert.match(html, /class="member-growth"/);
    assert.match(html, /class="member-knowledge"/);
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
