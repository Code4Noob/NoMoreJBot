// 統一 AI response logging

export function logAIResponse(opts: {
    provider: string;
    model: string;
    finishReason?: string;
    tokens?: number;
    toolCalls?: number;
    toolNames?: string[];
    message?: string | null;
}) {
    const text = (opts.message || "").replace(/\s+/g, " ").trim();
    const preview = text.slice(0, 150);
    const tools = `tools=${opts.toolCalls ?? opts.toolNames?.length ?? 0}`;
    // 純 tool call（冇文字）→ preview 顯示 call 咗邊個 tool
    const isToolCallOnly = !!opts.toolNames?.length && !text;
    const fallbackPreview = isToolCallOnly ? `🔧 ${opts.toolNames?.join(", ")}` : "";
    console.log(
        `[AI:${opts.provider}] ${opts.model} | finish=${opts.finishReason ?? "n/a"} | tokens=${opts.tokens ?? 0} | ${tools}\n  ↳ ${preview || fallbackPreview}`
    );
}
