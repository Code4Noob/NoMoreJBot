import "dotenv/config";

import bot from './bot/tg';

bot.launch()

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));