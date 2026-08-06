import { getCachedStickers } from "../tools/sticker";
import { crawlUrlToText } from "../tools/crawler";

// OpenAI-format tool list（DeepSeek / GPT 用）
export const toolList = [
    {
        type: "function",
        function: {
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
        }
    },
    {
        type: "function",
        function: {
            name: "get_cached_stickers",
            description: "Get the list of cached stickers (stickerId, meaning, emoji) that the bot can send. Use a returned stickerId in the reply as [sticker]: <stickerId> to send that sticker.",
            parameters: {
                type: "object",
                properties: {},
            }
        }
    }
];

// 共用 tool handlers（provider 無關）
export const functionHandlers: Record<string, (args: any) => Promise<any>> = {
    "get_url_text_content": async ({ url }: { url: string }) => {
        try {
            // Playwright 版：真 browser 渲染（支援 JS / SPA）+ 抽正文文字
            const { title, text } = await crawlUrlToText(url);
            return { siteTitle: title, textContent: text };
        } catch (error) {
            return {
                siteTitle: "Error while trying to get title",
                textContent: "Error while trying to get body text",
            };
        }
    },
    "get_cached_stickers": async () => {
        const stickers = getCachedStickers();
        return {
            count: stickers.length,
            stickers: stickers.slice(0, 50).map((s) => ({
                // 用 short id（file_unique_id），唔好用長 file_id —— 避免 AI 複製時改錯
                stickerId: s.id,
                meaning: s.meaning,
                emoji: s.emoji,
                pack: s.setName,
            })),
        };
    },
};
