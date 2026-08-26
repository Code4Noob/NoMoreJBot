/**
 * Playwright 版 crawler：headless Chromium 渲染 JS 網頁，抽出標題 + 正文文字。
 *
 * 比 cheerio（淨係睇靜態 HTML）好 —— 支援 SPA / JS 渲染嘅頁面，
 * 同 crawl4ai 一樣用真 browser 攞渲染後嘅內容。
 *
 * 註：呢個 crawler 用 Chromium 自身網絡（唔行 VPN tunnel），
 *     VPN 主要係畀 Gemini API 用，一般網頁直連就得。
 */
import { chromium, type Browser } from "playwright";

// 共用一個 browser instance（lazy），唔使每次 search/crawl 都重新 launch（慳時間 + 慳 memory）
let sharedBrowser: Browser | null = null;
async function getSharedBrowser(): Promise<Browser> {
    if (!sharedBrowser || !sharedBrowser.isConnected()) {
        sharedBrowser = await chromium.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
    }
    return sharedBrowser;
}

/** 硬 timeout：就算網頁 load 唔完 / browser hang 都唔會卡死個 AI request（原 promise 繼續跑但唔會變 unhandled rejection） */
async function withHardTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    });
    // 原 promise 之後先 settle 都唔好變 unhandled rejection
    p.catch(() => {});
    try {
        return await Promise.race([p, timeout]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export interface CrawlResult {
    title: string;
    text: string;
    url: string;
}

const MAX_TEXT = 12000;

export async function crawlUrlToText(url: string): Promise<CrawlResult> {
    const browser = await getSharedBrowser();
    const page = await browser.newPage();
    try {
        return await withHardTimeout(
            (async () => {
                await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
                try {
                    await page.waitForLoadState("networkidle", { timeout: 5000 });
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
            })(),
            35_000
        );
    } finally {
        await page.close().catch(() => {});
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
 *
 * 而家行「RSS 快路優先」：Bing 有 `&format=rss` 會直接出 XML（唔使開 browser），
 * 快（~300ms）、唔會 hang、連 Docker 冇裝 Chromium 都用得；
 * 萬一 RSS 出唔到結果先 fallback 去 Playwright 渲染版（有硬 timeout 兜底）。
 * 註：要用真實 User-Agent + zh-HK locale，否則 Bing 會當 bot 出 generic 結果。
 */
const SEARCH_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** 解 HTML entities（RSS 標題 / 描述會用 &amp; 等）+ 剝 CDATA marker */
function decodeEntities(s: string): string {
    return s
        .replace(/<!\[CDATA\[|\]\]>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&#x27;/g, "'")
        .replace(/&nbsp;/g, " ");
}
function stripTags(s: string): string {
    return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** DDG lite 嘅結果 link 係 redirect（//duckduckgo.com/l/?uddg=<encoded>&rut=…），解返做真實 URL */
function decodeDdgUrl(href: string): string {
    try {
        const m = href.match(/[?&]uddg=([^&]+)/);
        if (m) return decodeURIComponent(m[1]);
    } catch (_) {
        /* 解唔到就留返原本 */
    }
    return href;
}

/**
 * 快路搜尋（主力）：DuckDuckGo Lite（純 HTTP，10s abort，唔會 hang）。
 * 呢個 network 出嚟嘅結果比 Bing 準好多（Bing 有時會俾 generic/過期結果，DDG 正常）。
 */
async function searchWebDdg(query: string): Promise<SearchResult[]> {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                "user-agent": SEARCH_UA,
                "accept-language": "zh-HK,zh;q=0.9,en;q=0.8",
            },
        });
        const html = await res.text();
        const anchors = [
            ...html.matchAll(/<a rel="nofollow" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g),
        ]
            .map((m) => ({
                url: decodeEntities(m[1]),
                title: decodeEntities(stripTags(m[2])),
            }))
            .filter((x) => x.title && x.url && !x.url.startsWith("javascript:"));
        const snippets = [
            ...html.matchAll(/class=['"]result-snippet['"]>([\s\S]*?)<\/td>/g),
        ].map((m) => decodeEntities(stripTags(m[1])));

        const out: SearchResult[] = [];
        for (let i = 0; i < anchors.length && out.length < MAX_RESULTS; i++) {
            out.push({
                title: anchors[i].title.slice(0, 200),
                url: decodeDdgUrl(anchors[i].url),
                snippet: (snippets[i] || "").slice(0, 300),
            });
        }
        return out;
    } finally {
        clearTimeout(timer);
    }
}

/** 快路搜尋 fallback：Bing RSS（純 HTTP，10s abort，唔會 hang） */
async function searchWebRss(query: string): Promise<SearchResult[]> {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&mkt=zh-HK`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                "user-agent": SEARCH_UA,
                "accept-language": "zh-HK,zh;q=0.9,en;q=0.8",
            },
        });
        const text = await res.text();
        const out: SearchResult[] = [];
        const items = text.matchAll(/<item>([\s\S]*?)<\/item>/g);
        for (const m of items) {
            if (out.length >= MAX_RESULTS) break;
            const block = m[1];
            const title = decodeEntities(
                stripTags(block.match(/<title>(.*?)<\/title>/)?.[1] || "")
            );
            const link = decodeEntities(
                block.match(/<link>(.*?)<\/link>/)?.[1] || ""
            );
            if (!title || !link) continue;
            const snippet = decodeEntities(
                stripTags(block.match(/<description>(.*?)<\/description>/)?.[1] || "")
            ).slice(0, 300);
            out.push({ title, url: link, snippet });
        }
        return out;
    } finally {
        clearTimeout(timer);
    }
}

/** Fallback：Playwright 渲染 Bing（RSS 出唔到結果 / 出錯先用），有硬 timeout 兜底 */
async function searchWebPlaywright(query: string): Promise<SearchResult[]> {
    const browser = await getSharedBrowser();
    const context = await browser.newContext({ userAgent: SEARCH_UA, locale: "zh-HK" });
    const page = await context.newPage();
    try {
        return await withHardTimeout(
            (async () => {
                const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&mkt=zh-HK`;
                await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
                try {
                    await page.waitForLoadState("networkidle", { timeout: 5000 });
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

                return results;
            })(),
            25_000
        );
    } finally {
        await context.close().catch(() => {});
    }
}

export async function searchWeb(query: string): Promise<SearchResult[]> {
    // 1) 快路（主力）：DuckDuckGo Lite（純 HTTP，冇 browser，結果準 + 唔會 hang）
    try {
        const ddg = await searchWebDdg(query);
        if (ddg.length > 0) return ddg;
        console.log(`⚠️ DDG 冇結果（query: ${query}），fallback 去 Bing RSS`);
    } catch (err: any) {
        console.log("⚠️ DDG 失敗，fallback 去 Bing RSS:", err?.message || err);
    }
    // 2) Fallback：Bing RSS（純 HTTP）
    try {
        const rss = await searchWebRss(query);
        if (rss.length > 0) return rss;
        console.log(`⚠️ Bing RSS 冇結果（query: ${query}），fallback 去 Playwright`);
    } catch (err: any) {
        console.log("⚠️ Bing RSS 失敗，fallback 去 Playwright:", err?.message || err);
    }
    // 3) Last resort：Playwright 渲染 Bing
    return searchWebPlaywright(query);
}
