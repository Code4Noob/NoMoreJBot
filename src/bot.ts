import { Context, Input, Markup, Telegraf } from "telegraf";
import { User, userSchema } from "./models/user";
import { dbConnect, dbDisconnect } from "./db";

import { Update } from "typegram";
import { message } from "telegraf/filters";
import { v4 as uuidv4 } from "uuid";

const bot: Telegraf<Context<Update>> = new Telegraf(
  process.env.BOT_TOKEN as string
);

dbConnect();
bot.start(async (ctx) => {
  console.log({ id: ctx.message.from.id, "chat.id": ctx.chat.id });
  const res = await User.updateOne(
    { id: ctx.message.from.id, "chat.id": ctx.chat.id },
    { ...ctx.message.from, chat: ctx.message.chat },
    {
      upsert: true,
    }
  );
  ctx.reply("Hello " + ctx.from.first_name + "!");
});
bot.help((ctx) => {
  ctx.reply("Nothing to help");
});
// Commands
bot.command("quit", (ctx) => {
  bot.telegram
    .getChatAdministrators(ctx.chat.id)
    .then((data) => {
      // TODO: admin middleware to allow admin remove bot
      if (!data || !data.length) return;
      if (data.some((admin) => admin.user.id === ctx.from.id)) {
        ctx.telegram.leaveChat(ctx.message.chat.id);
        ctx.leaveChat();
      } else {
        ctx.reply("踢你老母臭");
      }
    })
    .catch(console.log);
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
bot.mention(process.env.BOT_NAME as string, (ctx) => {
  ctx.reply("👍");
});
// Actions
bot.action("first", (ctx) => {
  ctx.reply("first");
});
bot.action("second", (ctx) => {
  ctx.reply("second");
});
// bot.on(message("sticker"), (ctx) => ctx.reply("👍"));
bot.hears(/\b(hi)\b/i, (ctx) => ctx.reply("Hey there"));
bot.command("users", async (ctx) => {
  // TODO: await, type
  User.find({}, function (err: Error, docs: typeof User[]) {
    docs.forEach((user, index) => {
      ctx.reply(`${index}: ${user.first_name} from ${user.chat.title}`);
    });
  });
});
bot.command("me", async (ctx) => {
  await User.findOne({
    id: ctx.message.from.id,
    "chat.id": ctx.chat.id,
  }).then((obj) => {
    if (obj) ctx.reply(`${obj.first_name} from ${obj.chat.title}`);
  });
});
bot.hashtag("test", (ctx) => {
  ctx.reply("Tag!");
});
export default bot;
