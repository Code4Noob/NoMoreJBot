import { getGeminiResponse, getGeminiImage, GEMINI_MODEL } from "./models/gemini";
import { getDeepSeekResponse, DEEPSEEK_MODEL } from "./models/deepseek";
import { getGptResponse, GPT_MODEL } from "./models/gpt";
import { getGlmResponse, getGlmImage, GLM_MODEL } from "./models/glm";
import { functionHandlers, toolList, toolsConfig } from "./tools";
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
 * 統一生圖入口（provider-aware）：
 * - AI_PROVIDER=glm -> 用 GLM 自己嘅 CogView（唔使 Gemini key）
 * - 其他（gemini / deepseek / gpt）照用返 Gemini 生圖
 */
export async function generateImage(opts: {
    prompt: string;
    inputImage?: { mimeType: string; data: string } | null;
}): Promise<{
    text: string | null;
    imageData: { mimeType: string; data: string } | null;
}> {
    if (activeProvider === "glm") return getGlmImage(opts);
    return getGeminiImage(opts);
}
export type { AIRequest, AIResponse, AIMessage } from "./types";
