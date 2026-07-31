// 統一 AI response logging

export function logAIResponse(opts: {
    provider: string;
    model: string;
    finishReason?: string;
    tokens?: number;
    toolCalls?: number;
    message?: string | null;
}) {
    const preview = (opts.message || "").replace(/\s+/g, " ").trim().slice(0, 150);
    console.log(
        `[AI:${opts.provider}] ${opts.model} | finish=${opts.finishReason ?? "n/a"} | tokens=${opts.tokens ?? 0} | tools=${opts.toolCalls ?? 0}\n  ↳ ${preview}`
    );
}
