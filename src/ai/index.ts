import { getGeminiResponse, getGeminiImage } from "./models/gemini";
import { getDeepSeekResponse } from "./models/deepseek";
import { getGptResponse } from "./models/gpt";
import { functionHandlers, toolList } from "./tools";
import type { AIRequest, AIResponse } from "./types";

/**
 * 統一 AI 入口：根據 .env 嘅 AI_PROVIDER 選用唔同 model。
 *
 * 支援：
 *   AI_PROVIDER=gemini    -> Gemini（預設）
 *   AI_PROVIDER=deepseek  -> DeepSeek V4
 *   AI_PROVIDER=gpt       -> GPT（Azure OpenAI）
 */
export async function getAIResponse(opts: AIRequest): Promise<AIResponse> {
    const provider = (process.env.AI_PROVIDER || "gemini").toLowerCase();

    switch (provider) {
        case "deepseek":
            return getDeepSeekResponse(opts);
        case "gpt":
            return getGptResponse(opts);
        case "gemini":
        default:
            return getGeminiResponse(opts);
    }
}

export { functionHandlers, toolList };
export { getGeminiImage };
export type { AIRequest, AIResponse, AIMessage } from "./types";
