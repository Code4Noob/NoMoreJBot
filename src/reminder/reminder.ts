import { Markup, Telegraf } from "telegraf";
import dayjs from "dayjs";
import hkdayjs from "../utils/dayjs"; // 確保 utc / timezone / customParseFormat plugin 已載入
import { Reminder } from "../models/reminder";

// ---------- scheduler ----------
const timers = new Map<string, NodeJS.Timeout>();

// 啟動時 load 未 send 嘅 reminder 重新排程（bot restart 都唔會走漏）
async function loadPendingReminders(bot: Telegraf): Promise<void> {
    const now = new Date();
    // 已過期未 send 嘅：restart 後補 send（標明遲咗），唔會無聲無息無咗
    const overdue = await Reminder.find({
        delivered: false,
        remindAt: { $lte: now },
    });
    for (const r of overdue) {
        try {
            await bot.telegram.sendMessage(
                r.chatId,
                `⏰ <a href="tg://user?id=${r.userId}">${r.name || "你"}</a> 提醒你（遲咗）：${r.text}`,
                { parse_mode: "HTML" }
            );
        } catch (err: any) {
            console.log("⏰ overdue reminder send 失敗:", err?.message || err);
        }
        await Reminder.updateOne({ _id: r._id }, { delivered: true });
    }
    // 未到期嘅照常排程
    const upcoming = await Reminder.find({
        delivered: false,
        remindAt: { $gt: now },
    });
    for (const r of upcoming) scheduleReminder(bot, r);
}

function scheduleReminder(bot: Telegraf, reminder: any): void {
    const delay = Math.max(
        new Date(reminder.remindAt).getTime() - Date.now(),
        0
    );
    const key = String(reminder._id);
    if (timers.has(key)) clearTimeout(timers.get(key));
    const timer = setTimeout(async () => {
        timers.delete(key);
        try {
            await bot.telegram.sendMessage(
                reminder.chatId,
                `⏰ <a href="tg://user?id=${reminder.userId}">${reminder.name || "你"}</a> 提醒你：${reminder.text}`,
                { parse_mode: "HTML" }
            );
        } catch (err: any) {
            console.log("⏰ reminder send 失敗:", err?.message || err);
        }
        await Reminder.updateOne({ _id: reminder._id }, { delivered: true });
    }, delay);
    timers.set(key, timer);
}

// ---------- wizard（date / time picker） ----------
// 每個 user 嘅臨時 draft（未入 DB，揀完時間確認先 create）
type Draft = {
    chatId: number;
    text: string;
    date?: string;
    hour?: number;
    minute?: number;
};
const pending = new Map<number, Draft>();

const pad = (n: number): string => String(n).padStart(2, "0");

// 將 "YYYY-MM-DD HH:mm" 當做香港時間 parse（避免 local tz 偏移）
const parseHk = (s: string) =>
    dayjs.tz(s, "YYYY-MM-DD HH:mm", "Asia/Hong_Kong");

// 第一個 message 用 reply，之後所有步驟 edit 同一個 message（淨係用一個 message 做晒）
// 完成 / 取消嗰陣 editMessageText 會自動剷走啲 button（auto-close）
async function render(ctx: any, text: string, extra: any): Promise<void> {
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, extra);
    } else {
        await ctx.reply(text, extra);
    }
}

function registerReminderWizard(bot: Telegraf): void {
    // /reminder [text]
    bot.command("reminder", async (ctx: any) => {
        const text = (ctx.payload || "").trim();
        pending.set(ctx.from.id, { chatId: ctx.chat.id, text });
        if (text) {
            await showDatePicker(ctx);
        } else {
            await ctx.reply(
                "📝 想我提你啲咩？直接打低要提醒嘅內容（例如「買麵包」）"
            );
        }
    });

    // 揀日期
    bot.action(/^rem_date:(\w+)$/, async (ctx: any) => {
        const d = pending.get(ctx.from.id);
        if (!d) {
            await ctx.answerCbQuery("⚠️ 已過期，請重新開始", {
                show_alert: true,
            });
            return;
        }
        const v = ctx.match[1];
        let base = hkdayjs();
        if (v === "D1") base = base.add(1, "day");
        else if (v === "D2") base = base.add(2, "day");
        else if (v === "D3") base = base.add(3, "day");
        else if (v === "W1") base = base.add(1, "week");
        else if (v === "W2") base = base.add(2, "week");
        d.date = base.format("YYYY-MM-DD");
        await ctx.answerCbQuery();
        await showTimePicker(ctx);
    });

    // 揀鐘點
    bot.action(/^rem_hour:(\d+)$/, async (ctx: any) => {
        const d = pending.get(ctx.from.id);
        if (!d) {
            await ctx.answerCbQuery("⚠️ 已過期，請重新開始", {
                show_alert: true,
            });
            return;
        }
        d.hour = Number(ctx.match[1]);
        await ctx.answerCbQuery();
        await showMinutePicker(ctx);
    });

    // 揀分鐘
    bot.action(/^rem_min:(\d+)$/, async (ctx: any) => {
        const d = pending.get(ctx.from.id);

        if (!d || typeof d.hour === "undefined") {
            await ctx.answerCbQuery("⚠️ 已過期，請重新開始", {
                show_alert: true,
            });
            return;
        }

        d.minute = Number(ctx.match[1]);

        const remindAt = parseHk(`${d.date} ${pad(d.hour)}:${pad(d.minute)}`);
        const nowInHK = dayjs().tz("Asia/Hong_Kong").format("YYYY-MM-DD HH:mm");

        if (remindAt.isBefore(nowInHK)) {
            pending.delete(ctx.from.id);
            await ctx.answerCbQuery("⚠️ 已過期，請重新開始", {
                show_alert: true,
            });
            return;
        }

        await ctx.answerCbQuery();

        await showConfirm(ctx);
    });

    // 返回上一步
    bot.action("rem_back_date", async (ctx: any) => {
        await ctx.answerCbQuery();
        await showDatePicker(ctx);
    });
    bot.action("rem_back_hour", async (ctx: any) => {
        await ctx.answerCbQuery();
        await showTimePicker(ctx);
    });

    // 確認 -> 入 DB + 排程
    bot.action("rem_confirm", async (ctx: any) => {
        const userId = ctx.from.id;
        const d = pending.get(userId);
        if (!d || !d.date || d.hour === undefined || d.minute === undefined) {
            await ctx.answerCbQuery("⚠️ 已過期，請重新開始", {
                show_alert: true,
            });
            return;
        }
        const remindAt = parseHk(`${d.date} ${pad(d.hour)}:${pad(d.minute)}`);

        const reminder = await Reminder.create({
            userId,
            chatId: d.chatId,
            name: ctx.from?.first_name || "",
            text: d.text,
            remindAt: remindAt.toDate(),
            delivered: false,
        });
        scheduleReminder(bot, reminder);
        pending.delete(userId);
        await ctx.answerCbQuery("✅ 已設定");
        await ctx.editMessageText(
            `✅ 已設定提醒：\n📝 ${d.text}\n⏰ ${remindAt.format("YYYY-MM-DD HH:mm")}`
        );
    });

    // 取消
    bot.action("rem_cancel", async (ctx: any) => {
        pending.delete(ctx.from.id);
        await ctx.answerCbQuery("已取消");
        await ctx.editMessageText("已取消 🙅");
    });
}

async function showDatePicker(ctx: any): Promise<void> {
    const d = pending.get(ctx.from.id);
    if (!d) return;
    const dateOpts: [string, string][] = [
        ["今日", "D"],
        ["聽日", "D1"],
        ["後日", "D2"],
        ["三日後", "D3"],
        ["一星期後", "W1"],
        ["兩星期後", "W2"],
    ];
    await render(
        ctx,
        `📅 幾時提醒你？\n📝 ${d.text}`,
        Markup.inlineKeyboard([
            dateOpts
                .slice(0, 3)
                .map(([label, v]) =>
                    Markup.button.callback(label, `rem_date:${v}`)
                ),
            dateOpts
                .slice(3)
                .map(([label, v]) =>
                    Markup.button.callback(label, `rem_date:${v}`)
                ),
            [Markup.button.callback("❌ 取消", "rem_cancel")],
        ])
    );
}

async function showTimePicker(ctx: any): Promise<void> {
    const d = pending.get(ctx.from.id);
    if (!d) return;
    const rows: any[] = [];
    for (let h = 0; h < 24; h += 3) {
        rows.push(
            [h, h + 1, h + 2].map((hh) =>
                Markup.button.callback(`${pad(hh)}:00`, `rem_hour:${hh}`)
            )
        );
    }
    rows.push([
        Markup.button.callback("◀️ 改日期", "rem_back_date"),
        Markup.button.callback("❌ 取消", "rem_cancel"),
    ]);
    await render(ctx, `🕐 揀鐘點（${d.date}）`, Markup.inlineKeyboard(rows));
}

async function showMinutePicker(ctx: any): Promise<void> {
    const d = pending.get(ctx.from.id);
    if (!d) return;
    await render(
        ctx,
        `🕐 揀分鐘（${d.date} ${pad(d.hour!)}:XX）`,
        Markup.inlineKeyboard([
            [0, 10, 20, 30, 40, 50].map((m) =>
                Markup.button.callback(`:${pad(m)}`, `rem_min:${m}`)
            ),
            [
                Markup.button.callback("◀️ 改鐘點", "rem_back_hour"),
                Markup.button.callback("❌ 取消", "rem_cancel"),
            ],
        ])
    );
}

async function showConfirm(ctx: any): Promise<void> {
    const d = pending.get(ctx.from.id);
    if (!d) return;
    const remindAt = parseHk(`${d.date} ${pad(d.hour!)}:${pad(d.minute!)}`);
    await render(
        ctx,
        `📋 確認提醒：\n📝 ${d.text}\n⏰ ${remindAt.format("YYYY-MM-DD HH:mm")}`,
        Markup.inlineKeyboard([
            [
                Markup.button.callback("✅ 確認", "rem_confirm"),
                Markup.button.callback("❌ 取消", "rem_cancel"),
            ],
        ])
    );
}

// 等緊 user 打 reminder 內容嘅話，capture 佢（tg.ts text handler 用）
function handleReminderTextStep(ctx: any): boolean {
    const userId = ctx.from?.id;
    if (!userId) return false;
    const d = pending.get(userId);
    if (!d || d.text) return false;
    const text = ctx.message?.text || "";
    if (!text || text.startsWith("/")) return false;
    d.text = text;
    showDatePicker(ctx);
    return true;
}

export {
    registerReminderWizard,
    handleReminderTextStep,
    loadPendingReminders,
    scheduleReminder,
};
