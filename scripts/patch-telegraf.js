#!/usr/bin/env node
/**
 * Patch telegraf 嘅 redactToken bug（Bun 專屬）：
 * telegraf lib/core/network/client.js 嘅 redactToken() 直接 assign
 * `error.message`，但喺 Bun 下某啲 error object 嘅 message 係 readonly，
 * 一 assign 就 throw "Attempted to assign to readonly property"，
 * 令成個 bot process crash（exit code 1）。
 *
 * 經 package.json "postinstall" 跑 —— `bun install` 之後自動重新 apply
 * （local + Docker oven/bun 都 cover 到，唔使手動再改）。
 * 冧冧性：已經 patch 過就 skip；版本改咗搵唔到舊 code 都唔會 fail。
 */
const fs = require("fs");
const path = require("path");

const TARGET = path.resolve("node_modules/telegraf/lib/core/network/client.js");
const MARK = "redactToken 已 patch（readonly message 安全）";

try {
    if (!fs.existsSync(TARGET)) {
        console.log("⚠️ [patch-telegraf] 搵唔到", TARGET, "（未安裝 / 版本改咗）— skip");
        process.exit(0);
    }
    let src = fs.readFileSync(TARGET, "utf-8");
    if (src.includes(MARK)) {
        console.log("✅ [patch-telegraf] 已經 patch 咗，skip");
        process.exit(0);
    }

    // 搵 redactToken 入面嗰行：error.message = error.message.replace(...);
    // 用 regex 唔靠 exact string，改版都較穩陣。保留原行，淨係包一層 try/catch。
    const lineRe = /^(\s*)error\.message = error\.message\.replace\([^;]+\);\s*$/m;
    if (!lineRe.test(src)) {
        console.log("⚠️ [patch-telegraf] 搵唔到舊 code（telegraf 版本可能改咗）— skip");
        process.exit(0);
    }

    src = src.replace(lineRe, (full, indent) => {
        const stmt = full.trim();
        return (
            `${indent}try {\n` +
            `${indent}    ${stmt}\n` +
            `${indent}} catch (_) {\n` +
            `${indent}    // ${MARK}\n` +
            `${indent}    // Bun: 某啲 error object 嘅 message 係 readonly，assign 會 throw；照原樣 throw 就算\n` +
            `${indent}}`
        );
    });

    fs.writeFileSync(TARGET, src, "utf-8");
    console.log("✅ [patch-telegraf] telegraf redactToken 已 patch（readonly message 安全）");
} catch (err) {
    console.error("❌ [patch-telegraf] 失敗:", err.message);
    process.exit(1);
}
