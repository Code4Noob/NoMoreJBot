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
import { getGeminiResponse, getGeminiImage, functionHandlers } from "../functions/gemini";
import { getResponseWithContext } from "../functions/llama";
const fs = require("fs");
const path = require("path");
import axios from "axios";

const bot: Telegraf = new Telegraf(process.env.BOT_TOKEN as string);

// File-based chat history: chat/history/{chatId}.txt
const HISTORY_DIR = path.resolve(process.cwd(), "chat/history");
const MAX_HISTORY_LINES = 200;

function getHistoryPath(chatId: string | number): string {
    return path.join(HISTORY_DIR, `${String(chatId)}.txt`);
}

function appendToHistory(chatId: string | number, name: string, text: string): void {
    const filePath = getHistoryPath(chatId);
    // Flatten multi-line messages into a single line
    const flatText = text.replace(/\r?\n|\r/g, " ");
    const line = `[${name}]: ${flatText}\n`;
    try {
        fs.appendFileSync(filePath, line, "utf-8");
    } catch (err) {
        console.error("❌ appendToHistory 失敗:", err);
    }
}

function getRecentHistory(chatId: string | number, maxLines: number = 30): string {
    const filePath = getHistoryPath(chatId);
    try {
        if (!fs.existsSync(filePath)) return "";
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);
        const recent = lines.slice(-maxLines);
        return recent.join("\n");
    } catch (err) {
        console.error("❌ getRecentHistory 失敗:", err);
        return "";
    }
}

// In-memory bot-AI conversation context (separate from raw file-based chat history)
const contextChatMap = new Map<string, any[]>();

function getContextChat(chatId: string | number): any[] {
    if (!contextChatMap.has(String(chatId))) {
        contextChatMap.set(String(chatId), []);
    }
    return contextChatMap.get(String(chatId))!;
}

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
// Handle photos with caption mentioning the bot
bot.on("photo", async (ctx: any) => {
    const caption = ctx.message?.caption || "";
    const botName = process.env.BOT_NAME || "";
    if (!caption.includes(`@${botName}`)) return;

    try {
        const userName = ctx.message.from?.first_name || ctx.message.from?.username || "User";
        const chatName = ctx.chat?.title || ctx.chat?.id || "Unknown";
        const chatId = ctx.chat.id;
        const cleanCaption = caption.replace(`@${botName}`, "").trim();

        // Get the largest photo (last in array)
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);

        // Download and convert to base64 (Telegram photos are always JPEG)
        const imgResp = await axios.get(fileLink.href, { responseType: "arraybuffer" });
        const base64 = Buffer.from(imgResp.data).toString("base64");
        const mimeType = "image/jpeg";

        const prompt = cleanCaption || "幫我睇下呢張圖片";
        const recentHistory = getRecentHistory(chatId, 30);
        let userMessage = prompt;
        if (recentHistory) {
            userMessage = `[Recent messages in this group]:\n${recentHistory}\n\n[Chat: ${chatName}] [${userName}]: ${prompt}`;
        } else {
            userMessage = `[Chat: ${chatName}] [${userName}]: ${prompt}`;
        }

        appendToHistory(chatId, userName, `[圖片] ${prompt}`);

        const chatContext = getContextChat(ctx.chat.id);
        chatContext.push({
            role: "user",
            content: userMessage,
            imageData: { mimeType, data: base64 },
        });

        const { message: reply, usage } = await getGeminiResponse({
            messages: chatContext.slice(-6),
        });

        const finalReply = reply || "睇唔到張圖 😭🐷";
        if (finalReply) {
            chatContext.push({ role: "assistant", content: finalReply });
            appendToHistory(chatId, "Bot", finalReply);
        }

        await ctx.reply(`${finalReply}😭🐷`);
    } catch (error: any) {
        console.log("🚀 ~ photo handler error:", error);
        await ctx.reply(`睇圖出錯: ${error.message} 😭🐷`);
    }
});

// Mentions
bot.mention(process.env.BOT_NAME as string, async (ctx) => {
    try {
        const prompt = ctx.message.text.replace(`@${process.env.BOT_NAME}`, "");
        const userName = ctx.message.from.first_name || ctx.message.from.username || "User";
        const chatName = ctx.chat?.title || ctx.chat?.id || "Unknown";
        const chatId = ctx.chat.id;

        // Build recent messages context from file-based history
        const recentHistory = getRecentHistory(chatId, 30);
        let userMessage = "";
        if (recentHistory) {
            userMessage = `[Recent messages in this group]:\n${recentHistory}\n\n[Chat: ${chatName}] [${userName}]: ${prompt}`;
        } else {
            userMessage = `[Chat: ${chatName}] [${userName}]: ${prompt}`;
        }

        // Also store the mention message in file-based history
        appendToHistory(chatId, userName, prompt.trim() || "(mentioned bot)");

        let contextMessages = [];
        // TODO: Limited size of contextMessages
        contextMessages.push({ role: "user", content: userMessage });
        const chatContext = getContextChat(ctx.chat.id);
        chatContext.push({ role: "user", content: userMessage });

        let {
            message: reply,
            usage,
            toolCalls,
        } = await getGeminiResponse({
            messages: chatContext.slice(-6),
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
            chatContext.push({ role: "assistant", content: reply });
            // Also store bot reply in file-based history
            appendToHistory(chatId, "Bot", reply);
        }

        // 🎨 檢查 AI 回覆是否包含圖片生成指令
        // 匹配 "gen image <描述>" (skill.md 格式) 或 "***gen image*** <描述>" (舊格式)
        const genImageRegex = /(?:\*\*\*)?\s*gen image\s*(?:\*\*\*)?\s+(.+)/i;
        const genImageMatch = reply.match(genImageRegex);

        if (genImageMatch) {
            const imagePrompt = genImageMatch[1].trim();
            const cleanReply = reply.replace(genImageRegex, "").trim();

            try {
                await ctx.reply("畫緊...😭🐷");
                const { text, imageData } = await getGeminiImage({ prompt: imagePrompt });
                if (imageData) {
                    const buffer = Buffer.from(imageData.data, "base64");
                    await ctx.replyWithPhoto(
                        { source: buffer },
                        { caption: cleanReply || text ? `${cleanReply || text}😭🐷` : "😭🐷" }
                    );
                } else {
                    await ctx.reply(text ? `${text}😭🐷` : "畫唔到😭🐷");
                }
            } catch (genError: any) {
                console.log("🚀 ~ gen image error:", genError);
                await ctx.reply(`畫唔到: ${genError?.response?.data?.error?.message || genError.message} 😭🐷`);
            }
        } else {
            await ctx.reply(`${reply}😭🐷`);
        }
    } catch (error) {
        console.log("🚀 ~ bot.mention ~ error:", error);
        await ctx.reply(`${error.response.data.error.message} 😭🐷`);
    }
});
// Listen to all messages to build file-based chat history (requires bot privacy mode disabled)
bot.on("message", (ctx: any, next: any) => {
    const chatId = ctx.chat?.id;
    const msgText = ctx.message?.text;
    if (!chatId || !msgText) return next?.();
    const isBot = ctx.message.from?.id === ctx.botInfo?.id;
    const name = isBot ? "Bot" : (ctx.message.from?.first_name || ctx.message.from?.username || "Unknown");
    appendToHistory(chatId, name, msgText);
    next?.();
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
    try {
        const response = await axios.get(
            `https://jlpt-vocab-api.vercel.app/api/words/random?level=${level}`
        );
        const message = Object.entries(response.data)
            .map((x) => x.join(": "))
            .join("\n");
        await ctx.reply(message);
    } catch (error: any) {
        console.log("🚀 ~ jp error:", error?.response?.data || error.message);
        await ctx.reply(`JP 查唔到: ${error?.response?.data?.error || error.message} 😭🐷`);
    }
});

bot.command("draw", async (ctx) => {
    const prompt = ctx.payload.trim();
    if (!prompt) {
        await ctx.reply("畫咩撚嘢？俾個描述嚟先😭🐷");
        return;
    }
    try {
        await ctx.reply("畫緊...😭🐷");
        const { text, imageData } = await getGeminiImage({ prompt });
        if (imageData) {
            const buffer = Buffer.from(imageData.data, "base64");
            await ctx.replyWithPhoto(
                { source: buffer },
                { caption: text ? `${text}😭🐷` : "😭🐷" }
            );
        } else {
            await ctx.reply(text ? `${text}😭🐷` : "畫唔到😭🐷");
        }
    } catch (error: any) {
        console.log("🚀 ~ bot.command draw ~ error:", error);
        await ctx.reply(`畫唔到: ${error?.response?.data?.error?.message || error.message} 😭🐷`);
    }
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
