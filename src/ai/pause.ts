/**
 * AI 暫停狀態（per-channel，in-memory）
 *
 * /pause /resume 用：pause 咗嗰條 channel 唔會再 call AI（慳 token / 玩嘢時用）。
 * 淨係 in-memory —— bot restart 就自動 resume，啱晒「暫時停一停」呢個用途。
 */
const pausedChannels = new Set<string>();

export function pauseAI(channelId: string | number): void {
    pausedChannels.add(String(channelId));
}

export function resumeAI(channelId: string | number): void {
    pausedChannels.delete(String(channelId));
}

export function isAIPaused(channelId: string | number): boolean {
    return pausedChannels.has(String(channelId));
}

/** /pause 嗰陣顯示而家暫停咗邊啲 channel */
export function getPausedChannels(): string[] {
    return [...pausedChannels];
}

export const AI_PAUSED_MSG =
    "😴 AI 已暫停咗（admin 用 /pause 暫停咗呢條 channel），想我返工就 /resume 啦";
