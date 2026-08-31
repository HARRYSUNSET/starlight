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
    assert.equal(packageJson.version, '1.3.2');
    assert.match(gradle, /versionCode\s+6/);
    assert.match(gradle, /versionName\s+"1\.3\.2"/);
});

test('GitHub Actions 按锁文件进行可复现安装', () => {
    const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'main.yml'), 'utf8');
    assert.match(workflow, /run:\s*npm ci/);
    assert.doesNotMatch(workflow, /rm -rf node_modules package-lock\.json/);
});
