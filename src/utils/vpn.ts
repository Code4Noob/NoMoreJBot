import axios, { AxiosInstance } from "axios";
import http from "http";
import https from "https";

/**
 * VPN-enabled axios instance (Surfshark OpenVPN tunnel).
 *
 * 方法：起 OpenVPN tunnel（route-nopull，唔改 default route），
 * 再將 gemini 嘅 axios socket bind 落 tunnel IP。
 * 配合 scripts/vpn-connect.sh 設定嘅 ip rule，只有來自 tunnel IP 嘅流量會行 VPN。
 *
 * .env 設定：
 *   VPN_TUNNEL_IP=10.14.0.2   (openvpn 連接後 tun 介面嘅 IP)
 *
 * 如果冇設定 VPN_TUNNEL_IP，vpnAxios 會自動 fallback 做普通 axios。
 */
const VPN_TUNNEL_IP = process.env.VPN_TUNNEL_IP;

let vpnAxios: AxiosInstance | typeof axios = axios;

if (VPN_TUNNEL_IP) {
    try {
        vpnAxios = axios.create({
            httpAgent: new http.Agent({ localAddress: VPN_TUNNEL_IP }),
            httpsAgent: new https.Agent({ localAddress: VPN_TUNNEL_IP }),
        });
        console.log(`✅ OpenVPN tunnel enabled (localAddress: ${VPN_TUNNEL_IP})`);
    } catch (err) {
        console.error("❌ OpenVPN tunnel init 失敗，使用普通 axios:", err);
    }
} else {
    console.log("ℹ️ VPN_TUNNEL_IP 未設定，使用普通 axios");
}

export default vpnAxios;
