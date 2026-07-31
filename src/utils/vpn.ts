import axios, { AxiosInstance } from "axios";
import http from "http";
import https from "https";
import os from "os";

/**
 * VPN-enabled axios instance (Surfshark OpenVPN tunnel).
 *
 * 方法：起 OpenVPN tunnel（route-nopull，唔改 default route），
 * 再將 gemini 嘅 axios socket bind 落 tunnel IP。
 * 配合 scripts/vpn-connect.sh 設定嘅 ip rule，只有來自 tunnel IP 嘅流量會行 VPN。
 *
 * 自動偵測 tun 或 tap interface 嘅 IPv4：
 *   - tunnel 起咗 -> 用 tun IP bind socket，行 VPN
 *   - tunnel 未起 / 唔存在 -> fallback 普通 axios（避免 EADDRNOTAVAIL）
 */
function detectTunnelIP(): string {
    const ifaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(ifaces)) {
        if (/^(tun|tap)\d+/.test(name)) {
            const v4 = addrs?.find((a) => a.family === "IPv4" && !a.internal);
            if (v4) return v4.address;
        }
    }
    return "";
}

// 驗證 IP 係咪存在於本機 interface（唔存在就唔好 bind，避免 EADDRNOTAVAIL）
function isLocalIP(ip: string): boolean {
    const ifaces = os.networkInterfaces();
    for (const addrs of Object.values(ifaces)) {
        if (addrs?.some((a) => a.address === ip && !a.internal)) return true;
    }
    return false;
}

const tunnelIP = detectTunnelIP();
let vpnAxios: AxiosInstance | typeof axios = axios;

if (tunnelIP && isLocalIP(tunnelIP)) {
    try {
        vpnAxios = axios.create({
            httpAgent: new http.Agent({ localAddress: tunnelIP }),
            httpsAgent: new https.Agent({ localAddress: tunnelIP }),
        });
        console.log(`✅ OpenVPN tunnel enabled (localAddress: ${tunnelIP})`);
    } catch (err) {
        console.error("❌ OpenVPN tunnel init 失敗，使用普通 axios:", err);
    }
} else if (tunnelIP) {
    console.log(`⚠️ 偵測到 tunnel IP ${tunnelIP} 但唔存在於本機 interface（tunnel 未起?），使用普通 axios`);
} else {
    console.log("ℹ️ 搵唔到 tun interface，使用普通 axios（tunnel 未起?）");
}

export default vpnAxios;
