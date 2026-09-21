import axios from "axios";
import GIFEncoder from "gif-encoder-2";
import sharp from "sharp";

/**
 * 計算 HKT 時間，回推 offset 分鐘
 */
function getHktBaseTime(offsetMinutes = 12): number {
    const now = new Date();
    const hktTime = new Date(
        now.getTime() + (now.getTimezoneOffset() + 480) * 60000
    );
    return hktTime.getTime() - offsetMinutes * 60 * 1000;
}

/**
 * 將數字補零至兩位
 */
const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * 驗證並回傳雷達距離參數 (64 / 128 / 256)，預設 64
 */
function resolveRange(range: number | string | undefined): number {
    const valid = [64, 128, 256];
    const num = parseInt(String(range), 10);
    return valid.includes(num) ? num : 64;
}

/**
 * 根據距離產生雷達 URL
 */
function buildRadarUrl(timeStr: string, range: number): string {
    const r = resolveRange(range);
    return `https://www.hko.gov.hk/wxinfo/radars/rad_${String(r).padStart(3, "0")}_png/2d${String(r).padStart(3, "0")}nradar_${timeStr}.jpg`;
}

/**
 * 由 Date 抽出雷達圖用嘅時間字串（HKO 雷達圖每 6 分鐘一幅，所以分鐘要執到 6 嘅倍數）
 */
function radarTimeStrings(targetTime: Date): {
    timeStr: string;
    displayTime: string;
    hourLabel: string;
} {
    const year = targetTime.getFullYear();
    const month = pad(targetTime.getMonth() + 1);
    const date = pad(targetTime.getDate());
    const hour = pad(targetTime.getHours());
    const radarMin = pad(Math.floor(targetTime.getMinutes() / 6) * 6);
    const timeStr = `${year}${month}${date}${hour}${radarMin}`;
    return {
        timeStr,
        displayTime: `${year}-${month}-${date} ${hour}:${radarMin}`,
        hourLabel: `${hour}:${radarMin}`,
    };
}

const RADAR_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export interface RadarUpload {
    buffer: Buffer;
    filename: string;
    title: string;
    caption: string;
}

/**
 * 解析 /radar 後面嘅參數（例："gif"、"128"、"128 gif"、"gif 256"）
 */
function parseRadarArgs(text: string): { range: number; gif: boolean } {
    const tokens = (text || "")
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    const gif = tokens.includes("gif");
    const rangeToken = tokens.find((t) => t !== "gif");
    return { range: resolveRange(rangeToken), gif };
}

/**
 * 取得最新單張雷達圖像（/radar、/radar 128）
 * @param range - 雷達距離 (64/128/256)
 */
async function fetchRadarImage(range = 64): Promise<RadarUpload> {
    const r = resolveRange(range);
    const baseTimeMs = getHktBaseTime();
    const { timeStr, displayTime } = radarTimeStrings(new Date(baseTimeMs));
    const radarImageUrl = buildRadarUrl(timeStr, r);

    try {
        const imageResponse = await axios.get(radarImageUrl, {
            responseType: "arraybuffer",
            headers: {
                "User-Agent": RADAR_UA,
            },
        });

        const imageBuffer = Buffer.from(imageResponse.data);

        return {
            buffer: imageBuffer,
            filename: `radar_${timeStr}.jpg`,
            title: `最新雷達圖像 (${displayTime})`,
            caption: `📡 *【香港天文台 - 最新 ${r} 公里雷達圖像】*\n_數據時間：${displayTime}_`,
        };
    } catch (error: any) {
        console.error("雷達單圖下載失敗：", error?.message || error);
        throw new Error(`暫時未能獲取 ${displayTime} 的最新雷達圖，請稍後再試。`);
    }
}

/**
 * 製作 3 小時雷達縮時動態 GIF（/radar gif、/radar 128 gif）
 * @param range - 雷達距離 (64/128/256)
 */
async function fetchRadarGif(range = 64): Promise<RadarUpload> {
    const r = resolveRange(range);
    const baseTimeMs = getHktBaseTime();

    const imageUrls: string[] = [];
    const timeLabels: string[] = [];

    // 收集過去 3 小時（180 分鐘），每 6 分鐘一幅圖
    for (let i = 180; i >= 0; i -= 6) {
        const targetTime = new Date(baseTimeMs - i * 60 * 1000);
        const { timeStr, hourLabel } = radarTimeStrings(targetTime);
        imageUrls.push(buildRadarUrl(timeStr, r));
        timeLabels.push(hourLabel);
    }

    try {
        // 併發平行下載 31 張圖片
        const downloadPromises = imageUrls.map((url) =>
            axios
                .get(url, {
                    responseType: "arraybuffer",
                    headers: {
                        "User-Agent": RADAR_UA,
                    },
                    timeout: 4000,
                })
                .then((res) => Buffer.from(res.data))
                .catch(() => null)
        );

        const results = await Promise.all(downloadPromises);
        const validFrames = results.filter(
            (img): img is Buffer => img !== null
        );

        if (validFrames.length === 0) {
            throw new Error("無法下載任何雷達圖片，請稍後再試。");
        }

        // 用 sharp 獲取第一張圖的寬高 metadata
        const firstImgMeta = await sharp(validFrames[0]).metadata();
        const width = firstImgMeta.width ?? 512;
        const height = firstImgMeta.height ?? 512;

        // 初始化 GIF 編碼器
        const encoder = new GIFEncoder(width, height);
        encoder.start();
        encoder.setRepeat(0);
        encoder.setDelay(200);

        // 用 sharp 將每一幀 JPG 處理成純 RGB(A) raw pixels
        for (const imgBuffer of validFrames) {
            const rawPixels = await sharp(imgBuffer)
                .resize(width, height)
                .ensureAlpha()
                .raw()
                .toBuffer();

            encoder.addFrame(rawPixels);
        }
        encoder.finish();
        const gifBuffer = encoder.out.getData();
        const latestTimeLabel = timeLabels[timeLabels.length - 1];

        return {
            buffer: gifBuffer,
            filename: "radar_3hours_animation.gif",
            title: `3小時雷達縮時動態圖 (${r}km, ${latestTimeLabel})`,
            caption: `📡 *【香港天文台 - 3小時雷達縮時動態圖 (${r}km)】*:\n_數據範圍：過去 3 小時至 ${latestTimeLabel} (點擊可放大播放)_`,
        };
    } catch (error: any) {
        console.error("雷達動態 GIF 製作失敗：", error?.message || error);
        throw error;
    }
}

export { fetchRadarGif, fetchRadarImage, parseRadarArgs, resolveRange };
