import axios from "axios";
import fs from "fs";
import path from "path";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY as string;
const GEMINI_MODEL = "gemini-3.6-flash";

// Load skill.md as default system prompt
const skillMarkdownPath = path.resolve(process.cwd(), "skill.md");
let skillSystemPrompt = "";
try {
    if (fs.existsSync(skillMarkdownPath)) {
        skillSystemPrompt = fs.readFileSync(skillMarkdownPath, "utf-8");
        console.log("✅ Gemini: 成功載入 skill.md 知識庫！");
    }
} catch (err) {
    console.error("❌ Gemini: 讀取 skill.md 失敗:", err);
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
            if (msg.content) {
                geminiMessages.push({ role: "user", parts: [{ text: msg.content }] });
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
            geminiMessages.push({
                role: "function",
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
        description: "Get the content of a https website specified by an URL in plain text format",
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
    }
];

export const functionHandlers: Record<string, (args: any) => Promise<any>> = {
    "get_url_text_content": async ({ url }: { url: string }) => {
        try {
            const response = await axios.get(url);
            const $ = (await import("cheerio")).load(response.data);
            $("script, style").remove();
            let visibleText = "";
            function extractText(element: any) {
                $(element).contents().each((_: any, el: any) => {
                    if (el.type === "text") {
                        visibleText += $(el).text().trim() + " ";
                    } else if (el.type === "tag" && !["script", "style"].includes(el.name)) {
                        extractText(el);
                    }
                });
            }
            extractText($("body"));
            visibleText = visibleText.replace(/\s+/g, " ").trim();
            return {
                siteTitle: $("title").text(),
                textContent: visibleText,
            };
        } catch (error) {
            return {
                siteTitle: "Error while trying to get title",
                textContent: "Error while trying to get body text",
            };
        }
    }
};

export async function getGeminiResponse({
    messages,
    topP = 1,
    temperature = 0.6,
    systemPrompt = skillSystemPrompt,
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
        const { data } = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
            requestBody
        );

        const candidate = data.candidates?.[0];
        if (!candidate) {
            console.log("🚀 ~ getGeminiResponse ~ no candidate:", JSON.stringify(data));
            return { message: "No response from Gemini", toolCalls: undefined, usage: 0, imageData: null };
        }

        const totalTokens = data.usageMetadata?.totalTokenCount ?? 0;
        const parts = candidate.content?.parts ?? [];

        console.log("🚀 ~ getGeminiResponse ~ finishReason:", candidate.finishReason, "parts:", parts.length, JSON.stringify(parts).slice(0, 500));

        if (parts.length === 0) {
            return { message: null, toolCalls: undefined, usage: totalTokens, imageData: null };
        }

        const toolCalls: ToolCall[] = [];
        let textParts: string[] = [];
        let imageData: { mimeType: string; data: string } | null = null;

        for (const part of parts) {
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
}: {
    prompt: string;
}): Promise<{ text: string | null; imageData: { mimeType: string; data: string } | null }> {
    const IMAGE_MODEL = "gemini-3.1-flash-lite-image";

    const requestBody: any = {
        contents: [
            {
                role: "user",
                parts: [{ text: prompt }],
            },
        ],
        generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
        },
    };

    try {
        const { data } = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
            requestBody
        );

        const candidate = data.candidates?.[0];
        if (!candidate) {
            console.log("🚀 ~ getGeminiImage ~ no candidate:", JSON.stringify(data));
            return { text: null, imageData: null };
        }

        const parts = candidate.content?.parts ?? [];
        let text = "";
        let imageData: { mimeType: string; data: string } | null = null;

        for (const part of parts) {
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
