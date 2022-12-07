import { Context, Input, Markup, Telegraf } from "telegraf";
import { User, userSchema } from "./models/user";
import { dbConnect, dbDisconnect } from "./db";

import { Update } from "typegram";
import { message } from "telegraf/filters";
import { v4 as uuidv4 } from "uuid";
import { validateJCount } from "./utils";

const bot: Telegraf<Context<Update>> = new Telegraf(
  process.env.BOT_TOKEN as string
);

dbConnect();
bot.start(async (ctx) => {
  console.log({ id: ctx.message.from.id, "chat.id": ctx.chat.id });
  const res = await User.updateOne(
    { id: ctx.message.from.id, "chat.id": ctx.chat.id },
    {
      ...ctx.message.from,
      chat: ctx.message.chat,
      day: 0,
      day_updated_at: new Date(),
    },
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
bot.command("j", (ctx) => {
  ctx.reply(
    "Jed?",
    Markup.inlineKeyboard([
      Markup.button.callback("Yes", "resetDay"),
      Markup.button.callback("No", "updateDay"),
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
  ctx.reply("🤡");
});
// Actions
bot.action("updateDay", async (ctx) => {
    const userId = ctx.update.callback_query.from.id
    const chatId = ctx.update.callback_query.message?.chat.id
  await User.findOne({
    id: userId,
    "chat.id": chatId,
  }).then((obj) => {
    if (!obj) return;
    if (validateJCount(obj.day_updated_at)) {
      User.updateOne(
        { id: userId, "chat.id": chatId },
        {
          day: 999,
          day_updated_at: new Date(),
        }
      );
    } else {
      ctx.reply("You have already updated day today!");
    }
  });
});
bot.action("resetDay", async (ctx) => {
//   await User.findOne({
//     id: ctx.callback_query.from.id,
//     "chat.id": ctx.chat.id,
//   }).then((obj) => {
//     if (!obj) return;
//     User.updateOne(
//       { id: ctx.message.from.id, "chat.id": ctx.chat.id },
//       {
//         day: 999,
//         day_updated_at: new Date(),
//       }
//     );
//   });
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
    if (obj)
      ctx.reply(`${obj.first_name} from ${obj.chat.title} | Day${obj.day}`);
  });
});
bot.hashtag("test", (ctx) => {
  ctx.reply("Tag!");
});
export default bot;
