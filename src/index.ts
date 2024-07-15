import "dotenv/config";

import bot from './bot/tg';
import app from './bot/slack';

bot.launch()
app.start()

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));