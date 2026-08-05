import { Context, Input, Markup, Telegraf } from "telegraf";
import { User } from "../models/user";
import { Chat } from "../models/chat";
import { dbConnect, dbDisconnect } from "../db";
import { from, validateJCount } from "../tools/date";

import { v4 as uuidv4 } from "uuid";
import cron from "node-cron";
import hkdayjs from "../utils/dayjs";
import { markSixReminder } from "../tools/marksix";
import { weather } from "../tools/weather";
import { describeSticker, backfillStickerCache, resolveStickerId } from "../tools/sticker";
import { getAIResponse, getGeminiImage, functionHandlers } from "../ai";
import { getSystemPrompt, saveUserSkill } from "../ai/skill";
const fs = require("fs");
const path = require("path");
import axios from "axios";

const bot: Telegraf = new Telegraf(process.env.BOT_TOKEN as string);

// 啟動時為舊 sticker cache entry 補返 fileId（俾 get_cached_stickers 用到）
backfillStickerCache(bot.telegram).catch((err) =>
    console.log("⚠️ sticker cache backfill 失敗:", err?.message || err)
);

// File-based chat history: chat/history/{chatId}.txt
const HISTORY_DIR = path.resolve(process.cwd(), "chat/history");
// 檔案最大行數（超過就刪舊嘅）
const MAX_HISTORY_LINES = parseInt(process.env.MAX_HISTORY_LINES || "200", 10);
// 每次送俾 AI 嘅 context 行數
const CONTEXT_SIZE = parseInt(process.env.CHAT_CONTEXT_SIZE || "30", 10);

function getHistoryPath(chatId: string | number): string {
    return path.join(HISTORY_DIR, `${String(chatId)}.txt`);
}

function trimHistoryFile(filePath: string): void {
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n").filter(Boolean);
        if (lines.length > MAX_HISTORY_LINES) {
            const trimmed = lines.slice(-MAX_HISTORY_LINES).join("\n") + "\n";
            fs.writeFileSync(filePath, trimmed, "utf-8");
        }
    } catch (err) {
        console.error("❌ trimHistoryFile 失敗:", err);
    }
}

function appendToHistory(chatId: string | number, name: string, text: string): void {
    const filePath = getHistoryPath(chatId);
    // Flatten multi-line messages into a single line
    const flatText = text.replace(/\r?\n|\r/g, " ");
    const line = `[${name}]: ${flatText}\n`;
    try {
        fs.appendFileSync(filePath, line, "utf-8");
        // 超過上限就刪舊 history
        trimHistoryFile(filePath);
    } catch (err) {
        console.error("❌ appendToHistory 失敗:", err);
    }
}

function getRecentHistory(chatId: string | number, maxLines: number = CONTEXT_SIZE): string {
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
        const cleanCaption = caption.replace(`@${botName}`, "").trim();

        // Get the largest photo (last in array)
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);

        // Download and convert to base64 (Telegram photos are always JPEG)
        const imgResp = await axios.get(fileLink.href, { responseType: "arraybuffer" });
        const imageData = {
            mimeType: "image/jpeg",
            data: Buffer.from(imgResp.data).toString("base64"),
        };

        // 重用共用 AI flow（連 reply_to / 歷史 / tool calling 都有）
        await handleAIRequest(ctx, { prompt: cleanCaption || "幫我睇下呢張圖片", imageData });
    } catch (error: any) {
        console.log("🚀 ~ photo handler error:", error);
        await ctx.reply(`睇圖出錯: ${error.message}`);
    }
});

// 共用 AI 對話流程（mention / reply-to-bot / photo 都用）
async function handleAIRequest(ctx: any, opts?: { prompt?: string; imageData?: { mimeType: string; data: string } | null }) {
    try {
        const prompt = (opts?.prompt ?? ctx.message.text.replace(`@${process.env.BOT_NAME}`, "")).trim();
        const userName = ctx.message.from.first_name || ctx.message.from.username || "User";
        const chatName = ctx.chat?.title || ctx.chat?.id || "Unknown";
        const chatId = ctx.chat.id;

        // 🗨️ Handle reply_to_message context (text / image)
        const replyTo = ctx.message.reply_to_message;
        let replyText = "";
        let replyImageData: { mimeType: string; data: string } | null = null;
        if (replyTo) {
            const replyName = replyTo.from?.first_name || replyTo.from?.username || "用戶";
            if (replyTo.text) {
                replyText = `[引用咗 ${replyName} 嘅訊息]: ${replyTo.text}\n\n`;
            } else if (replyTo.photo && replyTo.photo.length > 0) {
                replyText = `[引用咗 ${replyName} 嘅圖片]\n\n`;
                try {
                    const photo = replyTo.photo[replyTo.photo.length - 1];
                    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
                    const imgResp = await axios.get(fileLink.href, { responseType: "arraybuffer" });
                    replyImageData = {
                        mimeType: "image/jpeg",
                        data: Buffer.from(imgResp.data).toString("base64"),
                    };
                } catch (err: any) {
                    console.log("⚠️ reply-to 圖片下載失敗:", err?.message || err);
                }
            } else if (replyTo.sticker) {
                try {
                    const stickerMeaning = await describeSticker(replyTo.sticker, ctx.telegram);
                    replyText = `[引用咗 ${replyName} 嘅貼圖]: ${stickerMeaning}\n\n`;
                } catch (err: any) {
                    console.log("⚠️ reply-to 貼圖辨識失敗:", err?.message || err);
                }
            }
        }

        // Build recent messages context from file-based history
        const recentHistory = getRecentHistory(chatId);
        const baseMsg = `${replyText}[Chat: ${chatName}] [${userName}]: ${prompt}`;
        let userMessage = "";
        if (recentHistory) {
            userMessage = `[Recent messages in this group]:\n${recentHistory}\n\n${baseMsg}`;
        } else {
            userMessage = baseMsg;
        }

        // Also store the mention message in file-based history
        appendToHistory(chatId, userName, prompt.trim() || "(mentioned bot)");

        let contextMessages: any[] = [];
        // TODO: Limited size of contextMessages
        contextMessages.push({ role: "user", content: userMessage });
        const chatContext = getContextChat(ctx.chat.id);
        const chatMsg: any = { role: "user", content: userMessage };
        const imgData = opts?.imageData ?? replyImageData;
        if (imgData) chatMsg.imageData = imgData;
        chatContext.push(chatMsg);

        let {
            message: reply,
            usage,
            toolCalls,
        } = await getAIResponse({
            messages: chatContext.slice(-6),
            systemPrompt: getSystemPrompt(ctx.from?.id),
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
            const geminiResponse = await getAIResponse({
                messages: contextMessages,
                systemPrompt: getSystemPrompt(ctx.from?.id),
            });
            if (geminiResponse.message) {
                reply = geminiResponse.message;
            }
            usage += geminiResponse.usage;
            toolCalls = geminiResponse.toolCalls;
        }

        // Fallback if message is still null after all tool rounds
        if (!reply) reply = "冇嘢想講";

        // 🧠 處理 [user_skill]: 更新對某 user 嘅專屬人格
        const userSkillIdx = reply.indexOf("[user_skill]:");
        if (userSkillIdx !== -1 && ctx.from?.id) {
            const content = reply.slice(userSkillIdx + "[user_skill]:".length).trim();
            if (content) saveUserSkill(ctx.from.id, content);
            // 剝走 marker 同內容，淨係顯示原本嘅回覆
            reply = reply.slice(0, userSkillIdx).trim() || "已更新對你嘅專屬人格";
        }

        fs.appendFile(
            path.join(process.cwd(), "log/log.log"),
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

        // 😭🐷 檢查 AI 回覆是否包含 [sticker]: <stickerId> —— bot 自動派嗰張貼圖
        const stickerRegex = /\[sticker\]:\s*([A-Za-z0-9_\-]+)/i;
        const stickerMatch = reply.match(stickerRegex);

        if (genImageMatch) {
            const imagePrompt = genImageMatch[1].trim();
            const cleanReply = reply.replace(genImageRegex, "").trim();

            try {
                await ctx.reply("畫緊...");
                const { text, imageData } = await getGeminiImage({ prompt: imagePrompt });
                if (imageData) {
                    const buffer = Buffer.from(imageData.data, "base64");
                    await ctx.replyWithPhoto(
                        { source: buffer },
                        { caption: cleanReply || text ? `${cleanReply || text}` : undefined }
                    );
                } else {
                    await ctx.reply(text ? `${text}` : "畫唔到");
                }
            } catch (genError: any) {
                console.log("🚀 ~ gen image error:", genError);
                await ctx.reply(`畫唔到: ${genError?.response?.data?.error?.message || genError.message}`);
            }
        } else if (stickerMatch) {
            const stickerId = stickerMatch[1].trim();
            const cleanReply = reply.replace(stickerRegex, "").trim();
            try {
                // AI 用嘅係 short id（file_unique_id），resolve 返真實 file_id；
                // 就算 AI 直接俾咗 file_id 都得（fallback）
                const realFileId = resolveStickerId(stickerId) || stickerId;
                // 有文字就出埋文字，之後派貼圖
                if (cleanReply) await ctx.reply(`${cleanReply}`);
                await ctx.replyWithSticker(realFileId);
            } catch (stickerErr: any) {
                console.log("🚀 ~ sticker reply error:", stickerErr);
                await ctx.reply(`貼圖派唔到: ${stickerErr?.message || "未知錯誤"}`);
            }
        } else {
            await ctx.reply(`${reply}`);
        }
    } catch (error: any) {
        console.log("🚀 ~ bot.mention ~ error:", error?.message || error);
        const errMsg = error?.response?.data?.error?.message || error?.response?.data || error?.message || "未知錯誤";
        await ctx.reply(`${errMsg}`).catch(() => {});
    }
}

// Mentions
bot.mention(process.env.BOT_NAME as string, (ctx: any) => handleAIRequest(ctx));

// Direct message / reply-to-bot 都會 AI 回應（即使冇 @bot）
bot.on("text", (ctx: any, next: any) => {
    const text = ctx.message?.text || "";
    const isCommand = text.startsWith("/"); // commands 留返俾 bot.command() 處理
    const isPrivate = ctx.chat?.type === "private"; // 私訊 bot 唔使 @
    const replyTo = ctx.message?.reply_to_message;
    const repliedToBot = !!replyTo && !!ctx.botInfo && replyTo.from?.id === ctx.botInfo.id;
    const alreadyMentions = text.includes(`@${process.env.BOT_NAME}`);

    if (!isCommand && (isPrivate || (repliedToBot && !alreadyMentions))) {
        handleAIRequest(ctx);
    } else {
        next?.();
    }
});

// Listen to all messages to build file-based chat history (requires bot privacy mode disabled)
bot.on("message", async (ctx: any, next: any) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return next?.();
    const isBot = ctx.message.from?.id === ctx.botInfo?.id;
    const name = isBot ? "Bot" : (ctx.message.from?.first_name || ctx.message.from?.username || "Unknown");

    // 貼圖：辨識內容（有 cache）後寫入 history，等 AI 之後睇得明貼圖講咩
    const sticker = ctx.message?.sticker;
    if (sticker) {
        try {
            const meaning = await describeSticker(sticker, ctx.telegram);
            // 標明 (貼圖)，等 AI 讀 history 時知呢行係貼圖內容而唔係普通文字
            appendToHistory(chatId, name, `(貼圖) ${meaning}`);
        } catch (err: any) {
            console.log("❌ sticker history 失敗:", err?.message || err);
        }
        return next?.();
    }

    const msgText = ctx.message?.text;
    if (!msgText) return next?.();
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
        await ctx.reply(`JP 查唔到: ${error?.response?.data?.error || error.message}`);
    }
});

bot.command("draw", async (ctx) => {
    const prompt = ctx.payload.trim();
    if (!prompt) {
        await ctx.reply("畫咩撚嘢？俾個描述嚟先");
        return;
    }
    try {
        await ctx.reply("畫緊...");
        const { text, imageData } = await getGeminiImage({ prompt });
        if (imageData) {
            const buffer = Buffer.from(imageData.data, "base64");
            await ctx.replyWithPhoto(
                { source: buffer },
                { caption: text ? `${text}` : undefined }
            );
        } else {
            await ctx.reply(text ? `${text}` : "畫唔到");
        }
    } catch (error: any) {
        console.log("🚀 ~ bot.command draw ~ error:", error);
        await ctx.reply(`畫唔到: ${error?.response?.data?.error?.message || error.message}`);
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
