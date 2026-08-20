#!/usr/bin/env node
/**
 * VPN 路由自癒 daemon（需要 root，由 vpn-connect.js 起、detached 常駐）。
 *
 * 問題：openvpn 重連時 tun0 會 down/up，kernel 會自動刪走 bind 喺 tun0 嘅 route，
 * 包括 policy routing table 100 嘅 default route。但 destination to-rule 仲喺度
 * （佢哋冇 bind interface），結果流量 match 到 rule -> lookup 100 -> 空 -> 跌返 main
 * -> 經 HK default route 出街 -> Gemini "User location is not supported"。
 *
 * 呢個 daemon 每 3 秒檢查：tun 起咗但 table 100 冇 default route，就自動補返，
 * 順手 refresh 埋 destination to-rule（AI host IP 可能轉咗）。
 */
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROUTE_TABLE = 100;
const LOG_FILE = path.resolve("vpn/openvpn.log");
// 同 vpn-connect.js 一致：需要行 VPN 嘅 API host
const VPN_DEST_HOSTS = ["generativelanguage.googleapis.com"];
const HEAL_INTERVAL_MS = 3000;

function run(cmd) {
    try {
        return execSync(cmd, { encoding: "utf-8" }).trim();
    } catch (_) {
        return "";
    }
}

function getTun() {
    return run("ip -o link show | grep -oE 'tun[0-9]+' | head -1");
}

function tableHasDefault() {
    return /default/.test(run(`ip route show table ${ROUTE_TABLE}`));
}

function getGateway(tunIP) {
    try {
        const log = fs.readFileSync(LOG_FILE, "utf-8");
        const m = log.match(/route-gateway\s+([0-9.]+)/);
        if (m) return m[1];
    } catch (_) {}
    return tunIP.split(".").slice(0, 3).join(".") + ".1";
}

// refresh destination to-rule（清舊 + 重新 resolve + 加新），AI host IP 變咗都跟到
function refreshDestRules() {
    const out = run("ip rule show");
    for (const line of out.split("\n")) {
        const m = line.match(/to ([0-9.]+)(?:\/\d+)?\s+lookup (\d+)/);
        if (m && m[2] === String(ROUTE_TABLE)) {
            run(`ip rule del to ${m[1]} lookup ${ROUTE_TABLE}`);
        }
    }
    for (const host of VPN_DEST_HOSTS) {
        const ips = run(`getent ahostsv4 ${host} | awk '{print $1}' | sort -u`)
            .split("\n")
            .filter(Boolean);
        for (const ip of ips) {
            run(`ip rule add to ${ip} lookup ${ROUTE_TABLE}`);
        }
    }
}

// 自癒主邏輯
function heal() {
    try {
        const tun = getTun();
        if (!tun) return; // tunnel down，等佢上返
        if (tableHasDefault()) {
            // 健康，但順手 refresh 吓 to-rule
            refreshDestRules();
            return;
        }
        const tunIP = run(
            `ip -4 -o addr show ${tun} | awk '{print $4}' | cut -d/ -f1`
        );
        if (!tunIP) return;
        const gw = getGateway(tunIP);
        run(`ip route add default via ${gw} dev ${tun} table ${ROUTE_TABLE}`);
        console.log(`🛡️ [route-watch] 補返 table ${ROUTE_TABLE} default: via ${gw} dev ${tun}`);
    } catch (err) {
        console.log("⚠️ [route-watch] heal 失敗:", err?.message || err);
    }
}

// 防止多個 daemon：殺走舊嘅自己（唔包括而家呢個 process）
try {
    const out = run("pgrep -f 'vpn-route-watch.js'");
    for (const pid of out.split("\n")) {
        if (pid && Number(pid) !== process.pid) {
            try {
                process.kill(Number(pid), "SIGKILL");
            } catch (_) {}
        }
    }
} catch (_) {}

console.log(
    `🛡️ [route-watch] daemon 啟動（每 ${HEAL_INTERVAL_MS / 1000}s 自癒）pid=${process.pid}`
);
setInterval(heal, HEAL_INTERVAL_MS);
heal();
