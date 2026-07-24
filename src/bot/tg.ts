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
import { getGeminiResponse, functionHandlers } from "../functions/gemini";
import { getResponseWithContext } from "../functions/llama";
const fs = require("fs");
import axios from "axios";

const bot: Telegraf = new Telegraf(process.env.BOT_TOKEN as string);

let contextChat = [];

try {
    dbConnect();
} catch (error) {
    console.log(error);
}

const initUser = async (ctx) => {
    const chat = await Chat.findOneAndUpdate(
        { id: ctx.chat.id },
        ctx.message.chat,
        {
            upsert: true,
            returnDocument: "after",
        }
    );
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
    await ctx.replyWithPhoto(
        Input.fromURL(`https://picsum.photos/1024/768/?${uuidv4()}`)
    );
});
// Mentions
bot.mention(process.env.BOT_NAME as string, async (ctx) => {
    try {
        const prompt = ctx.message.text.replace(`@${process.env.BOT_NAME}`, "");
        let contextMessages = [];
        // TODO: Limited size of contextMessages
        contextMessages.push({ role: "user", content: prompt });
        contextChat.push({ role: "user", content: prompt });

        let {
            message: reply,
            usage,
            toolCalls,
        } = await getGeminiResponse({
            messages: contextChat.slice(-6),
        });

        // Handle model function calls in a loop (Gemini may make multiple calls)
        let maxToolRounds = 5;
        while (toolCalls && maxToolRounds > 0) {
            maxToolRounds--;
            contextMessages.push({
                role: "assistant",
                content: null,
                tool_calls: toolCalls,
            });
            await Promise.all(
                toolCalls.map(async (toolCall) => {
                    const { name, arguments: args } = toolCall.function;
                    const handler = functionHandlers[name];
                    const functionResult = await handler(JSON.parse(args));
                    contextMessages.push({
                        name,
                        role: "tool",
                        content: JSON.stringify(functionResult),
                        tool_call_id: toolCall.id,
                    });
                })
            );
            const geminiResponse = await getGeminiResponse({
                messages: contextMessages,
            });
            if (geminiResponse.message) {
                reply = geminiResponse.message;
            }
            usage += geminiResponse.usage;
            toolCalls = geminiResponse.toolCalls;
        }

        // Fallback if message is still null after all tool rounds
        if (!reply) reply = "冇嘢想講";

        fs.appendFile(
            "log.log",
            JSON.stringify({ prompt, reply, usage }) + "\n",
            () => {}
        );
        if (reply) {
            contextChat.push({ role: "assistant", content: reply });
        }
        await ctx.reply(`${reply}😭🐷`);
    } catch (error) {
        console.log("🚀 ~ bot.mention ~ error:", error);
        await ctx.reply(`${error.response.data.error.message} 😭🐷`);
    }
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
        await ctx.reply(
            `${user.first_name} | Day${user.day}`,
            Markup.removeKeyboard()
        );
    } else {
        await ctx.reply(
            "你今日咪撳撚左囉，仲撳多次做乜柒姐?",
            Markup.removeKeyboard()
        );
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
    await ctx.reply(
        `${user.first_name} | Day${user.day}`,
        Markup.removeKeyboard()
    );
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

bot.command("llama", async (ctx) => {
    const prompt = ctx.payload.trim();
    const response = await getResponseWithContext(
        prompt,
        contextMessages.slice(-6),
        {}
    );
    await ctx.reply(response.message);
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

bot.hears(/水戶/i, async (ctx) => {
    await ctx.reply(`唔預你住`);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

bot.catch((error) => {
    // handle error
    console.log(error);
});
export default bot;
