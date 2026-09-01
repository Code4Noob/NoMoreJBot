// Bun 會自動 load .env，唔使 dotenv
import bot from './bot/tg';
import { dbConnect } from "./db";
import { reloadMarkSixReminders } from "./scheduler/marksix";
import { loadPendingReminders } from "./reminder/reminder";
import { registerBotCommands } from "./bot/commands";

// 長跑 bot 唔可以俾任何 stray rejection / exception 打死（例如 Playwright timeout DOMException）。
// 攔截咗淨係 log，唔好 crash——最壞情況都係嗰個 request 失敗，唔係成個 bot 死。
process.on("unhandledRejection", (reason) => {
    console.log(
        "⚠️ unhandledRejection（已攔截，bot 繼續行）:",
        reason instanceof Error ? reason.stack || reason.message : reason
    );
});
process.on("uncaughtException", (err) => {
    console.log(
        "⚠️ uncaughtException（已攔截，bot 繼續行）:",
        err?.stack || err?.message || err
    );
});

async function main() {
    try {
        // 等 DB 連好先載入 marksix reminder config 並排程
        await dbConnect();
        await reloadMarkSixReminders(bot);
        // 重新排程未 send 嘅 user reminder
        await loadPendingReminders(bot);
    } catch (error) {
        console.log("❌ startup error:", error);
    }
    startBot();
    // 自動註冊 bot commands（setMyCommands，唔使 BotFather）
    registerBotCommands(bot);
}

// bot.launch() 會喺 polling 死咗（網絡錯誤等）時 reject。
// 兜底：reject 就 log 一句，1.5 秒後自動重新 launch，唔好成個 bot 死。
//（真正嘅 ECONNRESET retry 已經由 scripts/patch-telegraf.js 喺 polling 內部處理）
async function startBot() {
    try {
        await bot.launch();
    } catch (err: any) {
        console.log(
            "⚠️ bot polling 終止（網絡/API 錯誤），1.5 秒後自動重啟:",
            err?.message || err
        );
        setTimeout(startBot, 1500);
    }
}

main();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));