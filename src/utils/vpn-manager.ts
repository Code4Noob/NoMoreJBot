/**
 * VPN auto-start manager
 *
 * 當 Gemini 回傳 "User location is not supported"（FAILED_PRECONDITION）時，
 * 自動啟動 Surfshark OpenVPN tunnel，再重試 API request。
 *
 * 需要 sudo password 時會喺 bot 嘅 terminal 直接問（stdio inherit），
 * 密碼由 sudo 自己讀入，echo 隱藏，code 完全掂唔到，亦唔會儲低。
 *
 * 特性：
 *   - single-flight：多個 request 同時觸發都只會起一次 VPN
 *   - 失敗 / 取消後 cooldown（5 分鐘），避免不停問
 *   - tunnel 已經起咗就直接 return，唔會再 spawn
 *   - 唔係 terminal 環境（例如 systemd / 背景）會直接失敗，提示手動起 VPN
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { detectTunnelIP } from "./vpn";

let startPromise: Promise<void> | null = null;
let lastFailedAt = 0;

const COOLDOWN_MS = 5 * 60 * 1000; // 失敗後 5 分鐘內唔再自動試
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 20 * 1000;

/**
 * 搵 repo root（裝住 scripts/vpn-connect.js 嘅目錄）。
 * esbuild 會將成個 bundle 收埋入 dist/index.js，所以 __dirname 唔可靠；
 * 優先信 cwd（bot 由 repo root 啟動），fallback 由 __dirname 向上搵。
 */
function findRepoRoot(): string {
    if (fs.existsSync(path.join(process.cwd(), "scripts", "vpn-connect.js"))) {
        return process.cwd();
    }
    let dir = __dirname;
    while (true) {
        if (fs.existsSync(path.join(dir, "scripts", "vpn-connect.js"))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return process.cwd();
}

export function isTunnelUp(): boolean {
    return !!detectTunnelIP();
}

function runVPNConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
        // 要問 sudo password：唔係 terminal 就冇得互動問
        if (!process.stdin.isTTY) {
            reject(
                new Error(
                    "冇 terminal 可以問 sudo password — 請手動執行: sudo node scripts/vpn-connect.js"
                )
            );
            return;
        }

        const nodeBin = process.execPath;
        const repoRoot = findRepoRoot();
        const scriptPath = path.join(repoRoot, "scripts", "vpn-connect.js");

        console.log(
            "🔐 要啟動 VPN — 請喺呢個 terminal 輸入 sudo password（只今次用，唔會儲低）"
        );

        // stdio inherit：sudo 直接喺 terminal 問密碼（echo 隱藏），code 掂唔到密碼
        const proc = spawn("sudo", [nodeBin, scriptPath], {
            cwd: repoRoot,
            stdio: "inherit",
        });

        proc.on("error", (err) => reject(err));

        proc.on("close", (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`VPN 啟動失敗 (exit ${code}) — 詳情見上面 terminal 輸出`));
            }
        });
    });
}

async function waitForTunnel(): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < POLL_TIMEOUT_MS) {
        if (isTunnelUp()) return;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error("tunnel 未就緒（timeout）");
}

/**
 * 確保 VPN tunnel 起咗；起咗就直接 resolve。
 * 失敗會 cooldown，避免不斷重試。
 */
export async function ensureVPN(): Promise<void> {
    if (isTunnelUp()) return;

    const now = Date.now();
    if (now - lastFailedAt < COOLDOWN_MS) {
        throw new Error("VPN auto-start 喺 cooldown 中（之前啟動失敗咗）");
    }

    if (!startPromise) {
        startPromise = (async () => {
            try {
                await runVPNConnect();
                await waitForTunnel();
            } catch (err) {
                lastFailedAt = Date.now();
                throw err;
            } finally {
                startPromise = null;
            }
        })();
    }
    return startPromise;
}
