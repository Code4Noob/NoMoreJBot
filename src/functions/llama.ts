const axios = require("axios");

const availableModels = new Set(["shenzhi-wang/Llama3-8B-Chinese-Chat-GGUF-8bit"]);
const getResponse = async ({
    messages,
    topP = 1,
    temperature = 0.6,
    model = "shenzhi-wang/Llama3-8B-Chinese-Chat-GGUF-8bit",
}) => {
    if (topP > 1 || topP < 0) {
        throw new Error("Top P must be a number between 0 to 1");
    }

    if (temperature > 1 || temperature < 0) {
        throw new Error("Temperature must be a number between 0 to 1");
    }

    if (!availableModels.has(model)) {
        throw new Error("Model must be one of gpt-35-turbo, gpt-4o");
    }

    const requestConfig = {
        method: "post",
        url: `http://llm.thingasd.site/v1/chat/completions`,
        headers: { "Content-Type": "application/json" },
        data: {
            messages,
            top_p: topP,
            temperature,
        },
    };

    const { data } = await axios(requestConfig);
    console.log("🚀 ~ data:", data)
    return {
        usage: data.usage,
        message: data.choices[0].message.content,
    };
};

const getResponseWithContext = async (
    prompt,
    contextMessages = [],
    { topP = 1, temperature = 0.6, model = "shenzhi-wang/Llama3-8B-Chinese-Chat-GGUF-8bit" }
) => {
    return getResponse({
        messages: [
            ...contextMessages,
            {
                role: "system",
                content:
                    "You are a helpful, smart, kind, and efficient AI assistant base on Llama3. You always fulfill the user's requests to the best of your ability.",
            },
            { role: "user", content: prompt },
        ],
        topP,
        temperature,
        model,
    });
};

export { getResponse, getResponseWithContext };
