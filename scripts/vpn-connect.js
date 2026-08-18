#!/usr/bin/env node
/**
 * Surfshark OpenVPN 連線 script（Node.js 版）
 *
 * 流程：
 *   1. spawn 系統 openvpn binary（--config + management interface）
 *   2. 用 node-openvpn library 監察連接狀態
 *   3. 連接成功後攞 tunnel IP，設定 policy routing（ip rule）
 *   4. 自動寫入 .env 嘅 VPN_TUNNEL_IP
 *
 * 注意：仍需系統安裝 openvpn 同 root 權限（tun 裝置 + ip rule）
 * 用法：sudo node scripts/vpn-connect.js
 */
const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const openvpnmanager = require("node-openvpn");

const CONFIG = path.resolve("vpn/surfshark-sg.ovpn");
const VPN_DIR = path.resolve("vpn");
const ENV_FILE = path.resolve(".env");
const MGMT_PORT = 7505;
const ROUTE_TABLE = 100;
const LOG_FILE = path.resolve("vpn/openvpn.log");

// 需要行 VPN 嘅 API host。Bun 唔 honor http.Agent localAddress，
// 所以除咗 source-based rule，仲要加 destination-based rule 先 cover 到 Bun。
const VPN_DEST_HOSTS = ["generativelanguage.googleapis.com"];

/**
 * 加 destination-based policy routing：所有去 AI API host 嘅流量直接經 tunnel 出街。
 * 唔依賴 app 層 bind socket（Bun 唔 honor localAddress），runtime-agnostic。
 * 每次 VPN 連線都會 refresh（重新 resolve host），IP 變咗都會自動跟。
 */
function addDestRules() {
    // 清走舊 to-rule（tolerate 唔存在）
    try {
        const out = execSync("ip rule show", { encoding: "utf-8" });
        for (const line of out.split("\n")) {
            const m = line.match(/to ([0-9.]+)(?:\/\d+)?\s+lookup (\d+)/);
            if (m && m[2] === String(ROUTE_TABLE)) {
                execSync(`ip rule del to ${m[1]} lookup ${ROUTE_TABLE} 2>/dev/null; true`);
            }
        }
    } catch (_) { /* ignore */ }

    for (const host of VPN_DEST_HOSTS) {
        let ips = [];
        try {
            ips = execSync(`getent ahostsv4 ${host} | awk '{print $1}' | sort -u`, { encoding: "utf-8" })
                .trim().split("\n").filter(Boolean);
        } catch (_) { /* ignore */ }
        for (const ip of ips) {
            try { execSync(`ip rule add to ${ip} lookup ${ROUTE_TABLE}`); } catch (_) { /* ignore */ }
        }
        console.log(`🌐 ${host} -> tunnel 路由 (${ips.join(", ") || "無 IP"})`);
    }
}

// ---------- .env 更新 ----------
function setEnvVar(envPath, key, value) {
    let content = "";
    if (fs.existsSync(envPath)) content = fs.readFileSync(envPath, "utf-8");
    const regex = new RegExp(`^#?\\s*${key}=.*$`, "m");
    const line = `${key}=${value}`;
    if (regex.test(content)) {
        content = content.replace(regex, line);
    } else {
        content += `\n${line}\n`;
    }
    fs.writeFileSync(envPath, content, "utf-8");
}

// ---------- policy routing + 寫 env ----------
function finalize() {
    try {
        const link = execSync("ip -o link show | grep -oE 'tun[0-9]+' | head -1", { encoding: "utf-8" }).trim();
        if (!link) throw new Error("搵唔到 tun 介面");

        const tunIP = execSync(`ip -4 -o addr show ${link} | awk '{print $4}' | cut -d/ -f1`, { encoding: "utf-8" }).trim();

        // 攞 tunnel subnet（例如 10.8.8.0/24）——用 subnet rule，reconnect 派新 IP 都唔使改
        let tunNet = "";
        try {
            // grep 個 pattern 要加引號，唔係 "kernel" 會被當成檔案名
            tunNet = execSync(`ip route show dev ${link} | grep "proto kernel" | awk '{print $1}' | head -1`, { encoding: "utf-8" }).trim();
        } catch (_) { /* ignore */ }
        if (!tunNet) {
            tunNet = tunIP.split(".").slice(0, 3).join(".") + ".0/24";
        }

        // 從 openvpn log 攞 route-gateway
        let gw = "";
        try {
            const logContent = fs.readFileSync(LOG_FILE, "utf-8");
            const gwMatch = logContent.match(/route-gateway\s+([0-9.]+)/);
            if (gwMatch) gw = gwMatch[1];
        } catch (_) { /* ignore */ }
        if (!gw) {
            // fallback: subnet 第一個可用 IP
            const subnet = tunIP.split(".").slice(0, 3).join(".") + ".1";
            gw = subnet;
        }

        console.log(`✅ tun: ${link}, IP: ${tunIP}, net: ${tunNet}, gateway: ${gw}`);

        // 清舊 rule/table 再加（tolerate 唔存在）
        execSync(`ip rule del from all lookup ${ROUTE_TABLE} 2>/dev/null; true`);
        execSync(`ip route flush table ${ROUTE_TABLE} 2>/dev/null; true`);
        execSync(`ip route add default via ${gw} dev ${link} table ${ROUTE_TABLE}`);
        execSync(`ip rule add from ${tunNet} lookup ${ROUTE_TABLE}`);
        addDestRules();

        setEnvVar(ENV_FILE, "VPN_TUNNEL_IP", tunIP);
        console.log(`📝 已寫入 .env: VPN_TUNNEL_IP=${tunIP}`);
        console.log("🔍 測試: curl --interface " + tunIP + " https://api.ipify.org");
        process.exit(0);
    } catch (err) {
        console.error("❌ finalize 失敗:", err.message);
        process.exit(1);
    }
}

// ---------- 清舊 openvpn ----------
try {
    execSync("pkill -9 openvpn", { stdio: "ignore" });
    execSync("sleep 1");
} catch (_) { /* 冇舊 process */ }

// ---------- spawn openvpn ----------
console.log("🔌 啟動 Surfshark OpenVPN...");
const proc = spawn("openvpn", [
    "--cd", VPN_DIR,
    "--config", CONFIG,
    "--management", "127.0.0.1", String(MGMT_PORT),
    "--log", LOG_FILE,
    "--verb", "3",
], { stdio: ["ignore", "ignore", "pipe"] });

// capture stderr for debugging
proc.stderr.on("data", (d) => {
    const msg = d.toString().trim();
    if (msg) console.error("⚠️ openvpn stderr:", msg);
});

proc.on("error", (err) => {
    console.error("❌ spawn openvpn 失敗（確認已安裝: sudo apt install openvpn）:", err.message);
    process.exit(1);
});

// ---------- node-openvpn 監察 ----------
const opts = { host: "127.0.0.1", port: MGMT_PORT, timeout: 3000 };
const vpn = openvpnmanager.connect(opts);

vpn.on("error", (err) => console.error("⚠️ mgmt:", err?.message || err));

let gotIP = false;
let finalized = false;

// 設定 routing（只行一次）。等 tun 完全就緒先 finalize（加 2 秒 delay）。
function runFinalize() {
    if (finalized) return;
    finalized = true;
    clearInterval(pollTimer);
    console.log("✅ CONNECTED，設定 routing...");
    setTimeout(finalize, 2000); // 等 tun 完全就緒
}

// 獨立 poll tunnel readiness —— node-openvpn 喺 container 入面 connect management
// port (7505) 有 ECONNREFUSED race（openvpn 未 bind 就 connect，又唔會自動 retry），
// 唔可以淨係靠佢嘅 state-change event。有 tun interface + IPv4 就算 ready。
const pollTimer = setInterval(() => {
    if (gotIP || finalized) return;
    try {
        const tun = execSync("ip -o link show | grep -oE 'tun[0-9]+' | head -1", { encoding: "utf-8" }).trim();
        if (!tun) return;
        const ip = execSync(`ip -4 -o addr show ${tun} 2>/dev/null | awk '{print $4}' | head -1`, { encoding: "utf-8" }).trim();
        if (!ip) return;
        gotIP = true;
        runFinalize();
    } catch (_) { /* 未 ready */ }
}, 1000);

vpn.on("state-change", (state) => {
    // node-openvpn 將 ">STATE:<time>,<STATE>,<desc>" split 成 [time, state, desc]
    const stateName = Array.isArray(state) ? state[1] : state;
    console.log("🔄 state:", stateName);
    if (stateName === "CONNECTED" && !gotIP) {
        gotIP = true;
        runFinalize();
    }
});

// 30 秒 timeout
setTimeout(() => {
    if (!gotIP) {
        console.error("❌ 30 秒內未連接，睇 vpn/openvpn.log 排查");
        process.exit(1);
    }
}, 30000);

process.on("SIGINT", () => {
    try { execSync("pkill -f 'openvpn.*surfshark-sg'", { stdio: "ignore" }); } catch (_) {}
    process.exit(0);
});
