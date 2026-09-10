import vpnAxios from "../../utils/vpn";
import { toolList } from "../tools";
import { baseSystemPrompt } from "../skill";
import { logAIResponse } from "../logger";
import type { AIRequest, AIResponse, AIMessage } from "../types";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY as string;
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
// Vision model（睇圖用）——request 入面有 imageData 就自動轉用呢個
export const DEEPSEEK_VISION_MODEL =
    process.env.DEEPSEEK_VISION_MODEL || "deepseek-v4-flash-vision-exp";
const DEEPSEEK_BASE_URL =
    process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

/**
 * DeepSeek provider（OpenAI-compatible chat completions API）
 * - 支援 function calling（tool_calls）
 * - 支援圖像輸入（vision）：有 imageData 就轉 OpenAI multimodal 格式（image_url + text），
 *   並自動改用 DEEPSEEK_VISION_MODEL
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

    // 有圖（vision）就用 vision model，冇圖用返普通 model
    const hasImage = messages.some((m) => m.imageData);
    const model = hasImage ? DEEPSEEK_VISION_MODEL : DEEPSEEK_MODEL;

    console.log(
        `🚀 ~ getDeepSeekResponse ~ model=${model} msgs=${openAIMessages.length}${hasImage ? " (vision)" : ""}`
    );

    const requestBody: any = {
        model,
        messages: openAIMessages,
        tools: toolList,
        tool_choice: "auto",
        top_p: topP,
        temperature,
    };

    try {
        const res = await vpnAxios.post(
            `${DEEPSEEK_BASE_URL}/chat/completions`,
            requestBody,
            { headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}` } }
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

        // DeepSeek usage: prompt_cache_hit_tokens 係平價 cached tokens（billing 明細）
        const usage = {
            total_tokens: data.usage?.total_tokens ?? 0,
            prompt_tokens: data.usage?.prompt_tokens ?? 0,
            completion_tokens: data.usage?.completion_tokens ?? 0,
            cached_tokens:
                data.usage?.prompt_cache_hit_tokens ??
                data.usage?.prompt_tokens_details?.cached_tokens ??
                0,
        };
        logAIResponse({
            provider: "deepseek",
            model,
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
            usage: data.usage?.total_tokens ?? 0,
            imageData: null,
        };
    } catch (error: any) {
        console.log(
            "🚀 ~ getDeepSeekResponse ~ error: 123",
            error?.response?.data || error.message
        );
        throw error;
    }
}

export type { AIMessage };
