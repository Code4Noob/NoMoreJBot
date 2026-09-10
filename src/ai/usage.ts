/**
 * AI 每日用量限制 + 紀錄（tokens / cost）
 *
 * Env：
 *   AI_DAILY_TOKEN_LIMIT   每日 token 上限（0 = 唔限，預設 0）
 *   AI_DAILY_COST_LIMIT    每日成本上限 USD（0 = 唔限，預設 0）
 *   AI_USAGE_FILE          用量紀錄檔（預設 log/ai-usage.json）
 *
 * 爆咗 limit 嘅話，getAIResponse 唔會 call AI，直接回覆用戶「limit reached」。
 * 用量按 Asia/Hong_Kong 日期分日計，去到第二日自動 reset。
 */
import fs from "fs";
import path from "path";
import hkdayjs from "../utils/dayjs";
import { estimateCost, type UsageDetail } from "./logger";

const DAILY_TOKEN_LIMIT =
    parseInt(process.env.AI_DAILY_TOKEN_LIMIT || "0", 10) || 0;
const DAILY_COST_LIMIT =
    parseFloat(process.env.AI_DAILY_COST_LIMIT || "0") || 0;
const USAGE_FILE = path.resolve(
    process.cwd(),
    process.env.AI_USAGE_FILE || "log/ai-usage.json"
);

interface ProviderUsage {
    tokens: number;
    cost: number;
}
interface UsageState {
    date: string;
    total: ProviderUsage;
    byProvider: Record<string, ProviderUsage>;
}

function today(): string {
    return hkdayjs().format("YYYY-MM-DD");
}

function emptyUsage(): ProviderUsage {
    return { tokens: 0, cost: 0 };
}

function loadState(): UsageState {
    const t = today();
    try {
        const raw = JSON.parse(fs.readFileSync(USAGE_FILE, "utf-8"));
        if (raw?.date === t) return raw as UsageState;
    } catch {
        /* 冇檔 / 壞檔 → 開新一日 */
    }
    return { date: t, total: emptyUsage(), byProvider: {} };
}

function saveState(state: UsageState): void {
    try {
        fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
        fs.writeFileSync(USAGE_FILE, JSON.stringify(state, null, 2));
    } catch (err: any) {
        console.log("⚠️ AI usage save 失敗:", err?.message || err);
    }
}

/** 紀錄一次 API call 嘅用量（由 logAIResponse 嗰度自動 call） */
export function recordAIUsage(
    provider: string,
    usage?: UsageDetail & { total_tokens?: number }
): void {
    if (!usage) return;
    const tokens =
        usage.total_tokens ??
        (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0);
    if (!tokens) return;
    const cost = estimateCost(provider, usage) ?? 0;

    const state = loadState();
    state.total.tokens += tokens;
    state.total.cost += cost;
    const p = (state.byProvider[provider] ??= emptyUsage());
    p.tokens += tokens;
    p.cost += cost;
    saveState(state);
}

/** 今日已用幾多 */
export function getTodayUsage(): UsageState {
    return loadState();
}

/**
 * 檢查今日用量有冇爆 limit。回傳 null = 未爆；爆咗就回傳人話訊息。
 */
export function checkDailyLimit(): string | null {
    const state = loadState();
    if (DAILY_TOKEN_LIMIT > 0 && state.total.tokens >= DAILY_TOKEN_LIMIT) {
        return `😅 今日 AI 用量已經爆咗 token limit（${state.total.tokens.toLocaleString()} / ${DAILY_TOKEN_LIMIT.toLocaleString()} tokens），聽日再嚟啦！`;
    }
    if (DAILY_COST_LIMIT > 0 && state.total.cost >= DAILY_COST_LIMIT) {
        return `😅 今日 AI 使費已經爆咗 limit（≈$${state.total.cost.toFixed(2)} / $${DAILY_COST_LIMIT.toFixed(2)} USD），聽日再嚟啦！`;
    }
    return null;
}

/** 限額設定（俾 /usage 之類 command 顯示用） */
export function getLimitConfig() {
    return { DAILY_TOKEN_LIMIT, DAILY_COST_LIMIT };
}
