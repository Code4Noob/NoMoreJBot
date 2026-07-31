/**
 * VPN-enabled axios instance (Surfshark OpenVPN tunnel).
 *
 * 方法：起 OpenVPN tunnel（route-nopull，唔改 default route），
 * 再將 gemini 嘅 axios socket bind 落 tunnel IP。
 * 配合 scripts/vpn-connect.sh 設定嘅 ip rule，只有來自 tunnel IP 嘅流量會行 VPN。
 *
 * 每個 request 都會動態偵測當前 tun/tap interface 嘅 IP：
 *   - tunnel 起咗 -> 用當前 tun IP bind socket，行 VPN（reconnect 後 IP 變都會自動跟）
 *   - tunnel 未起 / 唔存在 -> fallback 普通 axios（避免 EADDRNOTAVAIL / timeout）
 */
import axios from "axios";
import http from "http";
import https from "https";
import os from "os";

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

const vpnAxios = axios.create();

// 每個 request 動態偵測 tunnel IP，reconnect / IP 變更都自動跟
vpnAxios.interceptors.request.use((config) => {
    const ip = detectTunnelIP();
    if (ip && isLocalIP(ip)) {
        config.httpAgent = new http.Agent({ localAddress: ip });
        config.httpsAgent = new https.Agent({ localAddress: ip });
        if (!(global as any).__vpnLogged) {
            console.log(`✅ OpenVPN tunnel enabled (localAddress: ${ip})`);
            (global as any).__vpnLogged = true;
        }
    } else {
        delete config.httpAgent;
        delete config.httpsAgent;
        if (!(global as any).__vpnDownLogged) {
            console.log("⚠️ 搵唔到 tun interface，使用普通 axios（tunnel 未起?）");
            (global as any).__vpnDownLogged = true;
        }
    }
    return config;
});

export default vpnAxios;
