import vpnAxios from "../../utils/vpn";
import { toolList } from "../tools";
import { baseSystemPrompt } from "../skill";
import { logAIResponse } from "../logger";
import type { AIRequest, AIResponse, AIMessage } from "../types";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY as string;
export const OPENROUTER_MODEL =
    process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
const OPENROUTER_BASE_URL =
    process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

/**
 * OpenRouter provider（OpenAI-compatible chat completions API）
 * - 支援 function calling（tool_calls）
 * - 支援圖像輸入（vision）：有 imageData 就轉 OpenAI multimodal 格式（image_url + text）
 * - OpenRouter 用一個 key 選到唔同 vendor 嘅 model（OPENROUTER_MODEL 填 vendor/model）
 */
export async function getOpenRouterResponse({
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
        // Vision：有圖就轉 OpenAI multimodal content（data URL base64）
        if (msg.imageData) {
            m.content = [
                {
                    type: "image_url",
                    image_url: {
                        url: `data:${msg.imageData.mimeType};base64,${msg.imageData.data}`,
                    },
                },
                { type: "text", text: msg.content ?? "" },
            ];
        }
        openAIMessages.push(m);
    }

    console.log(
        `🚀 ~ getOpenRouterResponse ~ model=${OPENROUTER_MODEL} msgs=${openAIMessages.length}`
    );

    const requestBody: any = {
        model: OPENROUTER_MODEL,
        messages: openAIMessages,
        tools: toolList,
        tool_choice: "auto",
        top_p: topP,
        temperature,
    };

    try {
        const res = await vpnAxios.post(
            `${OPENROUTER_BASE_URL}/chat/completions`,
            requestBody,
            {
                headers: {
                    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
                    // OpenRouter 建議帶埋呢啲 headers（app 排名用，可選）
                    "HTTP-Referer":
                        process.env.OPENROUTER_SITE_URL || "https://github.com/Code4Noob/NoMoreJBot",
                    "X-Title": "NoMoreJBot",
                },
            }
        );

        const { data } = res;
        const choice = data.choices?.[0];
        const msg = choice?.message;

        const toolCalls = msg?.tool_calls?.map((tc: any) => ({
            id: tc.id,
            type: tc.type ?? "function",
            function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
            },
        }));

        // OpenRouter usage：prompt_tokens_details.cached_tokens 係平價 cached tokens
        const usage = {
            total_tokens: data.usage?.total_tokens ?? 0,
            prompt_tokens: data.usage?.prompt_tokens ?? 0,
            completion_tokens: data.usage?.completion_tokens ?? 0,
            cached_tokens:
                data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        };
        logAIResponse({
            provider: "openrouter",
            model: OPENROUTER_MODEL,
            finishReason: choice?.finish_reason,
            tokens: usage.total_tokens,
            usage,
            toolCalls: toolCalls?.length ?? 0,
            toolNames: toolCalls?.map((tc: any) => tc.function.name),
            message: msg?.content || null,
        });
        return {
            message: msg?.content || null,
            toolCalls: toolCalls,
            usage: usage.total_tokens,
            imageData: null,
        };
    } catch (error: any) {
        console.log(
            "🚀 ~ getOpenRouterResponse ~ error:",
            error?.response?.data || error.message
        );
        throw error;
    }
}

export type { AIMessage };
