import vpnAxios from "../../utils/vpn";
import { toolList } from "../tools";
import { skillSystemPrompt } from "../skill";
import type { AIRequest, AIResponse } from "../types";

/**
 * GPT provider（Azure OpenAI，OpenAI-compatible chat completions API）
 * - 支援 function calling（tool_calls）
 * - 回傳格式同其他 provider 一致
 */
export async function getGptResponse({
    messages,
    topP = 1,
    temperature = 0.6,
    systemPrompt = skillSystemPrompt,
}: AIRequest): Promise<AIResponse> {
    if (topP > 1 || topP < 0) {
        throw new Error("Top P must be a number between 0 to 1");
    }

    if (temperature > 2 || temperature < 0) {
        throw new Error("Temperature must be a number between 0 to 2");
    }

    const modelUrl = process.env.AZURE_OPENAI_URL;
    const apiKey = process.env.AZURE_OPENAI_KEY;

    const requestConfig = {
        method: "post",
        url: modelUrl,
        headers: { "API-Key": apiKey },
        data: {
            messages: [
                {
                    role: "system",
                    content: systemPrompt,
                },
                ...messages,
            ],
            tools: toolList,
            tool_choice: "auto",
            top_p: topP,
            temperature,
        },
    };

    const { data } = await vpnAxios(requestConfig);

    if (data.choices[0].finish_reason === "content_filter") {
        return {
            message: "Microsoft has blocked this response due to policy violation",
            toolCalls: undefined,
            usage: data.usage?.total_tokens ?? 0,
            imageData: null,
        };
    }

    const msg = data.choices[0].message;

    return {
        message: msg?.content || null,
        toolCalls: msg?.tool_calls,
        usage: data.usage?.total_tokens ?? 0,
        imageData: null,
    };
}
