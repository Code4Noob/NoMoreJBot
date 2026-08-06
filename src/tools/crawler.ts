/**
 * Playwright 版 crawler：headless Chromium 渲染 JS 網頁，抽出標題 + 正文文字。
 *
 * 比 cheerio（淨係睇靜態 HTML）好 —— 支援 SPA / JS 渲染嘅頁面，
 * 同 crawl4ai 一樣用真 browser 攞渲染後嘅內容。
 *
 * 註：呢個 crawler 用 Chromium 自身網絡（唔行 VPN tunnel），
 *     VPN 主要係畀 Gemini API 用，一般網頁直連就得。
 */
import { chromium } from "playwright";

export interface CrawlResult {
    title: string;
    text: string;
    url: string;
}

const MAX_TEXT = 12000;

export async function crawlUrlToText(url: string): Promise<CrawlResult> {
    let browser;
    try {
        browser = await chromium.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        try {
            await page.waitForLoadState("networkidle", { timeout: 10000 });
        } catch (_) {
            /* 等唔到 network idle 就算，用 domcontentloaded 後嘅內容 */
        }

        const title = await page.title();
        // 優先攞 article / main 正文，冇就成個 body
        const text = await page.evaluate(() => {
            const root =
                document.querySelector("article, main, [role='main']") ||
                document.body;
            return (root as HTMLElement).innerText || "";
        });

        let clean = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        if (clean.length > MAX_TEXT) {
            clean = clean.slice(0, MAX_TEXT) + "\n…(內容過長，已截斷)";
        }
        return { title, text: clean, url };
    } finally {
        if (browser) await browser.close();
    }
}
