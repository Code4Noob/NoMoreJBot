import axios from "axios";
import vpnAxios from "../../utils/vpn";
import { toolList } from "../tools";
import { baseSystemPrompt } from "../skill";
import { logAIResponse } from "../logger";
import type { AIRequest, AIResponse, AIMessage } from "../types";

/**
 * GLM provider（智譜 Zhipu BigModel，OpenAI-compatible chat completions API）
 * - 支援 function calling（tool_calls）
 * - 回傳格式同其他 provider 一致
 * - Docs: https://open.bigmodel.cn/dev/api
 * 註：呢個係 OpenAI-compatible，圖像輸入 / 生成唔經呢度（生圖照用 Gemini / 對應 model）
 */
const GLM_API_KEY = process.env.GLM_API_KEY as string;
export const GLM_MODEL = process.env.GLM_MODEL || "glm-5.3-flash";
const GLM_BASE_URL =
    process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";

export async function getGlmResponse({
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
        model: GLM_MODEL,
        // 最低 reasoning effort（慳時間慳 token）——AI_REASONING_EFFORT 可改 low / medium / high
        reasoning_effort: process.env.AI_REASONING_EFFORT || "low",
        messages: openAIMessages,
        tools: toolList,
        tool_choice: "auto",
        top_p: topP,
        temperature,
    };

    try {
        const res = await vpnAxios.post(
            `${GLM_BASE_URL}/chat/completions`,
            requestBody,
            { headers: { Authorization: `Bearer ${GLM_API_KEY}` } }
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

        logAIResponse({
            provider: "glm",
            model: GLM_MODEL,
            finishReason: choice?.finish_reason,
            tokens: data.usage?.total_tokens ?? 0,
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
            "🚀 ~ getGlmResponse ~ error:",
            error?.response?.data || error.message
        );
        throw error;
    }
}

/** GLM 圖像生成 model（CogView）；可用 GLM_IMAGE_MODEL 換（實測 cogview-4-250304 得） */
const GLM_IMAGE_MODEL = process.env.GLM_IMAGE_MODEL || "cogview-4-250304";

/**
 * GLM 圖像生成（CogView，images/generations API，OpenAI-compatible）。
 * 淨係文生圖：CogView 未有 image edit，有 inputImage 都係照 prompt 重新生成。
 */
export async function getGlmImage({
    prompt,
    inputImage,
}: {
    prompt: string;
    inputImage?: { mimeType: string; data: string } | null;
}): Promise<{
    text: string | null;
    imageData: { mimeType: string; data: string } | null;
}> {
    if (inputImage) {
        console.log("⚠️ GLM（CogView）未有 image edit，照 prompt 重新生成");
    }
    try {
        const res = await vpnAxios.post(
            `${GLM_BASE_URL}/images/generations`,
            {
                model: GLM_IMAGE_MODEL,
                prompt,
                size: process.env.GLM_IMAGE_SIZE || "1024x1024",
            },
            { headers: { Authorization: `Bearer ${GLM_API_KEY}` } }
        );
        const item = res.data?.data?.[0];
        let buffer: Buffer | null = null;
        let mime = "image/png";
        if (item?.b64_json) {
            buffer = Buffer.from(item.b64_json, "base64");
            mime = item.mime_type || "image/png";
        } else if (item?.url) {
            // 智譜 file host（mfile.z.ai）有幾秒 propagation delay：
            // 生成後即時下載會 404（file not exist），要 poll 幾次等佢 ready 先 download到
            const MAX_ATTEMPTS = 8;
            for (let attempt = 0; attempt < MAX_ATTEMPTS && !buffer; attempt++) {
                try {
                    const imgResp = await axios.get(item.url, {
                        responseType: "arraybuffer",
                        timeout: 15000,
                    });
                    buffer = Buffer.from(imgResp.data);
                    mime =
                        (imgResp.headers["content-type"] as string) ||
                        "image/png";
                } catch (err: any) {
                    if (attempt < MAX_ATTEMPTS - 1) {
                        await new Promise((r) => setTimeout(r, 1500));
                    } else {
                        console.log(
                            "🚀 ~ getGlmImage ~ 圖片下載失敗:",
                            err?.message || err
                        );
                    }
                }
            }
        }
        if (!buffer) {
            console.log(
                "🚀 ~ getGlmImage ~ 冇圖返:",
                JSON.stringify(res.data).slice(0, 300)
            );
            return { text: null, imageData: null };
        }
        return {
            text: null,
            imageData: { mimeType: mime, data: buffer.toString("base64") },
        };
    } catch (error: any) {
        console.log(
            "🚀 ~ getGlmImage ~ error:",
            error?.response?.data || error.message
        );
        throw error;
    }
}

export type { AIMessage };
