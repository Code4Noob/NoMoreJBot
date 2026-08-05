import fs from "fs";
import path from "path";
import axios from "axios";
import { getGeminiResponse } from "../ai/models/gemini";

// 貼圖辨識 cache（file_unique_id -> meaning），唔使每次 call Gemini
const STICKER_CACHE_PATH = path.resolve(process.cwd(), "chat/sticker-cache.json");

const STICKER_ANALYZER_PROMPT = `你係一個貼圖分析器。睇住貼圖，用一句簡短嘅廣東話（最多 15 字）描述佢嘅意思或情緒，開頭加返貼圖對應嘅 emoji（如果有）。淨係輸出描述本身，唔好加引號、解釋或前後綴。例如：「👍 讚好」、「😂 笑到喊」、「😢 好傷心」。`;

function loadStickerCache(): Record<string, any> {
    try {
        if (fs.existsSync(STICKER_CACHE_PATH)) {
            return JSON.parse(fs.readFileSync(STICKER_CACHE_PATH, "utf-8"));
        }
    } catch (err: any) {
        console.log("❌ loadStickerCache 失敗:", err?.message || err);
    }
    return {};
}

function saveStickerCache(cache: Record<string, any>): void {
    try {
        fs.writeFileSync(STICKER_CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
    } catch (err: any) {
        console.log("❌ saveStickerCache 失敗:", err?.message || err);
    }
}

// 由 Telegram file link 嘅 extension 判定 mimeType（webp / jpg / png）
function detectMimeType(fileLink: string, fallback: string): string {
    const match = fileLink.split("?")[0].match(/\.(\w+)$/);
    const ext = match?.[1]?.toLowerCase();
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    return fallback;
}

// 攞可以做視覺辨識嘅來源：
//   - 靜態貼圖 -> 原圖（webp）
//   - animated (tgs) / video (webm) -> 用 Telegram 提供嘅 thumbnail 靜態預覽圖
// 冇 thumbnail 就 return null（fallback 去 emoji + 類型）
function getRecognizableSource(sticker: any): { fileId: string; mimeType: string } | null {
    if (!sticker.is_animated && !sticker.is_video) {
        return { fileId: sticker.file_id, mimeType: "image/webp" };
    }
    const thumb = sticker.thumbnail;
    if (thumb?.file_id) {
        return { fileId: thumb.file_id, mimeType: "image/webp" };
    }
    return null;
}

async function recognizeWithGemini(telegram: any, fileId: string, mimeType: string): Promise<string> {
    const fileLink = await telegram.getFileLink(fileId);
    const finalMime = detectMimeType(fileLink.href, mimeType);
    const resp = await axios.get(fileLink.href, { responseType: "arraybuffer" });
    const result = await getGeminiResponse({
        messages: [
            {
                role: "user",
                content: "呢個貼圖係咩意思？",
                imageData: {
                    mimeType: finalMime,
                    data: Buffer.from(resp.data).toString("base64"),
                },
            } as any,
        ],
        systemPrompt: STICKER_ANALYZER_PROMPT,
        temperature: 0.2,
    });
    const meaning = (result.message || "").replace(/\r?\n|\r/g, " ").trim();
    if (!meaning) throw new Error("Gemini 冇回覆貼圖意思");
    return meaning;
}

function fallbackMeaning(sticker: any): string {
    const emoji = sticker.emoji || "🖼️";
    const pack = sticker.set_name ? `（${sticker.set_name} 貼圖包）` : "";
    if (sticker.is_video) return `${emoji} [video sticker${pack}]`;
    if (sticker.is_animated) return `${emoji} [animated sticker${pack}]`;
    return `${emoji} [sticker${pack}]`;
}

/**
 * 讀取貼圖內容：cache 有就直接用，冇就 call Gemini 辨識
 * （靜態用原圖；animated / video 用 thumbnail 預覽圖），再存入本地 cache。
 * 完全冇圖可用就 fallback 去 emoji + 類型。
 */
export async function describeSticker(sticker: any, telegram: any): Promise<string> {
    const cacheKey = sticker.file_unique_id;
    const cache = loadStickerCache();
    if (cache[cacheKey]?.meaning) return cache[cacheKey].meaning;

    let meaning = "";
    const source = getRecognizableSource(sticker);
    if (source) {
        try {
            meaning = await recognizeWithGemini(telegram, source.fileId, source.mimeType);
        } catch (err: any) {
            console.log("🚀 ~ describeSticker ~ Gemini 辨識失敗:", err?.message || err);
        }
    }
    if (!meaning) meaning = fallbackMeaning(sticker);

    cache[cacheKey] = {
        meaning,
        emoji: sticker.emoji || "",
        fileId: sticker.file_id || "",
        setName: sticker.set_name || "",
        type: sticker.type || "",
        cachedAt: new Date().toISOString(),
    };
    saveStickerCache(cache);
    return meaning;
}

export function getCachedStickers(): { fileId: string; meaning: string; emoji: string; setName: string }[] {
    const cache = loadStickerCache();
    const list: { fileId: string; meaning: string; emoji: string; setName: string }[] = [];
    for (const entry of Object.values(cache)) {
        if (entry?.fileId) {
            list.push({
                fileId: entry.fileId,
                meaning: entry.meaning || "",
                emoji: entry.emoji || "",
                setName: entry.setName || "",
            });
        }
    }
    return list;
}

/**
 * 將舊 cache entry（喺加 fileId 之前 cache 落嚟嘅）補返 fileId：
 * 用 setName 攞返個 sticker set，再按 file_unique_id（cache key）搵返張貼圖攞 file_id。
 * 喺 bot 啟動時 call 一次。
 */
export async function backfillStickerCache(telegram: any): Promise<void> {
    const cache = loadStickerCache();
    let changed = false;
    for (const [key, entry] of Object.entries(cache)) {
        if (entry?.fileId || !entry?.setName) continue;
        try {
            const { stickers } = await telegram.getStickerSet(entry.setName);
            const found = stickers.find((s: any) => s.file_unique_id === key);
            if (found?.file_id) {
                entry.fileId = found.file_id;
                changed = true;
                console.log(`✅ backfill sticker fileId: ${key}`);
            } else {
                console.log(`⚠️ backfill 搵唔到 ${key}（喺 ${entry.setName}）`);
            }
        } catch (err: any) {
            console.log(`⚠️ backfill ${entry.setName} 失敗:`, err?.message || err);
        }
    }
    if (changed) saveStickerCache(cache);
}
