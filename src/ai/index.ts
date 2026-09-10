import { getGeminiResponse, getGeminiImage, GEMINI_MODEL } from "./models/gemini";
import { getDeepSeekResponse, DEEPSEEK_MODEL } from "./models/deepseek";
import { getGptResponse, GPT_MODEL } from "./models/gpt";
import { getGlmResponse, getGlmImage, GLM_MODEL } from "./models/glm";
import { functionHandlers, toolList, toolsConfig } from "./tools";
import { checkDailyLimit } from "./usage";
import type { AIRequest, AIResponse } from "./types";

/**
 * 統一 AI 入口：根據 .env 嘅 AI_PROVIDER 選用唔同 model。
 *
 * 支援：
 *   AI_PROVIDER=gemini    -> Gemini（預設）
 *   AI_PROVIDER=deepseek  -> DeepSeek V4
 *   AI_PROVIDER=gpt       -> GPT（Azure OpenAI）
 *   AI_PROVIDER=glm       -> GLM（智譜 Zhipu BigModel）
 */
const activeProvider = (process.env.AI_PROVIDER || "gemini").toLowerCase();
const activeModel =
    activeProvider === "deepseek"
        ? DEEPSEEK_MODEL
        : activeProvider === "gpt"
          ? GPT_MODEL
          : activeProvider === "glm"
            ? GLM_MODEL
            : GEMINI_MODEL;
console.log(`🤖 AI Model: ${activeProvider} / ${activeModel}`);

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
    if (activeProvider === "deepseek" || activeProvider === "gpt") {
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
