import { getGeminiResponse, getGeminiImage, GEMINI_MODEL } from "./models/gemini";
import { getDeepSeekResponse, DEEPSEEK_MODEL } from "./models/deepseek";
import { getGptResponse, GPT_MODEL } from "./models/gpt";
import { getGlmResponse, getGlmImage, GLM_MODEL } from "./models/glm";
import { getOpenRouterResponse, OPENROUTER_MODEL } from "./models/openrouter";
import { functionHandlers, toolList, toolsConfig } from "./tools";
import { checkDailyLimit } from "./usage";
import type { AIRequest, AIResponse } from "./types";

/**
 * 統一 AI 入口：根據 .env 嘅 AI_PROVIDER 選用唔同 model。
 *
 * 支援：
 *   AI_PROVIDER=gemini      -> Gemini（預設）
 *   AI_PROVIDER=deepseek    -> DeepSeek V4
 *   AI_PROVIDER=gpt         -> GPT（Azure OpenAI）
 *   AI_PROVIDER=glm         -> GLM（智譜 Zhipu BigModel）
 *   AI_PROVIDER=openrouter  -> OpenRouter（一個 key 用齊所有 vendor 嘅 model）
 */
const activeProvider = (process.env.AI_PROVIDER || "gemini").toLowerCase();

// provider -> model 對照表（加新 provider 時喺度加一行就得）
const MODEL_MAP: Record<string, string> = {
    deepseek: DEEPSEEK_MODEL,
    gpt: GPT_MODEL,
    glm: GLM_MODEL,
    openrouter: OPENROUTER_MODEL,
    gemini: GEMINI_MODEL,
};
const activeModel = MODEL_MAP[activeProvider] ?? "unknown";
console.log(`🤖 AI Model: ${activeProvider} / ${activeModel}`);

/** /help 之類 health check 用：而家用緊邊個 provider / model */
export function getActiveAI(): { provider: string; model: string } {
    return { provider: activeProvider, model: activeModel };
}

export async function getAIResponse(opts: AIRequest): Promise<AIResponse> {
    // 每日用量 limit：爆咗就唔好再燒錢，直接回覆用戶
    const limitMsg = checkDailyLimit();
    if (limitMsg) {
        console.log(`🛑 AI daily limit reached，擋住 request`);
        return { message: limitMsg, toolCalls: undefined, usage: 0 };
    }

    switch (activeProvider) {
        case "deepseek":
            return getDeepSeekResponse(opts);
        case "gpt":
            return getGptResponse(opts);
        case "glm":
            return getGlmResponse(opts);
        case "openrouter":
            return getOpenRouterResponse(opts);
        case "gemini":
        default:
            return getGeminiResponse(opts);
    }
}

export { functionHandlers, toolList, toolsConfig };
export { getGeminiImage };

/**
 * 統一生圖入口（provider-aware + fallback chain）：
 * - AI_PROVIDER=glm    -> GLM CogView（唔使 Gemini key）
 * - AI_PROVIDER=gemini -> Gemini
 * - deepseek / gpt 冇自家生圖 -> 先試 Gemini，唔得（401 / 冇 key…）自動 fallback 用 GLM CogView
 * 淨係要有其中一個 image provider 嘅 key 就出到圖。
 */
export async function generateImage(opts: {
    prompt: string;
    inputImage?: { mimeType: string; data: string } | null;
}): Promise<{
    text: string | null;
    imageData: { mimeType: string; data: string } | null;
}> {
    // 生圖 provider 優先次序
    const chain: string[] = [];
    if (activeProvider === "glm") chain.push("glm");
    if (activeProvider === "gemini") chain.push("gemini");
    if (activeProvider === "deepseek" || activeProvider === "gpt" || activeProvider === "openrouter") {
        // 有 GLM key 就用 GLM CogView 做主力（唔使撞 invalid Gemini key），Gemini 做後備
        if (process.env.GLM_API_KEY) chain.push("glm", "gemini");
        else chain.push("gemini", "glm");
    }
    // 兜底：邊個 key 有就補落 chain 尾
    if (process.env.GLM_API_KEY && !chain.includes("glm")) chain.push("glm");
    if (process.env.GEMINI_API_KEY && !chain.includes("gemini"))
        chain.push("gemini");

    const errors: string[] = [];
    for (const p of chain) {
        try {
            return p === "glm"
                ? await getGlmImage(opts)
                : await getGeminiImage(opts);
        } catch (err: any) {
            const msg = err?.response?.data?.error?.message || err?.message;
            errors.push(`${p}: ${msg}`);
            console.log(`⚠️ generateImage ${p} 失敗，試下一個:`, msg);
        }
    }
    throw new Error(
        `生圖失敗（試過: ${errors.join(" | ") || "冇任何 image provider"}）`
    );
}
export type { AIRequest, AIResponse, AIMessage } from "./types";
