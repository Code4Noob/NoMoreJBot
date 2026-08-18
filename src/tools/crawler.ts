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

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

const MAX_RESULTS = 6;

/**
 * 用 Bing 搜尋，攞 top 結果（標題 + URL + 摘要）。
 * 冇 API key，純 scrape；適合「唔知邊個 URL」嘅情況（歌詞、冷知識、新聞等）。
 * 想要詳細內容可以再配合 get_url_text_content fetch 某個結果。
 * 註：要用真實 User-Agent + zh-HK locale，否則 Bing 會當 bot 出 generic 結果；
 *     DuckDuckGo HTML 會直接出 captcha，所以用 Bing。
 */
const SEARCH_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export async function searchWeb(query: string): Promise<SearchResult[]> {
    let browser;
    try {
        browser = await chromium.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        const context = await browser.newContext({
            userAgent: SEARCH_UA,
            locale: "zh-HK",
        });
        const page = await context.newPage();
        const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&mkt=zh-HK`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        try {
            await page.waitForLoadState("networkidle", { timeout: 8000 });
        } catch (_) {
            /* 等唔到 network idle 就算 */
        }

        const results = await page.evaluate((max) => {
            const out: SearchResult[] = [];
            const items = Array.from(document.querySelectorAll("li.b_algo"));
            for (const li of items) {
                if (out.length >= max) break;
                const a = li.querySelector("h2 a") as HTMLAnchorElement | null;
                if (!a) continue;
                const title = (a.textContent || "").trim();
                if (!title) continue;
                const snippet = (
                    li.querySelector(".b_caption p")?.textContent || ""
                ).trim();
                out.push({ title, url: a.href, snippet });
            }
            return out;
        }, MAX_RESULTS);

        await context.close();
        return results;
    } finally {
        if (browser) await browser.close();
    }
}
