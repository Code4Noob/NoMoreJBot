#!/usr/bin/env node
/**
 * Patch @slack/socket-mode（Bun 兼容）——只係 @slack/socket-mode **v3**（undici-based）先需要。
 *
 * 背景：socket-mode v3 用 undici 做 WebSocket；undici 喺 Node 先 expose module-level `ping()` 幫手，
 * 但喺 Bun 下無論 `require('undici')` 定 `import('undici')` 都唔會 expose `ping`（Bun interop 問題），
 * 令 SlackSocket 心跳 error "Failed to send ping to Slack ... (0, undici_1.ping) is not a function"。
 * 另外 v3 靠 undici diagnostics_channel 偵測 pong，Bun 下都唔會出 → "pong wasn't received"。
 *
 * 所以而家 repo 用 @slack/bolt@4 + @slack/socket-mode@2（`ws`-based，ping/pong 正常）：
 * 呢個 patch 喺 v2 底下唔會 match 到任何 code，會 skip（exit 0），保留只係為咗萬一日後升返
 * socket-mode v3 嗰陣可以即時 re-apply。已 patch 就 skip；版本改咗都唔會 fail。
 */
const fs = require("fs");
const path = require("path");

const TARGET = path.resolve(
    "node_modules/@slack/socket-mode/dist/src/SlackWebSocket.js"
);
const MARK = "ping 已 patch（Bun：用 websocket.ping()）";

try {
    if (!fs.existsSync(TARGET)) {
        console.log("⚠️ [patch-slack] 搵唔到", TARGET, "（未安裝 / 版本改咗）— skip");
        process.exit(0);
    }
    let src = fs.readFileSync(TARGET, "utf-8");
    if (src.includes(MARK)) {
        console.log("✅ [patch-slack] 已經 patch 咗，skip");
        process.exit(0);
    }

    // 搵嗰行： (0, undici_1.ping)(this.websocket, Buffer.from(pingMessage));
    const lineRe =
        /^(\s*)\(0, undici_1\.ping\)\(this\.websocket, Buffer\.from\(pingMessage\)\);\s*$/m;
    if (!lineRe.test(src)) {
        console.log(
            "⚠️ [patch-slack] 搵唔到舊 code（@slack/socket-mode 版本可能改咗）— skip"
        );
        process.exit(0);
    }

    src = src.replace(lineRe, (_full, indent) => {
        return (
            `${indent}// ${MARK}\n` +
            `${indent}// Bun 下 undici module 冇 expose ping()；用 WebSocket instance 嘅 .ping()（等價）\n` +
            `${indent}this.websocket.ping(Buffer.from(pingMessage));`
        );
    });

    fs.writeFileSync(TARGET, src, "utf-8");
    console.log("✅ [patch-slack] socket-mode ping 已 patch（用 websocket.ping()）");
} catch (err) {
    console.error("❌ [patch-slack] 失敗:", err.message);
    process.exit(1);
}
