import vpnAxios from "../../utils/vpn";
import { toolList } from "../tools";
import { baseSystemPrompt } from "../skill";
import { logAIResponse } from "../logger";
import type { AIRequest, AIResponse, AIMessage } from "../types";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY as string;
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

/**
 * DeepSeek provider（OpenAI-compatible chat completions API）
 * - 支援 function calling（tool_calls）
 * - 回傳格式同 gemini provider 一致，方便 tg.ts 統一處理
 */
export async function getDeepSeekResponse({
    messages,
    topP = 1,
    temperature = 0.6,
    systemPrompt = baseSystemPrompt,
}: AIRequest): Promise<AIResponse> {
    const openAIMessages: any[] = [];

    if (systemPrompt) {
        openAIMessages.push({ role: "system", content: systemPrompt });
    }

    for (const msg of messages) {
        if (msg.role === "system") continue; // system prompt 已處理
        const m: any = { role: msg.role, content: msg.content ?? null };
        if (msg.name) m.name = msg.name;
        if (msg.tool_call_id) m.tool_call_id = msg.tool_call_id;
        if (msg.tool_calls) m.tool_calls = msg.tool_calls;
        openAIMessages.push(m);
    }

    const requestBody: any = {
        model: DEEPSEEK_MODEL,
        messages: openAIMessages,
        tools: toolList,
        tool_choice: "auto",
        top_p: topP,
        temperature,
    };

    try {
        const { data } = await vpnAxios.post(
            `${DEEPSEEK_BASE_URL}/chat/completions`,
            requestBody,
            { headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}` } }
        );

        const choice = data.choices?.[0];
        const msg = choice?.message;

        const toolCalls = msg?.tool_calls?.map((tc: any) => ({
            id: tc.id,
            function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
            },
        }));

        logAIResponse({
            provider: "deepseek",
            model: DEEPSEEK_MODEL,
            finishReason: choice?.finish_reason,
            tokens: data.usage?.total_tokens ?? 0,
            toolCalls: toolCalls?.length ?? 0,
            message: msg?.content || null,
        });

        return {
            message: msg?.content || null,
            toolCalls: toolCalls?.length ? toolCalls : undefined,
            usage: data.usage?.total_tokens ?? 0,
            imageData: null,
        };
    } catch (error: any) {
        console.log("🚀 ~ getDeepSeekResponse ~ error:", error?.response?.data || error.message);
        throw error;
    }
}

export type { AIMessage };
