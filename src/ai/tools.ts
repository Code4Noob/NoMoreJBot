import vpnAxios from "../utils/vpn";

// OpenAI-format tool list（DeepSeek / GPT 用）
export const toolList = [
    {
        type: "function",
        function: {
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
    }
];

// 共用 tool handlers（provider 無關）
export const functionHandlers: Record<string, (args: any) => Promise<any>> = {
    "get_url_text_content": async ({ url }: { url: string }) => {
        try {
            const response = await vpnAxios.get(url);
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
