/**
 * Platform-agnostic AI 對話 engine：多 round tool calling + deadline + greeting。
 *
 * Telegram（src/bot/tg.ts）同 Slack（src/bot/slack.ts）共用呢個核心，
 * 唔使喺每個 platform adapter 度重複寫同一套 tool loop。
 *
 * 呢度只處理「點樣同 LLM 傾」同「call 咩 tool」——完全唔掂 platform 嘅 send。
 * 點 send（reply / photo / sticker / thread…）由各 adapter 自己做。
 */
import { getAIResponse, functionHandlers, toolsConfig } from "./index";
import { saveUserSkill } from "./skill";

export interface RoundTripOptions {
    /** 第一次 call 用嘅 messages（tg 用 chatContext.slice(-6)） */
    initialMessages: any[];
    /** 之後每個 round 都會 push assistant/tool message 入呢個 array 再 call */
    contextMessages: any[];
    /** 第一次 call 嘅完整 system prompt（通常 buildSystemPrompt(MAX_ROUNDS)） */
    systemPrompt: string;
    /** 每個 round 用嘅 system prompt（roundsLeft 由 engine 控制） */
    buildSystemPrompt: (roundsLeft: number) => string;
    maxRounds?: number;
    /** 成個 request 硬 deadline，超時就強制 final answer（唔再 call tool） */
    deadlineMs?: number;
    maxTokens?: number;
    /**
     * 第一個 response call 咗 greeting tool（web_search / 巴士等）嗰陣 callback。
     * text = 第一個 response 嘅文字（可能 null）；adapter 用嚟出「處理緊你嘅需求」feedback。
     */
    onGreeting?: (text: string | null) => void | Promise<void>;
}

export interface RoundTripResult {
    /** 最終 AI 文字（未處理 [section] / [sticker] / gen image 等 marker） */
    reply: string | null;
    /** 累計 token usage */
    usage: number;
}

/**
 * 跑一個完整 AI request（初 call + tool loop + 超時強制收尾）。
 * 邏輯同 tg.ts 原本嘅 handleAIRequest 中段一致，抽出嚟俾兩個 platform 共用。
 */
export async function runAIRoundTrip(o: RoundTripOptions): Promise<RoundTripResult> {
    const MAX_ROUNDS = o.maxRounds ?? 5;
    const DEADLINE_MS = o.deadlineMs ?? 55_000;
    const MAX_TOKENS = o.maxTokens ?? 10_000_000;
    const START = Date.now();

    let { message: reply, usage, toolCalls } = await getAIResponse({
        messages: o.initialMessages,
        systemPrompt: o.systemPrompt,
    });

    // 第一個 response call 咗 greeting tool → 出「處理緊你嘅需求」feedback
    const callsGreetingTool = toolCalls?.some(
        (tc: any) => toolsConfig.showGreeting[tc.function?.name]
    );
    if (toolCalls && callsGreetingTool) {
        try {
            await o.onGreeting?.(reply);
        } catch (err: any) {
            console.log("⚠️ greeting callback 失敗:", err?.message || err);
        }
    }

    let toolRoundsLeft = MAX_ROUNDS;
    let currentTokenUsage = usage;
    while (
        toolCalls &&
        toolRoundsLeft > 0 &&
        currentTokenUsage < MAX_TOKENS &&
        Date.now() - START < DEADLINE_MS
    ) {
        toolRoundsLeft--;
        o.contextMessages.push({
            role: "assistant",
            content: null,
            tool_calls: toolCalls,
        });

        await Promise.all(
            toolCalls.map(async (toolCall) => {
                const { name, arguments: args } = toolCall.function;
                const handler = functionHandlers[name];
                let functionResult: any;
                if (typeof handler !== "function") {
                    console.log(`⚠️ 未知 tool: ${name}（model 幻覺，唔存在）`);
                    functionResult = {
                        error: `Tool "${name}" does not exist. Only use the tools provided in the tools list.`,
                    };
                } else {
                    // 防禦：任何 handler 拋錯（包括 JSON.parse(args) 出錯）都變成 tool error result
                    try {
                        functionResult = await handler(JSON.parse(args));
                    } catch (toolErr: any) {
                        console.log(
                            `⚠️ tool 執行失敗: ${name}`,
                            toolErr?.message || toolErr
                        );
                        functionResult = {
                            error: `Tool ${name} 執行失敗: ${toolErr?.message || "未知錯誤"}`,
                        };
                    }
                }
                o.contextMessages.push({
                    name,
                    role: "tool",
                    content: JSON.stringify(functionResult),
                    tool_call_id: toolCall.id,
                });
            })
        );

        const generalResponse = await getAIResponse({
            messages: o.contextMessages,
            systemPrompt: o.buildSystemPrompt(toolRoundsLeft),
        });
        if (generalResponse.message) reply = generalResponse.message;
        usage += generalResponse.usage;
        currentTokenUsage += generalResponse.usage;
        toolCalls = generalResponse.toolCalls;
    }

    // 超時（時間用盡）跳出 loop 而仲有 tool call 未處理 → 強制要 final answer
    if (toolCalls && Date.now() - START >= DEADLINE_MS) {
        console.log("⏰ tool loop 超過 deadline，強制 final answer（唔再 call 工具）");
        try {
            const forced = await getAIResponse({
                messages: o.contextMessages,
                systemPrompt: o.buildSystemPrompt(0),
            });
            if (forced.message) reply = forced.message;
            usage += forced.usage;
        } catch (forceErr: any) {
            console.log(
                "⚠️ 強制 final answer 失敗:",
                forceErr?.message || forceErr
            );
        }
    }

    return { reply, usage };
}

// ────────────────────────────────────────────────────────────────────────────
// Reply marker 處理（[user_skill] / [section] / [sticker] / gen image）
// 兩個 platform 都用同一套 regex，避免 drift。
// ────────────────────────────────────────────────────────────────────────────

/** gen image marker（同 tg 一樣）："gen image edit <描述>" = 編輯；"gen image <描述>" = 由零生圖 */
export const GEN_IMAGE_EDIT_RE = /(?:\*\*\*)?\s*gen image edit\s*(?:\*\*\*)?\s+(.+)/i;
export const GEN_IMAGE_RE = /(?:\*\*\*)?\s*gen image\s*(?:\*\*\*)?\s+(.+)/i;
/** [sticker]: <id> 同 [sticker: <id>]（AI 有時寫錯格式都相容） */
export const STICKER_RE =
    /\[sticker\]\s*:\s*([A-Za-z0-9_\-]+)|\[sticker:\s*([A-Za-z0-9_\-]+)\]/gi;

/**
 * 處理 [user_skill]: 更新對某 user 嘅專屬人格（side effect：saveUserSkill）。
 * 回傳剝走 marker 之後嘅 reply（冇 match 就原樣）。
 */
export function extractUserSkill(
    reply: string,
    userId?: string | number
): string {
    if (!userId) return reply;
    const m = reply.match(
        /\[user_skill\]\s*:\s*([\s\S]*)$|\[user_skill:\s*([\s\S]*?)\]/i
    );
    if (!m) return reply;
    const content = (m[1] || m[2] || "").trim();
    if (content) saveUserSkill(userId, content);
    return reply.slice(0, m.index).trim() || "已更新對你嘅專屬人格";
}

/** 將文字按 [section] 拆開（trim + 去空），最多 8 段；冇 marker 就成段返 */
export function splitSections(text: string, max = 8): string[] {
    const sections = text
        .split(/\[section\]/)
        .map((s) => s.trim())
        .filter(Boolean);
    return sections.length <= 1 ? [text] : sections.slice(0, max);
}

export interface ReplyPlan {
    /** 剝走 gen image / sticker marker 後嘅正文（[section] 保留，畀 caller 自己拆/當 caption） */
    text: string;
    /** gen image 要求（有就係由零生圖/編輯） */
    genImage: { prompt: string; isEdit: boolean } | null;
    /** [sticker] marker 入面嘅 sticker ids（Slack 冇 Telegram sticker，adapter 自行決定點處理） */
    stickerIds: string[];
}

/**
 * 分析 AI 回覆入面嘅 marker：gen image 指令 + [sticker] 列表，剝走之後嘅正文。
 * 純 function，唔 send。
 */
export function parseReplyPlan(reply: string): ReplyPlan {
    const genImageEditMatch = reply.match(GEN_IMAGE_EDIT_RE);
    const genImageMatch = genImageEditMatch || reply.match(GEN_IMAGE_RE);
    const isEdit = !!genImageEditMatch;
    const genImage = genImageMatch
        ? { prompt: genImageMatch[1].trim(), isEdit }
        : null;

    const stickerIds = [...reply.matchAll(STICKER_RE)].map((m) =>
        (m[1] || m[2]).trim()
    );
    const textNoStickers = reply.replace(STICKER_RE, "");

    let text: string;
    if (genImage) {
        // 剝走 gen image marker；[section] 喺 caption 冇意義，一併變空格
        text = (isEdit ? textNoStickers.replace(GEN_IMAGE_EDIT_RE, "") : textNoStickers.replace(GEN_IMAGE_RE, ""))
            .replace(/\[section\]/g, " ")
            .trim();
    } else {
        text = textNoStickers.trim();
    }
    return { text, genImage, stickerIds };
}
