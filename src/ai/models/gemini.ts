import vpnAxios from "../../utils/vpn";
import { ensureVPN, restartVPN, isTunnelUp } from "../../utils/vpn-manager";
import { baseSystemPrompt } from "../skill";
import { logAIResponse } from "../logger";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY as string;
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
export const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-lite-image";

/** Gemini 地區限制錯誤：user location 唔受支援（FAILED_PRECONDITION 400） */
function isLocationError(error: any): boolean {
    const data = error?.response?.data?.error;
    return (
        data?.status === "FAILED_PRECONDITION" &&
        typeof data?.message === "string" &&
        data.message.includes("User location is not supported")
    );
}

/** 連線層錯誤（VPN stale / 網絡問題）：ETIMEDOUT / ECONNRESET / ECONNREFUSED 等 */
function isConnectionError(error: any): boolean {
    const code = error?.code || error?.errno;
    if (typeof code === "string") {
        return [
            "ETIMEDOUT",
            "ECONNRESET",
            "ECONNREFUSED",
            "ENETUNREACH",
            "EHOSTUNREACH",
            "EAI_AGAIN",
            "EADDRNOTAVAIL",
            "EPIPE",
        ].includes(code);
    }
    const msg = error?.message || "";
    return /connect ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|network is unreachable|timed out/i.test(
        msg
    );
}

/**
 * 包一層 retry：遇到 Gemini location 限制 / 連線失敗時自動起（或重啟）VPN 再試一次。
 * 每個 request 只會 retry 一次（避免無限 loop）；VPN 搞唔掂就保留原 error。
 */
async function withAutoVPNRetry<T>(fn: () => Promise<T>): Promise<T> {
    let retried = false;
    try {
        return await fn();
    } catch (error: any) {
        if (!retried && (isLocationError(error) || isConnectionError(error))) {
            retried = true;
            const isLocation = isLocationError(error);
            const isConn = isConnectionError(error);
            if (isLocation) {
                console.log("🌍 Gemini location 限制（user location 唔受支援）→ 自動啟動 VPN 重試...");
            } else if (isConn) {
                console.log("⚠️ Gemini 連線失敗 → 自動重啟 VPN 重試...");
            }
            try {
                // 連線 fail 而 tunnel 仲 up -> 好可能 stale，強制重啟；否則正常起/補起
                if (isConn && isTunnelUp()) {
                    await restartVPN();
                } else {
                    await ensureVPN();
                }
            } catch (vpnErr: any) {
                console.log("❌ VPN 自動啟動失敗:", vpnErr.message);
                throw error; // 保留原本 error
            }
            return await fn(); // 重試一次；再失敗就 throw 重試嘅 error
        }
        throw error;
    }
}

interface ToolCall {
    id: string;
    function: {
        name: string;
        arguments: string;
    };
    thoughtSignature?: string;
}

interface GeminiResponse {
    message: string | null;
    toolCalls: ToolCall[] | undefined;
    usage: number;
    imageData?: { mimeType: string; data: string } | null;
}

function convertToGeminiMessages(messages: any[]): any[] {
    const geminiMessages: any[] = [];
    for (const msg of messages) {
        if (msg.role === "system") continue; // System prompt handled separately

        if (msg.role === "user") {
            const parts: any[] = [];
            if (msg.content) {
                parts.push({ text: msg.content });
            }
            if (msg.imageData) {
                parts.push({ inlineData: msg.imageData });
            }
            if (parts.length > 0) {
                geminiMessages.push({ role: "user", parts });
            }
        } else if (msg.role === "assistant") {
            const parts: any[] = [];
            if (msg.content) {
                parts.push({ text: msg.content });
            }
            // Convert OpenAI-style tool_calls to Gemini functionCall parts
            if (msg.tool_calls) {
                for (const tc of msg.tool_calls) {
                    const fcPart: any = {
                        functionCall: {
                            name: tc.function.name,
                            args: JSON.parse(tc.function.arguments),
                        }
                    };
                    // Include thoughtSignature if available (required for thinking models)
                    if (tc.thoughtSignature) {
                        fcPart.thoughtSignature = tc.thoughtSignature;
                    }
                    parts.push(fcPart);
                }
            }
            if (parts.length > 0) {
                geminiMessages.push({ role: "model", parts });
            }
        } else if (msg.role === "tool") {
            // Convert OpenAI-style tool result to Gemini functionResponse
            // Gemini 唔支援 role "function"，function response 要用 role "user" + functionResponse part
            geminiMessages.push({
                role: "user",
                parts: [{
                    functionResponse: {
                        name: msg.name,
                        response: JSON.parse(msg.content),
                    }
                }]
            });
        }
    }
    return geminiMessages;
}

const geminiToolList = [
    {
        name: "get_url_text_content",
        description: "Get the main text content of a website specified by an URL (renders JS pages)",
        parameters: {
            type: "object",
            properties: {
                url: {
                    type: "string",
                    description: "URL to the https website where text content will be obtained",
                }
            },
            required: ["url"],
        }
    },
    {
        name: "get_cached_stickers",
        description: "Get the list of cached stickers (stickerId, meaning, emoji) that the bot can send. Use a returned stickerId in the reply as [sticker]: <stickerId> to send that sticker.",
        parameters: {
            type: "object",
            properties: {},
        }
    }
];

// functionHandlers 已移到 src/ai/tools.ts（provider 共用）

export async function getGeminiResponse({
    messages,
    topP = 1,
    temperature = 0.6,
    systemPrompt = baseSystemPrompt,
}: {
    messages: { role: string; content: string | null }[];
    topP?: number;
    temperature?: number;
    systemPrompt?: string;
}): Promise<GeminiResponse> {
    const contents = convertToGeminiMessages(messages);

    const requestBody: any = {
        contents,
        generationConfig: {
            temperature,
            topP,
        },
        tools: [
            {
                functionDeclarations: geminiToolList,
            },
        ],
    };

    if (systemPrompt) {
        requestBody.systemInstruction = {
            parts: [{ text: systemPrompt }],
        };
    }

    try {
        const data = await withAutoVPNRetry(async () => {
            const res = await vpnAxios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
                requestBody
            );
            return res.data;
        });

        const candidate = data.candidates?.[0];
        if (!candidate) {
            console.log("🚀 ~ getGeminiResponse ~ no candidate:", JSON.stringify(data));
            return { message: "No response from Gemini", toolCalls: undefined, usage: 0, imageData: null };
        }

        const totalTokens = data.usageMetadata?.totalTokenCount ?? 0;
        const parts = candidate.content?.parts ?? [];

        if (parts.length === 0) {
            return { message: null, toolCalls: undefined, usage: totalTokens, imageData: null };
        }

        const toolCalls: ToolCall[] = [];
        let textParts: string[] = [];
        let imageData: { mimeType: string; data: string } | null = null;

        for (const part of parts) {
            // 跳過 Gemini 思考內容（thought），唔好將 reasoning 當正文
            if (part.thought) continue;
            if (part.functionCall) {
                toolCalls.push({
                    id: part.functionCall.name,
                    function: {
                        name: part.functionCall.name,
                        arguments: JSON.stringify(part.functionCall.args),
                    },
                    thoughtSignature: part.thoughtSignature || candidate.thoughtSignature,
                });
            }
            if (part.text) {
                textParts.push(part.text);
            }
            if (part.inlineData && part.inlineData.mimeType?.startsWith("image/")) {
                imageData = {
                    mimeType: part.inlineData.mimeType,
                    data: part.inlineData.data,
                };
            }
        }

        const message = textParts.length > 0 ? textParts.join("\n") : null;

        logAIResponse({
            provider: "gemini",
            model: GEMINI_MODEL,
            finishReason: candidate.finishReason,
            tokens: totalTokens,
            toolCalls: toolCalls.length,
            toolNames: toolCalls.map((tc) => tc.function.name),
            message,
        });

        return {
            message,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            usage: totalTokens,
            imageData,
        };
    } catch (error: any) {
        console.log("🚀 ~ getGeminiResponse ~ error:", error?.response?.data || error.message);
        throw error;
    }
}

export async function getGeminiImage({
    prompt,
    inputImage,
}: {
    prompt: string;
    inputImage?: { mimeType: string; data: string } | null;
}): Promise<{ text: string | null; imageData: { mimeType: string; data: string } | null }> {
    const IMAGE_MODEL = GEMINI_IMAGE_MODEL;

    // 編輯相：將 input 相加做第一個 part，再跟住編輯指示文字
    const parts: any[] = [];
    if (inputImage) parts.push({ inlineData: inputImage });
    parts.push({ text: prompt });

    const requestBody: any = {
        contents: [
            {
                role: "user",
                parts,
            },
        ],
        generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
        },
    };

    try {
        const data = await withAutoVPNRetry(async () => {
            const res = await vpnAxios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
                requestBody
            );
            return res.data;
        });

        const candidate = data.candidates?.[0];
        if (!candidate) {
            console.log("🚀 ~ getGeminiImage ~ no candidate:", JSON.stringify(data));
            return { text: null, imageData: null };
        }

        const parts = candidate.content?.parts ?? [];
        let text = "";
        let imageData: { mimeType: string; data: string } | null = null;

        for (const part of parts) {
            // 跳過 Gemini 思考內容（thought），唔好將 reasoning 當正文
            if (part.thought) continue;
            if (part.text) text += part.text + "\n";
            if (part.inlineData && part.inlineData.mimeType?.startsWith("image/")) {
                imageData = {
                    mimeType: part.inlineData.mimeType,
                    data: part.inlineData.data,
                };
            }
        }

        return { text: text.trim() || null, imageData };
    } catch (error: any) {
        console.log("🚀 ~ getGeminiImage ~ error:", error?.response?.data || error.message);
        throw error;
    }
}
