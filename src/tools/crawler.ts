/**
 * Playwright 版 crawler：headless Chromium 渲染 JS 網頁，抽出標題 + 正文文字。
 *
 * 比 cheerio（淨係睇靜態 HTML）好 —— 支援 SPA / JS 渲染嘅頁面，
 * 同 crawl4ai 一樣用真 browser 攞渲染後嘅內容。
 *
 * 註：呢個 crawler 用 Chromium 自身網絡（唔行 VPN tunnel），
 *     VPN 主要係畀 Gemini API 用，一般網頁直連就得。
 */
import fs from "fs";
import path from "path";
import {
    chromium,
    type Browser,
    type BrowserContext,
    type Page,
} from "playwright";

// 共用一個 browser instance（lazy），唔使每次 search/crawl 都重新 launch（慳時間 + 慳 memory）。
// 用單一 promise guard：並發 request 同時 call 都只會 launch 一次，唔會開多個 browser（leak）。
let sharedBrowser: Browser | null = null;
let sharedBrowserPromise: Promise<Browser> | null = null;
async function getSharedBrowser(): Promise<Browser> {
    if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
    // 舊 browser 死咗 / 未起 → 清走 reference 再重新 launch
    if (sharedBrowser) {
        sharedBrowser = null;
        sharedBrowserPromise = null;
    }
    if (!sharedBrowserPromise) {
        sharedBrowserPromise = chromium
            .launch({
                headless: true,
                args: ["--no-sandbox", "--disable-setuid-sandbox"],
            })
            .then((b) => {
                sharedBrowser = b;
                return b;
            })
            .catch((err) => {
                // launch 失敗就 reset，下次再試
                sharedBrowserPromise = null;
                sharedBrowser = null;
                throw err;
            });
    }
    return sharedBrowserPromise;
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
    let page: Page | null = null;
    try {
        const browser = await getSharedBrowser();
        page = await browser.newPage();
        return await withHardTimeout(
            (async () => {
                await page!.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
                try {
                    await page!.waitForLoadState("networkidle", { timeout: 5000 });
                } catch (_) {
                    /* 等唔到 network idle 就算，用 domcontentloaded 後嘅內容 */
                }

                const title = await page!.title();
                // 優先攞 article / main 正文，冇就成個 body
                const text = await page!.evaluate(() => {
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
        if (page) await page.close().catch(() => {});
    }
}

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
    /** 邊個 search engine 搵返嚟（startpage / google_api / ddg / bing_rss / bing_playwright…） */
    engine?: string;
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
 * 主力：Google Programmable Search JSON API（官方 API，結果最準，中文查詢冇 DDG 嗰啲鳥問題）。
 * 要 GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX（https://programmablesearchengine.google.com/
 * 開一個「搜尋整個網頁」嘅 engine；100 queries/day 免費，之後 $5 / 1000 queries）。
 * 冇 key 就直接 skip 返去 DDG/Bing。
 */
async function searchWebGoogle(query: string): Promise<SearchResult[]> {
    const key = process.env.GOOGLE_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_CX;
    if (!key || !cx) throw new Error("GOOGLE_SEARCH_API_KEY / GOOGLE_SEARCH_CX 未設定");

    const url =
        `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}` +
        `&q=${encodeURIComponent(query)}&num=${MAX_RESULTS}` +
        `&hl=zh-HK&gl=hk`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
        }
        const data: any = await res.json();
        const items: any[] = data.items ?? [];
        return items.slice(0, MAX_RESULTS).map((it) => ({
            title: (it.title || "").slice(0, 200),
            url: it.link || "",
            snippet: (it.snippet || "").slice(0, 300),
        })).filter((x) => x.title && x.url);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 免 key 版：用 Playwright 直接 scrape Google 搜尋頁。
 * 唔使任何 key，但 Google 會反 bot：同一 IP 爆多幾下就出 CAPTCHA / 429，
 * 所以只做 fallback 層，唔好依佢做主力。
 */

// CAPTCHA 冷卻：一撞 CAPTCHA，呢段時間內直接跳過 Google scrape（唔好嘥 Playwright launch 時間）
let googleScrapeBlockedUntil = 0;
const GOOGLE_SCRAPE_COOLDOWN_MS = 10 * 60 * 1000;

async function searchWebGoogleScrape(query: string): Promise<SearchResult[]> {
    if (Date.now() < googleScrapeBlockedUntil) {
        throw new Error("Google scrape 冷卻中（之前撞過 CAPTCHA）");
    }
    let context: BrowserContext | null = null;
    try {
        const browser = await getSharedBrowser();
        context = await browser.newContext({
            userAgent: SEARCH_UA,
            locale: "zh-HK",
        });
        const page = await context.newPage();
        return await withHardTimeout(
            (async () => {
                const url =
                    `https://www.google.com/search?q=${encodeURIComponent(query)}` +
                    `&num=${MAX_RESULTS}`;
                await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

                // 出咗 CAPTCHA（/sorry/ 頁）就即刻放棄，交返俾下一層
                if (page.url().includes("/sorry/") || page.url().includes("google.com/sorry")) {
                    googleScrapeBlockedUntil = Date.now() + GOOGLE_SCRAPE_COOLDOWN_MS;
                    console.log("🚫 Google CAPTCHA，10 分鐘內跳過 Google scrape");
                    throw new Error("Google CAPTCHA（IP 被反bot）");
                }

                return await page.evaluate((max) => {
                    const out: SearchResult[] = [];
                    // 每個結果都係一個 h3（入面係標題），最近嘅版面 anchor 係 h3 嘅 parent
                    for (const h3 of Array.from(document.querySelectorAll("h3"))) {
                        if (out.length >= max) break;
                        const a = h3.closest("a") as HTMLAnchorElement | null;
                        if (!a?.href || a.href.startsWith("https://www.google.com/search?")) continue;
                        const title = (h3.textContent || "").trim();
                        if (!title) continue;
                        // snippet：結果 block 入面最大嚿文字節點（冇官方 class，就近揀）
                        const block = a.closest("div[data-hveid], div.g, div") as HTMLElement | null;
                        const snippet = (
                            block?.querySelector("div.VwiC3b, div[data-sncf], span.aCOpRe")
                                ?.textContent || ""
                        ).trim();
                        out.push({ title, url: a.href, snippet: snippet.slice(0, 300) });
                    }
                    return out;
                }, MAX_RESULTS);
            })(),
            25_000
        );
    } finally {
        if (context) await context.close().catch(() => {});
    }
}

/**
 * 主力：Startpage —— 佢背後就係 Google 結果。
 * Anubis proof-of-work anti-bot：headless 解 challenge 好唔穩定（有時 90s 過，有時死都唔過），
 * 所以策略係：
 *   1. 開一個常駐 browser + page，challenge 只解一次，之後所有 search 都重用同一頁
 *   2. 有 WSLg / display 就用 headed mode（真 browser window，過率高好多）
 *   3. cookies 同步存落 state file，restart 都慳返
 */
const SP_STATE_FILE = path.resolve(process.cwd(), "log/startpage-state.json");

let spBrowser: Browser | null = null;
let spContext: BrowserContext | null = null;
let spPage: Page | null = null;
let spQueue: Promise<unknown> = Promise.resolve(); // 簡單 mutex：一條 page 逐個 search 用

async function ensureStartpagePage(): Promise<Page> {
    if (spPage && !spPage.isClosed()) return spPage;

    // 舊嘅死咗就清走
    if (spBrowser) {
        await spBrowser.close().catch(() => {});
        spBrowser = null;
        spContext = null;
        spPage = null;
    }

    const storageState = fs.existsSync(SP_STATE_FILE)
        ? SP_STATE_FILE
        : undefined;

    // headless（可設 STARTPAGE_HEADLESS=false 轉 headed，過 anti-bot 機率較高但會彈 window）
    let launched: Browser | null = null;
    if (process.env.STARTPAGE_HEADLESS === "false") {
        try {
            launched = await chromium.launch({
                headless: false,
                args: ["--no-sandbox", "--disable-setuid-sandbox"],
            });
        } catch (err: any) {
            console.log(
                "⚠️ Startpage headed mode 開唔到（冇 display?），轉 headless:",
                err?.message || err
            );
        }
    }
    if (!launched) {
        launched = await chromium.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
    }
    spBrowser = launched;
    spContext = await spBrowser.newContext({
        userAgent: SEARCH_UA,
        locale: "zh-HK",
        ...(storageState ? { storageState } : {}),
    });
    spPage = await spContext.newPage();
    return spPage;
}

/** 用常駐 page 跑一個 Startpage search（serialize 防並發撞車） */
function startpageSearch(query: string): Promise<SearchResult[]> {
    const run = async (): Promise<SearchResult[]> => {
        const page = await ensureStartpagePage();
        await page.goto(
            `https://www.startpage.com/sp/search?query=${encodeURIComponent(query)}` +
                `&cat=web&language=hongkong`,
            { waitUntil: "domcontentloaded", timeout: 20000 }
        );

        // 等結果 anchor：有 cookies 即刻有；要重新 challenge 就要等運算（可以好耐）
        try {
            await page.waitForSelector("a.result-link, a.wgl-title", {
                timeout: 140_000,
            });
        } catch (_) {
            // challenge 過唔到：丢弃個 page，下次重新嚟（state file 都清埋等佢重解）
            try {
                if (fs.existsSync(SP_STATE_FILE)) fs.unlinkSync(SP_STATE_FILE);
            } catch (_) {}
            spPage = null;
            await spContext?.close().catch(() => {});
            spContext = null;
            const state = await page
                .content()
                .then((c) => (c.length < 50_000 ? "challenge/bot-check page" : "results page?"))
                .catch(() => "?");
            throw new Error(`Startpage 冇出結果（最後 state: ${state}）`);
        }

        const results = await page.evaluate((max) => {
            const out: SearchResult[] = [];
            for (const a of Array.from(
                document.querySelectorAll("a.result-link, a.wgl-title")
            ) as HTMLAnchorElement[]) {
                if (out.length >= max) break;
                let href = a.href || "";
                const m = href.match(/[?&]url=([^&]+)/);
                if (m) {
                    try {
                        href = decodeURIComponent(m[1]);
                    } catch (_) {}
                }
                const title = (a.textContent || "").trim();
                if (!title || !href.startsWith("http")) continue;
                // snippet：結果 block 入面嘅 <p>（唔係 display-url 嗰個）
                const block = a.closest("div[class]") as HTMLElement | null;
                let snippet = "";
                if (block) {
                    for (const p of Array.from(block.querySelectorAll("p"))) {
                        const t = (p.textContent || "").trim();
                        if (t && !t.startsWith("http")) {
                            snippet = t;
                            break;
                        }
                    }
                }
                out.push({
                    title: title.slice(0, 200),
                    url: href,
                    snippet: snippet.slice(0, 300),
                });
            }
            return out;
        }, MAX_RESULTS);

        // 順手 refresh state file，restart 都慳返 challenge
        try {
            await spContext?.storageState({ path: SP_STATE_FILE });
        } catch (_) {}
        return results;
    };

    // serialize：上一個 search 未完就排隊
    const next = spQueue.then(run, run);
    spQueue = next.catch(() => {});
    return next;
}

async function searchWebStartpage(query: string): Promise<SearchResult[]> {
    return await withHardTimeout(startpageSearch(query), 150_000);
}

/**
 * 快路搜尋：DuckDuckGo Lite（純 HTTP，10s abort，唔會 hang）。
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
    let context: BrowserContext | null = null;
    try {
        const browser = await getSharedBrowser();
        context = await browser.newContext({
            userAgent: SEARCH_UA,
            locale: "zh-HK",
        });
        const page = await context.newPage();
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
        if (context) await context.close().catch(() => {});
    }
}

/** 幫個 result set 貼上 engine 標籤 + log 用咗邊個 engine */
function tagEngine(results: SearchResult[], engine: string, query: string): SearchResult[] {
    results.forEach((r) => (r.engine = engine));
    console.log(`🔍 [${engine}] "${query}" → ${results.length} results`);
    return results;
}

export async function searchWeb(query: string): Promise<SearchResult[]> {
    // 0) 主力：Google Custom Search API（有 key 先用；結果最準）
    if (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX) {
        try {
            const google = await searchWebGoogle(query);
            if (google.length > 0) return tagEngine(google, "google_api", query);
            console.log(`⚠️ Google 冇結果（query: ${query}），fallback 去 DDG`);
        } catch (err: any) {
            console.log("⚠️ Google Search 失敗，fallback 去 DDG:", err?.message || err);
        }
    }
    // 1) 主力：Startpage（Google 結果代理，純 HTTP 快 + 反 bot 寬鬆，免 key）
    try {
        const sp = await searchWebStartpage(query);
        if (sp.length > 0) return sp;
        console.log(`⚠️ Startpage 冇結果（query: ${query}），fallback 去 Google scrape`);
    } catch (err: any) {
        console.log("⚠️ Startpage 失敗，fallback 去 Google scrape:", err?.message || err);
    }
    // 2) Playwright scrape Google（慢 + 會撞 CAPTCHA，撞親就交俾 DDG）
    try {
        const scraped = await searchWebGoogleScrape(query);
        if (scraped.length > 0) return scraped;
        console.log(`⚠️ Google scrape 冇結果（query: ${query}），fallback 去 DDG`);
    } catch (err: any) {
        console.log("⚠️ Google scrape 失敗，fallback 去 DDG:", err?.message || err);
    }
    // 3) 快路：DuckDuckGo Lite（純 HTTP，冇 browser，結果準 + 唔會 hang）
    try {
        const ddg = await searchWebDdg(query);
        if (ddg.length > 0) return ddg;
        console.log(`⚠️ DDG 冇結果（query: ${query}），fallback 去 Bing RSS`);
    } catch (err: any) {
        console.log("⚠️ DDG 失敗，fallback 去 Bing RSS:", err?.message || err);
    }
    // 4) Fallback：Bing RSS（純 HTTP）
    try {
        const rss = await searchWebRss(query);
        if (rss.length > 0) return rss;
        console.log(`⚠️ Bing RSS 冇結果（query: ${query}），fallback 去 Playwright`);
    } catch (err: any) {
        console.log("⚠️ Bing RSS 失敗，fallback 去 Playwright:", err?.message || err);
    }
    // 5) Last resort：Playwright 渲染 Bing
    return searchWebPlaywright(query);
}
