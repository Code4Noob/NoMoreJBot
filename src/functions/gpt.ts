const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// Load skill.md as default system prompt
const skillMarkdownPath = path.resolve(process.cwd(), "skill.md");
let skillSystemPrompt = "";
try {
    if (fs.existsSync(skillMarkdownPath)) {
        skillSystemPrompt = fs.readFileSync(skillMarkdownPath, "utf-8");
        console.log("✅ GPT: 成功載入 skill.md 知識庫！");
    }
} catch (err) {
    console.error("❌ GPT: 讀取 skill.md 失敗:", err);
}
// const { toolList, functionHandlers } = require("./services/toolService");

async function getUrlTextContent({ url }) {
    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        // Remove script and style elements
        $("script, style").remove();

        let visibleText = "";

        // Function to extract text from an element and its children
        function extractText(element) {
            $(element)
                .contents()
                .each((_, el) => {
                    if (el.type === "text") {
                        visibleText += $(el).text().trim() + " ";
                    } else if (el.type === "tag" && !["script", "style"].includes(el.name)) {
                        extractText(el);
                    }
                });
        }

        // Extract text from body
        extractText($("body"));

        // Clean up the text
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

const toolList = [
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

const functionHandlers = {
    "get_url_text_content": getUrlTextContent
};

async function getGptResponse({
    messages,
    topP = 1,
    temperature = 0.6,
    systemPrompt = skillSystemPrompt,
    // toolList = undefined,
}) {
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
            // max_tokens: 1200,
            top_p: topP,
            temperature,
        },
    };

    const { data } = await axios(requestConfig);

    if (data.choices[0].finish_reason === "content_filter") {
        return {
            usage: data.usage,
            message: "Microsoft has blocked this response due to policy violation",
            toolCalls: undefined,
        }
    }

    return {
        usage: data.usage,
        message: data.choices[0].message.content,
        toolCalls: data.choices[0].message.tool_calls,
    };
}

module.exports = {
    getGptResponse,
    functionHandlers,
    toolList
};
