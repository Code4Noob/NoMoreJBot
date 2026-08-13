import "dotenv/config";

import bot from './bot/tg';
import { dbConnect } from "./db";
import { reloadMarkSixReminders } from "./scheduler/marksix";

async function main() {
    try {
        // 等 DB 連好先載入 marksix reminder config 並排程
        await dbConnect();
        await reloadMarkSixReminders(bot);
    } catch (error) {
        console.log("❌ startup error:", error);
    }
    bot.launch();
}

main();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));