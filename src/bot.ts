import { Context, Input, Markup, Telegraf } from "telegraf";
import { User, userSchema } from "./models/user";
import { dbConnect, dbDisconnect } from "./db";
import { fromNow, validateJCount } from "./utils";

import { Update } from "typegram";
import { message } from "telegraf/filters";
import moment from "moment-timezone";
import { v4 as uuidv4 } from "uuid";

moment.tz.setDefault("Asia/Taipei");

const bot: Telegraf<Context<Update>> = new Telegraf(
  process.env.BOT_TOKEN as string
);

dbConnect();
const closeKeyboard = async (ctx: Context) => {
  await ctx.editMessageReplyMarkup({
    reply_markup: { remove_keyboard: true },
  });
};
bot.start(async (ctx) => {
  const res = await User.updateOne(
    { id: ctx.message.from.id, "chat.id": ctx.chat.id },
    {
      ...ctx.message.from,
      chat: ctx.message.chat,
      day: 0,
      day_updated_at: null,
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
bot.command("dummy", async (ctx) => {
  const res = await User.updateOne(
    { id: Math.floor(Math.random() * 100), "chat.id": ctx.chat.id },
    {
      ...ctx.message.from,
      chat: ctx.message.chat,
      day: Math.floor(Math.random() * 100),
      day_updated_at: null,
    },
    {
      upsert: true,
    }
  );
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
  const userId = ctx.update.callback_query.from.id;
  const chatId = ctx.update.callback_query.message?.chat.id;
  await User.findOne({
    id: userId,
    "chat.id": chatId,
  }).then(async (obj) => {
    if (!obj) return;
    if (validateJCount(obj.day_updated_at)) {
      obj.day = obj.day + 1;
      obj.day_updated_at = moment();
      obj.save();
      ctx.reply(`${obj.first_name} from ${obj.chat.title} | Day${obj.day}`);
    } else {
      ctx.reply("You have already updated day today!");
    }
    closeKeyboard(ctx);
  });
});
bot.action("resetDay", async (ctx) => {
  const userId = ctx.update.callback_query.from.id;
  const chatId = ctx.update.callback_query.message?.chat.id;
  await User.findOne({
    id: userId,
    "chat.id": chatId,
  }).then((obj) => {
    if (!obj) return;
    obj.day = 0;
    obj.day_updated_at = moment();
    obj.save();
    ctx.reply(`${obj.first_name} | Day${obj.day}`);
  });
  closeKeyboard(ctx);
});
// bot.on(message("sticker"), (ctx) => ctx.reply("👍"));
bot.hears(/\b(hi)\b/i, (ctx) => ctx.reply("Hey there"));
bot.command("users", async (ctx) => {
  // TODO: await, type
  const medal = ["🥇", "🥈", "🥉"];
  const shit = "💩";
  let usersMsg = `${ctx.message.chat.title}\n`;
  // TODO: should not use clone?
  await User.find(
    { "chat.id": ctx.message.chat.id },
    function (err: Error, docs: typeof User[]) {
      docs
        .sort((a, b) => b.day - a.day)
        .forEach((user, index) => {
          let emoji = medal[index] ?? shit;
          usersMsg += `${emoji} Day${user.day} | ${user.first_name}\n`;
        });
      ctx.reply(usersMsg);
    }
  ).clone();
});
bot.command("me", async (ctx) => {
  await User.findOne({
    id: ctx.message.from.id,
    "chat.id": ctx.chat.id,
  }).then((obj) => {
    if (obj) ctx.reply(`${obj.first_name} | Day${obj.day}`);
  });
});
bot.command("from", async (ctx) => {
  ctx.reply(fromNow(ctx.message.text.replace("/from", "").trim()));
});
bot.hashtag("test", (ctx) => {
  ctx.reply("Tag!");
});
export default bot;
