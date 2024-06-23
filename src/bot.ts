import { Context, Input, Markup, Telegraf } from "telegraf";
import { User, userSchema } from "./models/user";
import { dbConnect, dbDisconnect } from "./db";
import { fromNow, validateJCount } from "./utils";

import { Update } from "typegram";
import axios from "axios";
import { message } from "telegraf/filters";
import moment from "moment-timezone";
import { v4 as uuidv4 } from "uuid";

import { parseFromString } from "dom-parser";

moment.tz.setDefault("Asia/Taipei");

const bot: Telegraf<Context<Update>> = new Telegraf(
  process.env.BOT_TOKEN as string
);

try {
  dbConnect();
} catch (error) {
  console.log(error);
}

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
  await ctx.reply("Hello " + ctx.from.first_name + "!");
});
bot.help(async (ctx) => {
  await ctx.reply("Nothing to help");
});
// bot.command("dummy", async (ctx) => {
//   const res = await User.updateOne(
//     { id: Math.floor(Math.random() * 100), "chat.id": ctx.chat.id },
//     {
//       ...ctx.message.from,
//       chat: ctx.message.chat,
//       day: Math.floor(Math.random() * 100),
//       day_updated_at: null,
//     },
//     {
//       upsert: true,
//     }
//   );
// });
// Commands
bot.command("quit", async (ctx) => {
  bot.telegram
    .getChatAdministrators(ctx.chat.id)
    .then(async (data) => {
      // TODO: admin middleware to allow admin remove bot
      if (!data || !data.length) return;
      if (data.some((admin) => admin.user.id === ctx.from.id)) {
        ctx.telegram.leaveChat(ctx.message.chat.id);
        ctx.leaveChat();
      } else {
        await ctx.reply("踢你老母臭");
      }
    })
    .catch(console.log);
});
bot.command("j", async (ctx) => {
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
bot.mention(process.env.BOT_NAME as string, async (ctx) => {
  ctx.reply("🤡");
});
// Actions
bot.action("updateDay", async (ctx) => {
  const userId = ctx.update.callback_query.from.id;
  // const chatId = ctx.update.callback_query.message?.chat.id;
  await User.find({
    id: userId,
    // "chat.id": chatId,
  }).then(async (users) => {
    if (!users) return;
    users.map(async (user, index) => {
      if (validateJCount(user.day_updated_at)) {
        user.day = user.day + 1;
        user.day_updated_at = moment().toDate();
        user.save();
        if (!users[index + 1])
          await ctx.reply(`${user.first_name} | Day${user.day}`);
      } else {
        if (!users[index + 1]) await ctx.reply("咪撳撚左囉，仲撳多次做乜柒姐?");
      }
    });
    closeKeyboard(ctx);
  });
});
bot.action("resetDay", async (ctx) => {
  const userId = ctx.update.callback_query.from.id;
  // const chatId = ctx.update.callback_query.message?.chat.id;
  await User.find({
    id: userId,
    // "chat.id": chatId,
  }).then(async (users) => {
    if (!users) return;
    users.map(async (user, index) => {
      user.day = 0;
      user.day_updated_at = moment().toDate();
      user.save();
    });
    await ctx.reply(`${users[0].first_name} | Day${users[0].day}`);
  });
  closeKeyboard(ctx);
});
// bot.on(message("sticker"), (ctx) => ctx.reply("👍"));
bot.command("users", async (ctx) => {
  // TODO: await, type
  const medal = ["🥇", "🥈", "🥉"];
  const shit = "💩";
  let usersMsg = `${ctx.message.chat.title}\n`;
  // TODO: should not use clone?
  await User.find(
    { "chat.id": ctx.message.chat.id },
    async function (err: Error, docs: (typeof User)[]) {
      docs
        .sort((a, b) => b.day - a.day)
        .forEach((user, index) => {
          let emoji = medal[index] ?? shit;
          usersMsg += `${emoji} Day${user.day} | ${user.first_name}\n`;
        });
      await ctx.reply(usersMsg);
    }
  ).clone();
});
bot.command("me", async (ctx) => {
  await User.findOne({
    id: ctx.message.from.id,
    "chat.id": ctx.chat.id,
  }).then(async (obj) => {
    if (obj) await ctx.reply(`${obj.first_name} | Day${obj.day}`);
  });
});
bot.command("from", async (ctx) => {
  await ctx.reply(fromNow(ctx.message.text.replace("/from", "").trim()));
});
bot.command("outlook", async (ctx) => {
  axios
    .get(
      "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=flw&lang=tc"
    )
    .then(async function (response) {
      await ctx.reply(
        Object.values(response.data)
          .filter((value) => value !== "")
          .join("\n")
      );
    });
});
bot.hears(/掛住/i, async (ctx) => await ctx.reply("掛住你"));
bot.hashtag("test", async (ctx) => {
  await ctx.reply("Tag!");
});
bot.command("marksix", async (ctx) => {
  setInterval(async () => {
    const html = await (
      await fetch("https://bet.hkjc.com/marksix/index.aspx?lang=ch")
    ).text();
    const dom = parseFromString(html);
    const snowball = dom.getElementsByClassName("snowball1");
    const result = snowball.map(
      (node, index) =>
        `${index ? "估計頭獎基金" : "多寶 / 金多寶"}: ${
          node.childNodes[0].text
        }`
    );
    await ctx.reply(`${result.join("\n")}`);
  }, 5000);
});
bot.catch((error) => {
  // handle error
  console.log(error);
});
export default bot;
