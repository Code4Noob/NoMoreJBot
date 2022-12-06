import "dotenv/config";

import { Context, Input, Markup, Telegraf } from "telegraf";

import { Update } from "typegram";
import { message } from "telegraf/filters";
import { v4 as uuidv4 } from "uuid";

const bot: Telegraf<Context<Update>> = new Telegraf(
  process.env.BOT_TOKEN as string
);

bot.start((ctx) => {
  ctx.reply("Hello " + ctx.from.first_name + "!");
});
bot.help((ctx) => {
  ctx.reply("Nothing to help");
});
// Commands
bot.command("quit", (ctx) => {
  bot.telegram.getChatAdministrators(ctx.chat.id).then((data) => {
    // TODO: admin middleware to allow admin remove bot
    if (!data || !data.length) return;
    if (data.some((admin) => admin.user.id === ctx.from.id)) {
      ctx.telegram.leaveChat(ctx.message.chat.id);
      ctx.leaveChat();
    } else {
      ctx.reply("踢你老母臭");
    }
  }).catch(console.log);
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
// Mentions
bot.mention(process.env.BOT_NAME as string, (ctx)=>{
    ctx.reply('👍');
})
// Actions
bot.action('first', (ctx)=>{
    ctx.reply("first");
})
bot.action('second', (ctx)=>{
    ctx.reply("second");
})
// bot.on(message("sticker"), (ctx) => ctx.reply("👍"));
bot.hears(/\b(hi)\b/i, (ctx) => ctx.reply("Hey there"));

export default bot;