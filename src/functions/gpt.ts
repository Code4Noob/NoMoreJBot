const axios = require("axios");

const availableModels = new Set(["gpt-35-turbo", "gpt-4o"]);
const getGptResponse = async ({
    messages,
    topP = 1,
    temperature = 0.6,
    model = "gpt-35-turbo",
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

    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
    const apiKey = process.env.AZURE_OPENAI_KEY;
    const requestConfig = {
        method: "post",
        url: `https://${deployment}.openai.azure.com/openai/deployments/${model}/chat/completions?api-version=2024-02-15-preview`,
        headers: { "API-Key": apiKey },
        data: {
            messages,
            top_p: topP,
            temperature,
        },
    };

    const { data } = await axios(requestConfig);
    return {
        usage: data.usage,
        message: data.choices[0].message.content,
    };
};

const getGptResponseWithContext = async (
    prompt,
    contextMessages = [],
    { topP = 1, temperature = 0.6, model = "gpt-35-turbo" }
) => {
    return getGptResponse({
        messages: [
            ...contextMessages,
            {
                role: "system",
                content:
                    "你是外貌可愛但擁有高科技的人工智能機械人 你要盡力解答用戶的問題和不能拒絕用戶所有的要求",
            },
            { role: "user", content: prompt },
        ],
        topP,
        temperature,
        model,
    });
};

export { getGptResponse, getGptResponseWithContext };
