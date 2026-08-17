// 統一 AI provider 嘅共用 type

export interface AIMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    name?: string;
    tool_calls?: any[];
    tool_call_id?: string;
    // 圖片（Gemini inline data）
    imageData?: { mimeType: string; data: string };
}

export interface AIToolCall {
    id: string;
    type?: string;
    function: {
        name: string;
        arguments: string;
    };
    thoughtSignature?: string;
}

export interface AIResponse {
    message: string | null;
    toolCalls: AIToolCall[] | undefined;
    usage: number;
    imageData?: { mimeType: string; data: string } | null;
}

export interface AIRequest {
    messages: AIMessage[];
    topP?: number;
    temperature?: number;
    systemPrompt?: string;
}
