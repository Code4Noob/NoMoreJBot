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

function patchClient() {
    if (!fs.existsSync(TARGET)) {
        console.log("⚠️ [patch-telegraf] 搵唔到", TARGET, "（未安裝 / 版本改咗）— skip");
        return;
    }
    let src = fs.readFileSync(TARGET, "utf-8");
    if (src.includes(MARK)) {
        console.log("✅ [patch-telegraf] redactToken 已經 patch 咗，skip");
        return;
    }

    // 搵 redactToken 入面嗰行：error.message = error.message.replace(...);
    // 用 regex 唔靠 exact string，改版都較穩陣。保留原行，淨係包一層 try/catch。
    const lineRe = /^(\s*)error\.message = error\.message\.replace\([^;]+\);\s*$/m;
    if (!lineRe.test(src)) {
        console.log("⚠️ [patch-telegraf] 搵唔到舊 code（telegraf 版本可能改咗）— skip");
        return;
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
}

// telegraf polling 網絡錯誤 retry（Bun/network）：
// telegraf 嘅 getUpdates catch 只 retry FetchError / 429 / 5xx；喺 Bun 下純網絡錯誤
// （ECONNRESET 等，唔係 FetchError）會直接 throw 死個 polling loop → 成個 bot 死。
// Patch：加多個 branch，見網絡 error code 就等 2 秒 retry，唔好 throw。
function patchPolling() {
    const POLLING_TARGET = path.resolve(
        "node_modules/telegraf/lib/core/network/polling.js"
    );
    const POLLING_MARK = "polling 已 patch（network error retry）";

    if (!fs.existsSync(POLLING_TARGET)) {
        console.log("⚠️ [patch-telegraf] 搵唔到 polling.js — skip");
        return;
    }
    let psrc = fs.readFileSync(POLLING_TARGET, "utf-8");
    if (psrc.includes(POLLING_MARK)) {
        console.log("✅ [patch-telegraf] polling 已經 patch 咗，skip");
        return;
    }
    const abortRe = /^(\s*)if \(err\.name === 'AbortError'\)\n\1\s*return;\n/m;
    if (!abortRe.test(psrc)) {
        console.log(
            "⚠️ [patch-telegraf] polling 搵唔到 AbortError block（版本可能改咗）— skip"
        );
        return;
    }
    psrc = psrc.replace(abortRe, (full, indent) => {
        return (
            `${indent}if (err.name === 'AbortError')\n` +
            `${indent}    return;\n` +
            `${indent}// ${POLLING_MARK}\n` +
            `${indent}if (typeof err.code === 'string' &&\n` +
            `${indent}    /^(ECONNRESET|ECONNREFUSED|ECONNABORTED|ECONNCLOSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|EPIPE|EADDRNOTAVAIL|EADDRINUSE|ENOTFOUND|UND_ERR)/.test(err.code)) {\n` +
            `${indent}    debug('Network error fetching updates (%s), retrying after 2s.', err.code, err);\n` +
            `${indent}    await wait(2000);\n` +
            `${indent}    continue;\n` +
            `${indent}}\n`
        );
    });
    fs.writeFileSync(POLLING_TARGET, psrc, "utf-8");
    console.log("✅ [patch-telegraf] polling 已 patch（network error retry）");
}

try {
    patchClient();
    patchPolling();
} catch (err) {
    console.error("❌ [patch-telegraf] 失敗:", err.message);
    process.exit(1);
}
