import cron, { ScheduledTask } from "node-cron";
import { Telegraf } from "telegraf";
import { MarksixReminder, IMarksixReminder } from "../models/marksix-reminder";
import { markSixReminder } from "../tools/marksix";

// 現時排緊嘅 job，key 係 chatId（config 改動時方便 stop 再排）
const jobs = new Map<string, ScheduledTask>();

function isValidCron(expr: string): boolean {
    return cron.validate(expr);
}

/**
 * 由 DB 載入所有 enabled 嘅 marksix reminder 並排程。
 * Idempotent：每次 call 都 stop 晒舊 job 再重新排（config 改動後 reload 用）。
 */
async function reloadMarkSixReminders(bot: Telegraf): Promise<void> {
    for (const task of jobs.values()) task.stop();
    jobs.clear();

    const reminders = await MarksixReminder.find({ enabled: true });
    for (const reminder of reminders) {
        scheduleMarkSixReminder(bot, reminder.chatId, reminder.cron, reminder.timezone);
    }
}

/**
 * 排程單一 chat 嘅提醒。cron / timezone 唔啱格式就唔排（return false）。
 */
function scheduleMarkSixReminder(
    bot: Telegraf,
    chatId: string,
    cronExpr: string,
    timezone: string
): boolean {
    if (!cron.validate(cronExpr)) return false;
    try {
        jobs.get(chatId)?.stop();
        const task = cron.schedule(
            cronExpr,
            async () => {
                try {
                    const message = await markSixReminder();
                    await bot.telegram.sendMessage(chatId, message);
                } catch (err: any) {
                    console.log("🚀 ~ marksix reminder error:", err?.message || err);
                }
            },
            { scheduled: true, timezone }
        );
        jobs.set(chatId, task);
        return true;
    } catch (err: any) {
        console.log("⚠️ marksix 排程失敗:", err?.message || err);
        return false;
    }
}

/**
 * Upsert 一個 reminder config（新 chat create、舊 chat update）並即時重新排程。
 */
async function upsertMarkSixReminder(
    bot: Telegraf,
    chatId: string,
    opts?: Partial<Pick<IMarksixReminder, "cron" | "timezone" | "enabled">>
): Promise<IMarksixReminder> {
    const reminder = await MarksixReminder.findOneAndUpdate(
        { chatId },
        { $set: { ...opts, enabled: opts?.enabled ?? true } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    if (!reminder) throw new Error("marksix reminder upsert 失敗");

    if (reminder.enabled && cron.validate(reminder.cron)) {
        scheduleMarkSixReminder(bot, reminder.chatId, reminder.cron, reminder.timezone);
    } else {
        jobs.get(reminder.chatId)?.stop();
        jobs.delete(reminder.chatId);
    }
    return reminder;
}

/**
 * 停用（disable）某 chat 嘅提醒並 stop 對應 job。
 */
async function disableMarkSixReminder(chatId: string): Promise<boolean> {
    const reminder = await MarksixReminder.findOneAndUpdate(
        { chatId },
        { $set: { enabled: false } },
        { new: true }
    );
    if (!reminder) return false;
    jobs.get(chatId)?.stop();
    jobs.delete(chatId);
    return true;
}

export {
    reloadMarkSixReminders,
    scheduleMarkSixReminder,
    upsertMarkSixReminder,
    disableMarkSixReminder,
    isValidCron,
};
