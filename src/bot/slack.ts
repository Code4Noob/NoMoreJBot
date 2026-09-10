/**
 * Slack adapter（@slack/bolt + Socket Mode）——同 Telegram bot 同一套 AI / 工具 / 人格。
 *
 * 共用：
 *   - src/ai/engine.ts    runAIRoundTrip（multi-round tool loop）/ parseReplyPlan / extractUserSkill
 *   - src/ai               generateImage / getSystemPrompt / saveUserSkill / tools
 *   - src/tools             weather / markSixReminder / from / date
 *   - src/utils/dayjs
 * Slack 專用 state 存 chat/slack-state.json（見 slack-store.ts），唔掂 Telegram 啲 Mongo data。
 *
 * Required env（.env）：
 *   SLACK_BOT_TOKEN    xoxb-...  Bot token（socket mode + API 用）
 *   SLACK_APP_TOKEN    xapp-...  App-level token（Socket Mode，connections:write）
 *   SLACK_ADMIN_IDS    （可選）admin user ids（逗號分隔）— /quit 先准用
 *   BOT_NAME / AI_PROVIDER 等照用返
 */
import fs from "fs";
import path from "path";
import axios from "axios";
import cron, { ScheduledTask } from "node-cron";
import { App, LogLevel } from "@slack/bolt";
import { v4 as uuidv4 } from "uuid";
import hkdayjs from "../utils/dayjs";
import dayjs from "dayjs";
import { weather } from "../tools/weather";
import { markSixReminder } from "../tools/marksix";
import { from, validateJCount } from "../tools/date";
import { generateImage, getActiveAI } from "../ai";
import {
    runAIRoundTrip,
    parseReplyPlan,
    extractUserSkill,
    splitSections,
} from "../ai/engine";
import { getSystemPrompt } from "../ai/skill";
import { formatQuotaMessage } from "../ai/usage";
import { detectTunnelIP } from "../utils/vpn";
import { dbHealthCheck } from "../db";
import * as store from "./slack-store";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;
const SLACK_ADMIN_IDS = (process.env.SLACK_ADMIN_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
// 回覆方式：true = 開 thread 回覆；false / 冇設 = 直接出 message 去 channel（預設）
const SLACK_REPLY_IN_THREAD = ["1", "true", "yes"].includes(
    (process.env.SLACK_REPLY_IN_THREAD || "").toLowerCase()
);
// Slack slash command 回覆顯示：SLACK_COMMAND_VISIBLE=me（預設）→ "Only visible to you"（ephemeral，淨係撳嗰個人見到）；
// =channel → 出晒成個 channel（in_channel）
const SLACK_CMD_IN_CHANNEL = [
    "channel",
    "in_channel",
    "public",
    "1",
    "true",
].includes((process.env.SLACK_COMMAND_VISIBLE || "me").toLowerCase());
// 加落每個 slash command respond() 嘅 object，決定回覆顯示方式
const cmdVis = () =>
    SLACK_CMD_IN_CHANNEL ? { response_type: "in_channel" as const } : {};

const HISTORY_DIR = path.resolve(process.cwd(), "chat/history");
const MAX_HISTORY_LINES = parseInt(process.env.MAX_HISTORY_LINES || "200", 10);
const CONTEXT_SIZE = parseInt(process.env.CHAT_CONTEXT_SIZE || "30", 10);
const REQUEST_DEADLINE_MS = Number(process.env.REQUEST_DEADLINE_MS) || 55_000;
const MAX_TOOL_ROUNDS = 5;
const MAX_TOKENS_PER_QUESTION =
    Number(process.env.MAX_TOKENS_PER_QUESTION) || 10000000;

const HISTORY_SUFFIX = ".txt";
const HISTORY_PREFIX = "slack";

// in-memory AI context（同 tg 一樣，不過 key 用 slack channel）
const contextMap = new Map<string, any[]>();

// name cache（users / conversations），慳 API
const userNames = new Map<string, string>();
const channelNames = new Map<string, string>();

let botUserId = "";

// ─────────────────────────── file history ───────────────────────────
function getHistoryPath(channelId: string): string {
    // channelId 係 C… / D…（ASCII，可以直接做 filename），加 prefix 同 tg 分開
    return path.join(HISTORY_DIR, `${HISTORY_PREFIX}-${channelId}${HISTORY_SUFFIX}`);
}
function trimHistoryFile(filePath: string): void {
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n").filter(Boolean);
        if (lines.length > MAX_HISTORY_LINES) {
            fs.writeFileSync(filePath, lines.slice(-MAX_HISTORY_LINES).join("\n") + "\n", "utf-8");
        }
    } catch (err) {
        console.error("❌ slack trimHistoryFile 失敗:", err);
    }
}
function appendToHistory(channelId: string, name: string, text: string): void {
    const flatText = text.replace(/\r?\n|\r/g, " ");
    const ts = hkdayjs().format("MM-DD HH:mm");
    const line = `[${ts}] [${name}]: ${flatText}\n`;
    try {
        const p = getHistoryPath(channelId);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.appendFileSync(p, line, "utf-8");
        trimHistoryFile(p);
    } catch (err) {
        console.error("❌ slack appendToHistory 失敗:", err);
    }
}
function getRecentHistory(channelId: string): string {
    try {
        const p = getHistoryPath(channelId);
        if (!fs.existsSync(p)) return "";
        const lines = fs.readFileSync(p, "utf-8").trim().split("\n").filter(Boolean);
        return lines.slice(-CONTEXT_SIZE).join("\n");
    } catch (err) {
        console.error("❌ slack getRecentHistory 失敗:", err);
        return "";
    }
}
function getContext(channelId: string): any[] {
    const key = `slack:${channelId}`;
    if (!contextMap.has(key)) contextMap.set(key, []);
    return contextMap.get(key)!;
}

// ─────────────────────────── helpers ───────────────────────────
async function getUserName(client: any, userId: string): Promise<string> {
    if (userNames.has(userId)) return userNames.get(userId)!;
    try {
        const info = await client.users.info({ user: userId });
        const u = info?.user;
        const name = u?.real_name || u?.name || u?.profile?.display_name || userId;
        userNames.set(userId, name);
        return name;
    } catch {
        return userId;
    }
}
async function getChannelName(client: any, channelId: string): Promise<string> {
    if (channelNames.has(channelId)) return channelNames.get(channelId)!;
    try {
        const info = await client.conversations.info({ channel: channelId });
        const name = info?.channel?.name || channelId;
        channelNames.set(channelId, name);
        return name;
    } catch {
        return channelId;
    }
}

function formatUptime(seconds: number): string {
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function stripMentions(text: string): string {
    return (text || "").replace(/<@[A-Z0-9]+>/g, "").trim();
}

/** 將「今日係咪已經撳咗」邏輯抽出（同 tg validateJCount 一致，不過傳 ISO string） */
function canIncrementDay(isoUpdated?: string): boolean {
    if (!isoUpdated) return true;
    const d = new Date(isoUpdated);
    return validateJCount(d);
}

/**
 * 決定回覆去邊：
 * - user 本身喺 thread 入面 mention/reply（msgThreadTs 存在）→ 跟返嗰個 thread 答，唔好甩咗去 channel
 * - 唔喺 thread：SLACK_REPLY_IN_THREAD=true 就喺 user 條 message 開 thread 答（thread_ts = eventTs）；
 *   預設（false）就直接出 message 去 channel（thread_ts = undefined）
 */
function replyThreadTs(eventTs?: string, msgThreadTs?: string): string | undefined {
    if (msgThreadTs) return msgThreadTs;
    if (SLACK_REPLY_IN_THREAD && eventTs) return eventTs;
    return undefined;
}

// ─────────────────────────── AI 對話（slack）───────────────────────────
async function handleSlackMessageText(client: any, opts: {
    channelId: string;
    threadTs?: string;
    userId: string;
    text: string;
    imageData?: { mimeType: string; data: string } | null;
}) {
    const { channelId, threadTs, userId } = opts;
    const userName = await getUserName(client, userId);
    const chatName = await getChannelName(client, channelId);
    const prompt = opts.text.trim() || "（用圖片問你）";
    const isDM = channelId.startsWith("D");

    const recentHistory = getRecentHistory(channelId);
    const nowStr = hkdayjs().format("YYYY-MM-DD HH:mm");
    const baseMsg = `[現在時間: ${nowStr}（Asia/Hong_Kong）] [Chat: ${chatName}] [${userName}]: ${prompt}`;
    const userMessage = recentHistory
        ? `[Recent messages in this group]:\n${recentHistory}\n\n${baseMsg}`
        : baseMsg;

    appendToHistory(channelId, userName, prompt);

    const contextMessages: any[] = [{ role: "user", content: userMessage }];
    const chatContext = getContext(channelId);
    const chatMsg: any = { role: "user", content: userMessage };
    if (opts.imageData) chatMsg.imageData = opts.imageData;
    chatContext.push(chatMsg);

    // post 一段即時 feedback（有 tool call 嗰陣 engine 會 call onGreeting）
    const buildSystemPrompt = (roundsLeft: number) => {
        const note =
            roundsLeft <= 0
                ? "你已經用盡工具 call 嘅限額，必須直接根據現有資料俾最終答案，唔好再 call 任何工具。"
                : `你最多可以再 call ${roundsLeft} 次工具（單次問題 token 預算約 ${MAX_TOKENS_PER_QUESTION}）。call 完後就算資料唔夠，都要直接俾最終答案，唔好無止境咁 call 工具。`;
        return `${getSystemPrompt(userId)}\n\n[系統提示] ${note}`;
    };

    const post = (text: string) =>
        client.chat.postMessage({
            channel: channelId,
            text,
            ...(threadTs ? { thread_ts: threadTs } : {}),
        });

    // 「輸入中…」狀態（agent app 專用 API）：要 thread_ts 先可以 set；bot 出 message 落
    // 呢條 thread 嗰陣 Slack 會自動剷走個 status
    if (threadTs) {
        await client.apiCall("assistant.threads.setStatus", {
            channel_id: channelId,
            thread_ts: threadTs,
            status: "處理緊你嘅需求…",
            loading: true,
        } as any).catch(() => {});
    }

    const { reply: engineReply, usage } = await runAIRoundTrip({
        initialMessages: chatContext.slice(-6),
        contextMessages,
        systemPrompt: buildSystemPrompt(MAX_TOOL_ROUNDS),
        buildSystemPrompt,
        maxRounds: MAX_TOOL_ROUNDS,
        deadlineMs: REQUEST_DEADLINE_MS,
        maxTokens: MAX_TOKENS_PER_QUESTION,
        onGreeting: async (t) => {
            await post(t || "🔍 處理緊你嘅需求，請稍候…").catch(() => {});
        },
    });

    let reply = engineReply || "冇嘢想講";
    reply = extractUserSkill(reply, userId); // [user_skill] → 更新 Slack user 專屬人格

    // log.log（同 tg 一樣格式）
    try {
        fs.appendFileSync(
            path.join(process.cwd(), "log/log.log"),
            JSON.stringify({ prompt, reply, usage, platform: "slack" }) + "\n",
            "utf-8"
        );
    } catch (_) {}

    chatContext.push({ role: "assistant", content: reply });
    appendToHistory(channelId, "Bot", reply);

    // 解析 marker：gen image / [sticker]
    const plan = parseReplyPlan(reply);

    if (plan.genImage) {
        await post(plan.genImage.isEdit ? "執緊...📸" : "畫緊...").catch(() => {});
        const { text, imageData } = await generateImage({
            prompt: plan.genImage.prompt,
            inputImage: plan.genImage.isEdit ? opts.imageData : undefined,
        });
        const caption = plan.text || text || undefined;
        if (imageData) {
            await uploadImage(client, channelId, imageData, caption, threadTs);
        } else {
            await post(text ? `${text}` : plan.genImage.isEdit ? "執唔到" : "畫唔到").catch(() => {});
        }
        return;
    }

    if (plan.stickerIds.length > 0) {
        // Slack 冇 Telegram sticker pack —— 出返正文就算（貼圖 marker 已剝走）
    }
    const sections = splitSections(plan.text);
    for (const s of sections) {
        await post(s).catch(() => {});
    }
}

async function uploadImage(
    client: any,
    channelId: string,
    imageData: { mimeType: string; data: string },
    caption?: string,
    threadTs?: string
): Promise<void> {
    const buffer = Buffer.from(imageData.data, "base64");
    const ext = (imageData.mimeType.split("/")[1] || "png").replace("jpeg", "jpg");
    try {
        await client.files.uploadV2({
            channel_id: channelId,
            filename: `bot-${Date.now()}.${ext}`,
            file: buffer,
            initial_comment: caption || "",
            ...(threadTs ? { thread_ts: threadTs } : {}),
        });
    } catch (err: any) {
        // 舊啲 API fallback
        console.log("⚠️ slack files.uploadV2 失敗，fallback upload:", err?.message || err);
        await client.files.upload({
            channels: channelId,
            filename: `bot-${Date.now()}.${ext}`,
            file: buffer,
            initial_comment: caption || "",
            ...(threadTs ? { thread_ts: threadTs } : {}),
        }).catch((e2: any) => console.log("❌ slack file upload 失敗:", e2?.message || e2));
    }
}

/** 下載 Slack file（image）做 base64，餵俾 AI vision / image edit */
async function downloadSlackFile(file: any): Promise<{ mimeType: string; data: string } | null> {
    const mime = file?.mimetype || "";
    if (!mime.startsWith("image/")) return null;
    const url = file?.url_private;
    if (!url) return null;
    try {
        const resp = await axios.get(url, {
            responseType: "arraybuffer",
            headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
        });
        return {
            mimeType: mime,
            data: Buffer.from(resp.data).toString("base64"),
        };
    } catch (err: any) {
        console.log("❌ slack file download 失敗:", err?.message || err);
        return null;
    }
}

// 從 message event 攞第一張 image（file_share / files）
async function firstImageData(client: any, event: any): Promise<{ mimeType: string; data: string } | null> {
    const files = event?.files && event.files.length > 0
        ? event.files
        : event?.message?.files;
    if (!files || !files.length) return null;
    // 有啲 case file 得 id，要 files.info 攞 url_private
    for (const f of files) {
        let file = f;
        if (!file.url_private && file.id) {
            try {
                const info = await client.files.info({ file: file.id });
                file = info?.file || file;
            } catch (_) {}
        }
        const data = await downloadSlackFile(file);
        if (data) return data;
    }
    return null;
}

// ─────────────────────────── marksix scheduler ───────────────────────────
const marksixJobs = new Map<string, ScheduledTask>();

function scheduleMarksixChannel(client: any, channelId: string, cronExpr: string, timezone: string): boolean {
    if (!cron.validate(cronExpr)) return false;
    try {
        marksixJobs.get(channelId)?.stop();
        const task = cron.schedule(
            cronExpr,
            async () => {
                try {
                    const message = await markSixReminder();
                    await client.chat.postMessage({ channel: channelId, text: message });
                } catch (err: any) {
                    console.log("🚀 ~ slack marksix reminder error:", err?.message || err);
                }
            },
            { scheduled: true, timezone }
        );
        marksixJobs.set(channelId, task);
        return true;
    } catch (err: any) {
        console.log("⚠️ slack marksix 排程失敗:", err?.message || err);
        return false;
    }
}
function reloadSlackMarksix(client: any): void {
    for (const task of marksixJobs.values()) task.stop();
    marksixJobs.clear();
    const enabled = store.listEnabledMarksix();
    for (const [channelId, cfg] of Object.entries(enabled)) {
        scheduleMarksixChannel(client, channelId, cfg.cron, cfg.timezone);
    }
}
async function enableSlackMarksix(client: any, channelId: string): Promise<boolean> {
    const cfg = store.setMarksix(channelId, { enabled: true, cron: "0 0 * * *", timezone: "Asia/Hong_Kong" });
    return scheduleMarksixChannel(client, channelId, cfg.cron, cfg.timezone);
}
function disableSlackMarksix(channelId: string): boolean {
    const had = store.getMarksix(channelId);
    store.clearMarksix(channelId);
    marksixJobs.get(channelId)?.stop();
    marksixJobs.delete(channelId);
    return !!had;
}

// ─────────────────────────── reminder scheduler ───────────────────────────
const reminderTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleSlackReminder(client: any, row: store.SlackReminderRow, late = false): void {
    const delay = Math.max(new Date(row.remindAt).getTime() - Date.now(), 0);
    if (reminderTimers.has(row.id)) clearTimeout(reminderTimers.get(row.id)!);
    const timer = setTimeout(async () => {
        reminderTimers.delete(row.id);
        try {
            await client.chat.postMessage({
                channel: row.channelId,
                text: `⏰ <@${row.userId}> 提醒你${late ? "（遲咗）" : ""}：${row.text}`,
            });
        } catch (err: any) {
            console.log("⏰ slack reminder send 失敗:", err?.message || err);
        }
        store.markReminderDelivered(row.id);
    }, delay);
    reminderTimers.set(row.id, timer);
}
function reloadSlackReminders(client: any): void {
    for (const t of reminderTimers.values()) clearTimeout(t);
    reminderTimers.clear();
    const now = Date.now();
    for (const r of store.listReminders()) {
        if (r.delivered) continue;
        scheduleSlackReminder(client, r, new Date(r.remindAt).getTime() < now);
    }
}

// ─────────────────────────── app setup ───────────────────────────
function createApp(): App {
    return new App({
        token: SLACK_BOT_TOKEN,
        appToken: SLACK_APP_TOKEN,
        socketMode: true,
        logLevel: LogLevel.INFO,
    });
}

export async function startSlack(): Promise<App | null> {
    if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
        console.log(
            "⚠️ 冇 SLACK_BOT_TOKEN / SLACK_APP_TOKEN —— skip Slack（有需要就喺 .env 加）"
        );
        return null;
    }

    const app = createApp();

    // bot user id + marksix / reminder reload
    try {
        const auth = await app.client.auth.test();
        botUserId = auth.user_id || "";
        console.log(`✅ Slack bot user id: ${botUserId}`);
    } catch (err: any) {
        console.log("⚠️ Slack auth.test 失敗:", err?.message || err);
    }
    reloadSlackMarksix(app.client);
    reloadSlackReminders(app.client);

    // Slack 要 bot 係 channel member 先會收到 app_mention；順手報返 bot 入咗邊啲 channel
    try {
        const conv = await app.client.conversations.list({
            types: "public_channel,private_channel,mpim",
            limit: 300,
        });
        const inCh = (conv.channels || []).filter((c: any) => c.is_member);
        if (inCh.length) {
            console.log(
                "✅ Slack bot 喺 channel:",
                inCh
                    .map((c: any) => {
                        const kind = c.is_mpim
                            ? "mpim"
                            : c.is_private
                              ? "private"
                              : "public";
                        return `#${c.name || c.id} (${kind})`;
                    })
                    .join(", ")
            );
        } else {
            console.log(
                "ℹ️ Slack conversations.list 搵唔到 bot 喺任何 channel（可能未 /invite，或者 groups:read scope 唔夠睇 private channel）——如果 bot 其實已經入咗 group 而 @佢有反應，就可以無視呢句。"
            );
        }
    } catch (err: any) {
        console.log(
            "⚠️ Slack conversations.list 失敗（可能 scope 唔夠）:",
            err?.message || err
        );
    }

    // ── AI：channel 度 @bot（app_mention）──
    app.event("app_mention", async ({ event, client }) => {
        const ev: any = event;
        console.log(
            `📩 Slack app_mention: user=${ev.user} channel=${ev.channel} ts=${ev.ts} text=${(ev.text || "").slice(0, 80)}`
        );
        try {
            // ⚠️ Slack app_mention event 唔一定包 files —— 用 ts 攞返完整 message（入面先有 file 資訊）
            let full: any = ev;
            if (!ev.files?.length) {
                try {
                    if (ev.thread_ts) {
                        const rep = await client.conversations.replies({
                            channel: ev.channel,
                            ts: ev.thread_ts,
                            latest: ev.ts,
                            limit: 1,
                            inclusive: true,
                        });
                        full = rep?.messages?.[0] ?? ev;
                    } else {
                        const hist = await client.conversations.history({
                            channel: ev.channel,
                            latest: ev.ts,
                            limit: 1,
                            inclusive: true,
                        });
                        full = hist?.messages?.[0] ?? ev;
                    }
                } catch (_) {}
            }
            const imageData = await firstImageData(client, full);
            const text = stripMentions(ev.text || "");
            // 冇文字淨係 @ -> 有圖就「幫我睇下」
            await handleSlackMessageText(client, {
                channelId: ev.channel,
                threadTs: replyThreadTs(ev.ts, ev.thread_ts),
                userId: ev.user,
                text: text || (imageData ? "幫我睇下呢張圖片" : ""),
                imageData,
            });
        } catch (err: any) {
            console.log("🚀 ~ slack app_mention error:", err?.message || err);
            await client.chat
                .postMessage({ channel: ev.channel, thread_ts: ev.thread_ts || ev.ts, text: `出錯: ${err?.message || "未知錯誤"}` })
                .catch(() => {});
        }
    });

    // ── AI：DM / thread-reply-to-bot ──
    app.message(async ({ message, client }) => {
        const msg: any = message;
        // 跳過 bot 自己 / 其他 bot / 系統訊息
        if (msg.bot_id || !msg.user) return;
        if (msg.subtype && msg.subtype !== "file_share" && msg.subtype !== "bot_message") return;
        const channelId = msg.channel;
        if (!channelId) return;
        const isDM = channelId.startsWith("D");
        // 淨係處理：DM（唔使 @）同 bot 開嘅 thread 入面 user 覆 bot（好似 tg reply-to-bot）
        if (!isDM) {
            // @bot 嘅 channel message 由 app_mention handler 處理，喺度 skip 避免 double-handle
            if ((msg.text || "").includes(`<@${botUserId}>`)) return;
            const inBotThread = await isReplyToBotThread(client, channelId, msg);
            if (!inBotThread) return;
        }
        try {
            const imageData = await firstImageData(client, msg);
            const text = isDM ? msg.text || "" : stripMentions(msg.text || "");
            if (!text.trim() && !imageData) return;
            await handleSlackMessageText(client, {
                channelId,
                // DM：bot 係 agent app，top-level message 會跌入「History」tab 唔會喺
                // Chat tab 出現——一定要 thread reply 返用戶句 message 先會顯示喺 Chat
                threadTs: replyThreadTs(msg.ts, msg.thread_ts),
                userId: msg.user,
                text,
                imageData,
            });
        } catch (err: any) {
            console.log("🚀 ~ slack message error:", err?.message || err);
        }
    });

    // 有冇喺 bot 開嘅 thread 度（thread root 係 bot 就當 reply-to-bot）
    async function isReplyToBotThread(client: any, channelId: string, msg: any): Promise<boolean> {
        const threadTs = msg.thread_ts;
        if (!threadTs) return false;
        try {
            const replies = await client.conversations.replies({
                channel: channelId,
                ts: threadTs,
                limit: 1,
            });
            const root = replies?.messages?.[0];
            return !!root && root.user === botUserId;
        } catch {
            return false;
        }
    }

    // ── /help（health check，同 tg 差唔多）──
    app.command("/help", async ({ ack, respond }) => {
        await ack();
        const { provider: aiProvider, model: aiModel } = getActiveAI();
        const lines: string[] = [`🧪 Slack Health Check（uptime ${formatUptime(process.uptime())}）`];
        lines.push(`• AI: ${aiProvider} / ${aiModel}`);
        const tunIP = detectTunnelIP();
        lines.push(tunIP ? `• VPN: ✅ up（${tunIP}）` : "• VPN: ⚠️ down");
        try {
            lines.push(`• DB: ${await dbHealthCheck()}`);
        } catch (e: any) {
            lines.push(`• DB: ⚠️ ${e?.message || "err"}`);
        }
        await respond({ text: lines.join("\n"), ...cmdVis() });
    });

    // ── /quota（今日 AI 用量 + limit）──
    app.command("/quota", async ({ ack, respond }) => {
        await ack();
        await respond({ text: formatQuotaMessage(), ...cmdVis() });
    });

    // ── /weather ──
    app.command("/weather", async ({ ack, respond }) => {
        await ack();
        try {
            const message = await weather();
            await respond({ text: message, ...cmdVis() });
        } catch (err: any) {
            await respond({ text: `天氣查唔到: ${err?.message || "未知錯誤"}`, ...cmdVis() });
        }
    });

    // ── /marksix（開彩結果）──
    app.command("/marksix", async ({ ack, respond }) => {
        await ack();
        try {
            const message = await markSixReminder();
            await respond({ text: message, ...cmdVis() });
        } catch (err: any) {
            await respond({ text: `馬會查唔到: ${err?.message || "未知錯誤"}`, ...cmdVis() });
        }
    });

    // ── /from（計時間差）──
    app.command("/from", async ({ ack, respond, command }) => {
        await ack();
        const payload = (command.text || "").trim();
        if (!payload) {
            await respond({ text: "用法：/from <日期>\n例如：/from 01-08-2026 或 /from 7 Oct", ...cmdVis() });
            return;
        }
        await respond({ text: from(payload), ...cmdVis() });
    });

    // ── /jp（JLPT vocab）──
    app.command("/jp", async ({ ack, respond, command }) => {
        await ack();
        const level = (command.text || "").trim() || "1";
        try {
            const resp = await axios.get(
                `https://jlpt-vocab-api.vercel.app/api/words/random?level=${level}`
            );
            const message = Object.entries(resp.data).map((x) => x.join(": ")).join("\n");
            await respond({ text: message, ...cmdVis() });
        } catch (error: any) {
            await respond({ text: `JP 查唔到: ${error?.response?.data?.error || error.message}`, ...cmdVis() });
        }
    });

    // ── /draw（畫圖）──
    app.command("/draw", async ({ ack, respond, command }) => {
        await ack();
        const prompt = (command.text || "").trim();
        if (!prompt) {
            await respond({ text: "畫咩撚嘢？俾個描述嚟先（例如 /draw 一隻柴犬戴太陽眼鏡）", ...cmdVis() });
            return;
        }
        await respond({ text: "畫緊...", ...cmdVis() });
        try {
            const { text, imageData } = await generateImage({ prompt });
            if (imageData) {
                const buffer = Buffer.from(imageData.data, "base64");
                const ext = (imageData.mimeType.split("/")[1] || "png").replace("jpeg", "jpg");
                // /draw 用 files.uploadV2 出圖 + caption
                try {
                    await app.client.files.uploadV2({
                        channel_id: command.channel_id,
                        filename: `draw-${Date.now()}.${ext}`,
                        file: buffer,
                        initial_comment: text || undefined,
                    });
                } catch (err: any) {
                    await respond({ text: `畫到但上傳失敗: ${err?.message || "未知錯誤"}`, ...cmdVis() });
                }
            } else {
                await respond({ text: text ? `${text}` : "畫唔到", ...cmdVis() });
            }
        } catch (error: any) {
            await respond({ text: `畫唔到: ${error?.response?.data?.error?.message || error.message}`, ...cmdVis() });
        }
    });

    // ── /transportation（行共用 AI flow 搵路）──
    app.command("/transportation", async ({ ack, respond, command }) => {
        await ack();
        const payload = (command.text || "").trim();
        if (!payload) {
            await respond({ text: "想去邊？格式：/transportation <出發地>去<目的地>\n例如：/transportation 旺角去中環", ...cmdVis() });
            return;
        }
        // 行返共用 AI flow
        await respond({ text: "🔍 搵緊路線...", ...cmdVis() });
        await handleSlackMessageText(app.client, {
            channelId: command.channel_id,
            userId: command.user_id,
            text: `用戶想查交通路線：${payload}`,
        });
    });

    // ── /j（Day counter）──
    app.command("/j", async ({ ack, respond, command }) => {
        await ack();
        const userId = command.user_id;
        const st = store.getUserState(userId);
        const day = st.day || 0;
        await respond({
            ...cmdVis(),
            text: `${await getUserName(app.client, userId)} | Day${day} — Jed?`,
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*Jed?*  你而家 Day ${day}`,
                    },
                },
                {
                    type: "actions",
                    elements: [
                        {
                            type: "button",
                            text: { type: "plain_text", text: "⬆️ +1 Day" },
                            action_id: "j_incr",
                            value: userId,
                        },
                        {
                            type: "button",
                            text: { type: "plain_text", text: "🔄 Reset" },
                            action_id: "j_reset",
                            value: userId,
                            style: "danger",
                        },
                    ],
                },
            ],
        });
    });

    // /j 按鈕 action
    app.action("j_incr", async ({ ack, body, respond }) => {
        await ack();
        const b: any = body;
        const ownerId = b.actions?.[0]?.value;
        const userId = b.user?.id;
        if (!userId || (ownerId && ownerId !== userId)) {
            await respond({ text: "❌ 呢個 menu 唔係俾你㩒嘅", response_type: "ephemeral", replace_original: false });
            return;
        }
        const st = store.getUserState(userId);
        const name = await getUserName(app.client, userId);
        if (!canIncrementDay(st.day_updated_at)) {
            await respond({ text: "你今日咪撳撚左囉，仲撳多次做乜柒姐?", response_type: "ephemeral", replace_original: true });
            return;
        }
        store.updateUserState(userId, {
            day: (st.day || 0) + 1,
            day_updated_at: new Date().toISOString(),
            first_name: name,
        });
        const updated = store.getUserState(userId);
        await respond({
            text: `${name} | Day${updated.day}`,
            replace_original: true,
        });
    });

    app.action("j_reset", async ({ ack, body, respond }) => {
        await ack();
        const b: any = body;
        const ownerId = b.actions?.[0]?.value;
        const userId = b.user?.id;
        if (!userId || (ownerId && ownerId !== userId)) {
            await respond({ text: "❌ 呢個 menu 唔係俾你㩒嘅", response_type: "ephemeral", replace_original: false });
            return;
        }
        const name = await getUserName(app.client, userId);
        store.updateUserState(userId, { day: 0, day_updated_at: undefined, first_name: name });
        await respond({ text: `${name} | Day0（已 reset）`, replace_original: true });
    });

    // ── /me ──
    app.command("/me", async ({ ack, respond, command }) => {
        await ack();
        const st = store.getUserState(command.user_id);
        const name = await getUserName(app.client, command.user_id);
        await respond({ text: `${name} | Day${st.day || 0}`, ...cmdVis() });
    });

    // ── /users（leaderboard）──
    app.command("/users", async ({ ack, respond }) => {
        await ack();
        const users = Object.entries(store.listUsers());
        if (!users.length) {
            await respond({ text: "未有人用過 /j", ...cmdVis() });
            return;
        }
        const medal = ["🥇", "🥈", "🥉"];
        const shit = "💩";
        const lines = users
            .sort((a, b) => (b[1].day || 0) - (a[1].day || 0))
            .map(([, st], idx) => {
                const emoji = medal[idx] ?? shit;
                return `${emoji} Day${st.day || 0} | ${st.first_name || st.day}`;
            });
        await respond({ text: lines.join("\n"), ...cmdVis() });
    });

    // ── /marksix_remind（per-channel toggle）──
    app.command("/marksix_remind", async ({ ack, respond, command }) => {
        await ack();
        const channelId = command.channel_id;
        const cfg = store.getMarksix(channelId);
        const state = cfg?.enabled ? "🟢 已開啟" : "🔴 已停用";
        await respond({
            ...cmdVis(),
            text: `🎰 馬會提醒（呢個 channel）— ${state}`,
            blocks: [
                { type: "section", text: { type: "mrkdwn", text: `🎰 *馬會提醒*（channel）— ${state}` } },
                {
                    type: "actions",
                    elements: [
                        { type: "button", text: { type: "plain_text", text: "🟢 開啟提醒" }, action_id: "marksix_on", value: channelId, style: "primary" },
                        { type: "button", text: { type: "plain_text", text: "🔴 停用提醒" }, action_id: "marksix_off", value: channelId, style: "danger" },
                    ],
                },
            ],
        });
    });

    app.action("marksix_on", async ({ ack, body, respond }) => {
        await ack();
        const b: any = body;
        const channelId = b.actions?.[0]?.value;
        if (!channelId) return;
        const ok = await enableSlackMarksix(app.client, channelId);
        await respond({
            text: ok
                ? `✅ 馬會提醒已開啟\nChannel: ${channelId}\nCron: 0 0 * * * (Asia/Hong_Kong)`
                : "❌ 開啟失敗（cron 格式問題？）",
            replace_original: true,
        });
    });
    app.action("marksix_off", async ({ ack, body, respond }) => {
        await ack();
        const b: any = body;
        const channelId = b.actions?.[0]?.value;
        if (!channelId) return;
        const ok = disableSlackMarksix(channelId);
        await respond({
            text: ok ? `✅ 已停用 channel ${channelId} 嘅馬會提醒` : `❌ 呢個 channel 冇設定過馬會提醒`,
            replace_original: true,
        });
    });

    // ── /reminder（modal：text + date + time）──
    app.command("/reminder", async ({ ack, body, client, command }) => {
        await ack();
        const cmd: any = command;
        const text = (cmd.text || "").trim();
        try {
            await client.views.open({
                trigger_id: (body as any).trigger_id,
                view: {
                    type: "modal",
                    callback_id: "slack_reminder_modal",
                    private_metadata: JSON.stringify({
                        channel_id: cmd.channel_id,
                        user_id: cmd.user_id,
                    }),
                    title: { type: "plain_text", text: "⏰ 設定提醒" },
                    submit: { type: "plain_text", text: "確認" },
                    close: { type: "plain_text", text: "取消" },
                    blocks: [
                        {
                            type: "input",
                            block_id: "rem_text",
                            label: { type: "plain_text", text: "提醒內容" },
                            element: {
                                type: "plain_text_input",
                                action_id: "rem_text_input",
                                multiline: false,
                                initial_value: text,
                            },
                        },
                        {
                            type: "input",
                            block_id: "rem_date",
                            label: { type: "plain_text", text: "日期" },
                            element: { type: "datepicker", action_id: "rem_date_input" },
                        },
                        {
                            type: "input",
                            block_id: "rem_time",
                            label: { type: "plain_text", text: "時間（香港）" },
                            element: { type: "timepicker", action_id: "rem_time_input", initial_time: "09:00" },
                        },
                    ],
                },
            });
        } catch (err: any) {
            console.log("❌ slack reminder modal open 失敗:", err?.message || err);
        }
    });

    app.view("slack_reminder_modal", async ({ ack, body, client, view }) => {
        const v: any = view;
        const vals = v.state?.values || {};
        const text = vals.rem_text?.rem_text_input?.value || "";
        const date = vals.rem_date?.rem_date_input?.selected_date || "";
        const time = vals.rem_time?.rem_time_input?.selected_time || "";
        const meta = JSON.parse(v.private_metadata || "{}");
        if (!text || !date || !time) {
            await ack({ response_action: "errors", errors: { rem_text: "內容、日期同時間都要填" } });
            return;
        }
        // date/time picker 都係 local time —— 當香港時間處理（同 tg 一致）
        const remindAt = dayjs.tz(`${date} ${time}`, "YYYY-MM-DD HH:mm", "Asia/Hong_Kong");
        const nowInHK = dayjs().tz("Asia/Hong_Kong");
        if (remindAt.isBefore(nowInHK)) {
            await ack({ response_action: "errors", errors: { rem_time: "時間已過，揀返將來嘅時間" } });
            return;
        }
        const row: store.SlackReminderRow = {
            id: uuidv4(),
            userId: meta.user_id,
            channelId: meta.channel_id,
            text,
            remindAt: remindAt.toISOString(),
            delivered: false,
        };
        store.addReminder(row);
        scheduleSlackReminder(app.client, row);
        await ack();
        // 確認訊息（ephemeral 俾 set 嗰個人）
        const name = await getUserName(client, meta.user_id);
        await client.chat.postEphemeral({
            channel: meta.channel_id,
            user: meta.user_id,
            text: `✅ 已設定提醒：\n📝 ${text}\n⏰ ${remindAt.format("YYYY-MM-DD HH:mm")}（${name}）`,
        }).catch(() => {});
    });

    // ── /quit（admin only：app 離開 channel）──
    app.command("/quit", async ({ ack, respond, command }) => {
        await ack();
        if (!SLACK_ADMIN_IDS.includes(command.user_id)) {
            await respond({ text: "踢你老母臭（得 admin 先可以叫我走）", ...cmdVis() });
            return;
        }
        try {
            await app.client.conversations.leave({ channel: command.channel_id });
        } catch (err: any) {
            await respond({ text: `離開唔到: ${err?.message || "未知錯誤"}`, ...cmdVis() });
        }
    });

    // Bolt 內部未 handle 嘅 error 出嚟 log，唔好無聲無息
    app.error(async (err) => {
        console.log("⚠️ Slack Bolt error:", err?.message || err);
    });

    await app.start();
    console.log("✅ Slack bot 已啟動（Socket Mode）");
    return app;
}
