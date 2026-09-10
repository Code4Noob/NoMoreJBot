// 統一 AI response logging

/**
 * 價格表（USD per 1M tokens）。可以用 env 覆蓋：
 *   DEEPSEEK_PRICE_PROMPT / DEEPSEEK_PRICE_CACHED / DEEPSEEK_PRICE_COMPLETION
 *   （GLM_PRICE_*、GPT_PRICE_*、GEMINI_PRICE_* 同理）
 * 呢啲係估計值，實際帳單以 provider platform 為準。
 */
const PRICES: Record<
    string,
    { prompt: number; cached: number; completion: number }
> = {
    deepseek: { prompt: 0.27, cached: 0.07, completion: 1.1 },
    glm: { prompt: 0.6, cached: 0.11, completion: 2.2 },
    gpt: { prompt: 2.5, cached: 1.25, completion: 10 },
    gemini: { prompt: 1.25, cached: 0.31, completion: 10 },
};

export interface UsageDetail {
    prompt_tokens?: number;
    completion_tokens?: number;
    /** DeepSeek: usage.prompt_cache_hit_tokens（平好多） */
    cached_tokens?: number;
}

/** 用 usage 明細估計一次 API call 幾多錢（USD）。冇明細就 return null。 */
export function estimateCost(
    provider: string,
    usage?: UsageDetail
): number | null {
    if (!usage) return null;
    const price =
        PRICES[provider] ||
        PRICES[(process.env.AI_PROVIDER || "gemini").toLowerCase()];
    if (!price) return null;

    // env 覆蓋
    const p =
        Number(process.env[`${provider.toUpperCase()}_PRICE_PROMPT`]) ||
        price.prompt;
    const c =
        Number(process.env[`${provider.toUpperCase()}_PRICE_CACHED`]) ||
        price.cached;
    const comp =
        Number(process.env[`${provider.toUpperCase()}_PRICE_COMPLETION`]) ||
        price.completion;

    const prompt = usage.prompt_tokens ?? 0;
    const cached = Math.min(usage.cached_tokens ?? 0, prompt);
    const completion = usage.completion_tokens ?? 0;
    if (!prompt && !completion) return null;

    return ((prompt - cached) * p + cached * c + completion * comp) / 1_000_000;
}

export function logAIResponse(opts: {
    provider: string;
    model: string;
    finishReason?: string;
    tokens?: number;
    usage?: UsageDetail & { total_tokens?: number };
    toolCalls?: number;
    toolNames?: string[];
    message?: string | null;
}) {
    const text = (opts.message || "").replace(/\s+/g, " ").trim();
    const preview = text.slice(0, 150);
    const tools = `tools=${opts.toolCalls ?? opts.toolNames?.length ?? 0}`;
    // 純 tool call（冇文字）→ preview 顯示 call 咗邊個 tool
    const isToolCallOnly = !!opts.toolNames?.length && !text;
    const fallbackPreview = isToolCallOnly ? `🔧 ${opts.toolNames?.join(", ")}` : "";
    const cost = estimateCost(opts.provider, opts.usage);
    const costStr =
        cost != null ? ` | cost=≈$${cost.toFixed(5)}` : "";
    const usageStr = opts.usage?.prompt_tokens
        ? ` (prompt=${opts.usage.prompt_tokens}${
              opts.usage.cached_tokens
                  ? `, cached=${opts.usage.cached_tokens}`
                  : ""
          }, completion=${opts.usage.completion_tokens ?? "?"})`
        : "";
    console.log(
        `[AI:${opts.provider}] ${opts.model} | finish=${opts.finishReason ?? "n/a"} | tokens=${opts.tokens ?? 0}${usageStr}${costStr} | ${tools}\n  ↳ ${preview || fallbackPreview}`
    );
}
