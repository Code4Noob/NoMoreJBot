/**
 * Slack 專用 state store（JSON file，完全唔掂 Telegram 嘅 Mongo collections）。
 *
 * Telegram 啲 User/Chat/Reminder model 係 numeric ID + key 喺 telegram chatId，
 * Slack 嘅 ID 係 string（U… / C… / D…），夾硬入同一批 collection 要郁 schema。
 * 呢度用一個獨立 JSON file（chat/slack-state.json，gitignored），
 * 存 Slack 用嘅 day counter / marksix config / reminders，簡單又唔影響 Telegram。
 */
import fs from "fs";
import path from "path";

const FILE = path.resolve(process.cwd(), "chat/slack-state.json");

export interface SlackUserState {
    day?: number;
    /** ISO string（last day increment 嗰日） */
    day_updated_at?: string;
    first_name?: string;
}
export interface SlackMarksixState {
    enabled: boolean;
    cron: string;
    timezone: string;
}
export interface SlackReminderRow {
    id: string;
    userId: string;
    name?: string;
    channelId: string;
    text: string;
    /** ISO string */
    remindAt: string;
    delivered: boolean;
}
export interface SlackState {
    users: Record<string, SlackUserState>;
    marksix: Record<string, SlackMarksixState>;
    reminders: SlackReminderRow[];
}

let cache: SlackState | null = null;

function load(): SlackState {
    if (cache) return cache;
    try {
        if (fs.existsSync(FILE)) {
            const raw = JSON.parse(fs.readFileSync(FILE, "utf-8"));
            cache = {
                users: raw.users || {},
                marksix: raw.marksix || {},
                reminders: raw.reminders || [],
            };
            return cache;
        }
    } catch (err) {
        console.log("⚠️ slack-state 讀取失敗（用空 state）:", (err as any)?.message || err);
    }
    cache = { users: {}, marksix: {}, reminders: [] };
    return cache;
}

function persist(): void {
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify(load(), null, 2), "utf-8");
    } catch (err) {
        console.log("⚠️ slack-state 寫入失敗:", (err as any)?.message || err);
    }
}

// ---------- users（day counter） ----------
export function getUserState(userId: string): SlackUserState {
    return load().users[userId] || {};
}
export function updateUserState(userId: string, patch: SlackUserState): SlackUserState {
    const s = load();
    s.users[userId] = { ...s.users[userId], ...patch };
    persist();
    return s.users[userId];
}
export function listUsers(): Record<string, SlackUserState> {
    return load().users;
}

// ---------- marksix（per-channel config） ----------
export function getMarksix(channelId: string): SlackMarksixState | undefined {
    return load().marksix[channelId];
}
export function setMarksix(
    channelId: string,
    cfg: SlackMarksixState
): SlackMarksixState {
    load().marksix[channelId] = cfg;
    persist();
    return cfg;
}
export function clearMarksix(channelId: string): void {
    delete load().marksix[channelId];
    persist();
}
export function listEnabledMarksix(): Record<string, SlackMarksixState> {
    const out: Record<string, SlackMarksixState> = {};
    for (const [ch, cfg] of Object.entries(load().marksix)) {
        if (cfg?.enabled) out[ch] = cfg;
    }
    return out;
}

// ---------- reminders ----------
export function listReminders(): SlackReminderRow[] {
    return load().reminders;
}
export function addReminder(row: SlackReminderRow): void {
    load().reminders.push(row);
    persist();
}
export function markReminderDelivered(id: string): void {
    const s = load();
    const r = s.reminders.find((x) => x.id === id);
    if (r) {
        r.delivered = true;
        persist();
    }
}
export function removeReminder(id: string): void {
    load().reminders = load().reminders.filter((x) => x.id !== id);
    persist();
}
