import "dotenv/config";

import { Context, Input, Markup, Telegraf } from "telegraf";
import { InlineQueryResult, Update } from "typegram";

import { message } from "telegraf/filters";
import { v4 as uuidv4 } from "uuid";

const bot: Telegraf<Context<Update>> = new Telegraf(
  process.env.BOT_TOKEN as string
);

bot.start((ctx) => {
  ctx.reply("Hello " + ctx.from.first_name + "!");
});
bot.help((ctx) => {
  ctx.reply("Send /start to receive a greeting");
  ctx.reply("Send /keyboard to receive a message with a keyboard");
  ctx.reply("Send /quit to stop the bot");
});
bot.command("quit", (ctx) => {
  // Explicit usage
  ctx.telegram.leaveChat(ctx.message.chat.id);
  // Context shortcut
  ctx.leaveChat();
});
bot.command("keyboard", (ctx) => {
  ctx.reply(
    "Keyboard",
    Markup.inlineKeyboard([
      Markup.button.callback("First option", "first"),
      Markup.button.callback("Second option", "second"),
    ])
  );
});
bot.command("picture", async (ctx) => {
  await ctx.replyWithPhoto(
    Input.fromURL(`https://picsum.photos/1024/768/?${uuidv4()}`)
  );
});
bot.on('inline_query', async (ctx) => {
    const result: readonly InlineQueryResult[] = [];
    // Using context shortcut
    await ctx.answerInlineQuery(result);
});
// bot.on(message("sticker"), (ctx) => ctx.reply("👍"));
bot.hears("hi", (ctx) => ctx.reply("Hey there"));

export default bot;