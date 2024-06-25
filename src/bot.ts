import { Context, Input, Markup, Telegraf } from "telegraf";
import { User, userSchema } from "./models/user";
import { dbConnect, dbDisconnect } from "./db";
import { from, validateJCount } from "./functions/date";

import { Update } from "typegram";
import { message } from "telegraf/filters";
import { v4 as uuidv4 } from "uuid";
import cron from "node-cron";
import hkdayjs from "./utils/dayjs";
import { markSixReminder } from "./functions/marksix";
import { weather } from "./functions/weather";
import axios from "axios";

const bot: Telegraf = new Telegraf(process.env.BOT_TOKEN as string);

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
    console.log("🚀 ~ bot.help ~ ctx:", ctx);
    await ctx.reply("Nothing to help");
});

// Commands
bot.command("quit", async (ctx) => {
    const admins = await bot.telegram.getChatAdministrators(ctx.chat.id);
    if (!admins?.length) return;
    if (admins.some((admin) => admin.user.id === ctx.from.id)) {
        ctx.leaveChat();
    } else {
        await ctx.reply("踢你老母臭");
    }
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
    await ctx.replyWithPhoto(Input.fromURL(`https://picsum.photos/1024/768/?${uuidv4()}`));
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
                user.day_updated_at = hkdayjs();
                user.save();
                if (!users[index + 1]) await ctx.reply(`${user.first_name} | Day${user.day}`);
            } else {
                if (!users[index + 1]) await ctx.reply("你今日咪撳撚左囉，仲撳多次做乜柒姐?");
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
            user.day_updated_at = hkdayjs();
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
            docs.sort((a, b) => b.day - a.day).forEach((user, index) => {
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
    console.log("🚀 ~ bot.command ~ ctx:", ctx);
    await ctx.reply(from(ctx.payload.trim()));
});

bot.command("weather", async (ctx) => {
    const message = await weather();
    await ctx.reply(message);
});

bot.command("marksix", async (ctx) => {
    const message = await markSixReminder();
    await ctx.reply(message);
});

bot.command("jp", async (ctx) => {
    const level = ctx.payload.trim() || 1;
    const response = await axios.get(
        `https://jlpt-vocab-api.vercel.app/api/words/random?level=${level}`
    );
    const message = Object.entries(response.data)
        .map((x) => x.join(": "))
        .join("\n");
    await ctx.reply(message);
});

// const chatId = "gggggg";

// // Schedule the task to run every day at 10 AM
// cron.schedule(
//     "0 0 * * *",
//     async () => {
//         const message = await markSixReminder();
//         bot.telegram.sendMessage(chatId, message);
//     },
//     {
//         scheduled: true,
//         timezone: "Asia/Hong_Kong", // Replace with your timezone
//     }
// );

bot.hears(/test/i, async (ctx) => {
    await ctx.reply(hkdayjs().format("DD/MM/YYYY HH:mm"));
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

bot.catch((error) => {
    // handle error
    console.log(error);
});
export default bot;
