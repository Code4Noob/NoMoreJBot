import { Context, Input, Markup, Telegraf } from "telegraf";
import { User } from "../models/user";
import { Chat } from "../models/chat";
import { dbConnect, dbDisconnect } from "../db";
import { from, validateJCount } from "../functions/date";

import { v4 as uuidv4 } from "uuid";
import cron from "node-cron";
import hkdayjs from "../utils/dayjs";
import { markSixReminder } from "../functions/marksix";
import { weather } from "../functions/weather";
import { getGptResponseWithContext } from "../functions/gpt";
const fs = require("fs");
import axios from "axios";

const bot: Telegraf = new Telegraf(process.env.BOT_TOKEN as string);

const contextMessages = [];
const imContextMessages = {};

try {
    dbConnect();
} catch (error) {
    console.log(error);
}

const initUser = async (ctx) => {
    const chat = await Chat.findOneAndUpdate({ id: ctx.chat.id }, ctx.message.chat, {
        upsert: true,
        returnDocument: "after",
    });
    const user = await User.findOneAndUpdate(
        { id: ctx.message.from.id },
        {
            ...ctx.message.from,
            $addToSet: { chat: chat._id },
            day: 0,
            day_updated_at: null,
        },
        {
            upsert: true,
            returnDocument: "after",
        }
    );
    return user;
};
bot.start(async (ctx) => {
    await initUser(ctx);
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
    await ctx.reply(
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
    const prompt = ctx.message.text.replace(`@${process.env.BOT_NAME}`, "");
    const { message, usage } = await getGptResponseWithContext(prompt, contextMessages.slice(-6), {
        model: "gpt-4o",
    });
    console.log("🚀 ~ const{message,usage}=awaitgetGptResponseWithContext ~ usage:", usage);
    // TODO: Limited size of contextMessages
    contextMessages.push(
        { role: "user", content: prompt },
        { role: "assistant", content: message }
    );
    fs.appendFile("log.log", JSON.stringify({ prompt, message, usage }) + "\n", () => {});
    await ctx.reply(`${message}😭🐷`);
});
// Actions
bot.action("updateDay", async (ctx) => {
    const userId = ctx.update.callback_query.from.id;
    // const chatId = ctx.update.callback_query.message?.chat.id;
    let user = await User.findOne({
        id: userId,
        // "chat.id": chatId,
    });
    if (!user) user = await initUser(ctx);
    if (validateJCount(user.day_updated_at)) {
        user.day = user.day + 1;
        user.day_updated_at = hkdayjs();
        user.save();
        await ctx.reply(`${user.first_name} | Day${user.day}`, Markup.removeKeyboard());
    } else {
        await ctx.reply("你今日咪撳撚左囉，仲撳多次做乜柒姐?", Markup.removeKeyboard());
    }
    await ctx.editMessageReplyMarkup(undefined);
});
bot.action("resetDay", async (ctx) => {
    const userId = ctx.update.callback_query.from.id;
    // const chatId = ctx.update.callback_query.message?.chat.id;
    let user = await User.findOne({
        id: userId,
        // "chat.id": chatId,
    });
    if (!user) user = await initUser(ctx);
    user.day = 0;
    user.day_updated_at = hkdayjs();
    user.save();
    await ctx.reply(`${user.first_name} | Day${user.day}`, Markup.removeKeyboard());
    await ctx.editMessageReplyMarkup(undefined);
});
// bot.on(message("sticker"), (ctx) => ctx.reply("👍"));
bot.command("users", async (ctx) => {
    const chat = await Chat.findOne({ id: ctx.chat.id });
    if (!chat) {
        await initUser(ctx);
        return;
    }
    const medal = ["🥇", "🥈", "🥉"];
    const shit = "💩";
    let usersMsg = `${ctx.message.chat.title}\n`;
    const users = await User.find({ chat: { $in: chat._id } });
    users
        .sort((a, b) => b.day - a.day)
        .forEach((user, index) => {
            let emoji = medal[index] ?? shit;
            usersMsg += `${emoji} Day${user.day} | ${user.first_name}\n`;
        });
    await ctx.reply(usersMsg);
});
bot.command("me", async (ctx) => {
    const user = await User.findOne({
        id: ctx.message.from.id,
    });
    if (user) {
        await ctx.reply(`${user.first_name} | Day${user.day}`);
    } else {
        initUser(ctx);
    }
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

const chatId = "-1001862384479";

// Schedule the task to run every day at 10 AM
cron.schedule(
    "0 0 * * *",
    async () => {
        const message = await markSixReminder();
        bot.telegram.sendMessage(chatId, message);
    },
    {
        scheduled: true,
        timezone: "Asia/Hong_Kong", // Replace with your timezone
    }
);

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
