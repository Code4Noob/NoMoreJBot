import { getCachedStickers } from "../tools/sticker";
import { crawlUrlToText, searchWeb } from "../tools/crawler";
import {
    searchKmbRoutes,
    getKmbRouteStops,
    getKmbStopEta,
    findNearbyKmbStops,
    getMtrLines,
    findMtrRoute,
    planJourney,
    searchCitybusRoutes,
    getCitybusRouteStops,
    getCitybusStopEta,
    findNearbyCitybusStops,
} from "../tools/transportation";

// 通用 config：call tool 時會唔會出「正在處理你的需求」greeting（per tool）
// 每個 tool 名對應一個開關：true = 會出，冇列到 / false = 唔出
// 喺 tg.ts 讀 toolsConfig.showGreeting[toolName] 決定
//（改「tools.showGreeting.<tool名>」就得，唔使改 tg.ts）
export const toolsConfig: { showGreeting: Record<string, boolean> } = {
    showGreeting: {
        // 路線工具（KMB / MTR）先出 greeting
        kmb_search_routes: true,
        kmb_get_route_stops: true,
        kmb_get_stop_eta: true,
        find_nearby_kmb_stops: true,
        mtr_get_lines: true,
        mtr_find_route: true,
    },
};

// OpenAI-format tool list（DeepSeek / GPT 用）
export const toolList = [
    {
        type: "function",
        function: {
            name: "get_url_text_content",
            description:
                "Get the main text content of a website specified by an URL (renders JS pages)",
            parameters: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description:
                            "URL to the https website where text content will be obtained",
                    },
                },
                required: ["url"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "web_search",
            description:
                "Search the web and return top results (title, url, snippet). Use when you need to find or verify information and don't know the exact URL (song lyrics, facts, news, prices, etc.).",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description:
                            "The search query (e.g. 「周柏豪 宏願 歌詞」)",
                    },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_cached_stickers",
            description:
                "Get the list of cached stickers (stickerId, meaning, emoji) that the bot can send. Use a returned stickerId in the reply as [sticker]: <stickerId> to send that sticker.",
            parameters: {
                type: "object",
                properties: {},
            },
        },
    },
    {
        type: "function",
        function: {
            name: "kmb_search_routes",
            description:
                "搜尋九巴(KMB)/龍運(LWB)巴士路線，用路線號或起點/終點地名做關鍵字。回傳路線號、方向(bound: O=去程/I=回程)、起點同終點。",
            parameters: {
                type: "object",
                properties: {
                    keyword: {
                        type: "string",
                        description:
                            "路線號（例如「1A」）或地名（例如「尖沙咀」）",
                    },
                },
                required: ["keyword"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "kmb_get_route_stops",
            description:
                "攞某一條巴士路線嘅順序車站表（由起點到終點）。要先知道 route 同 bound。",
            parameters: {
                type: "object",
                properties: {
                    route: {
                        type: "string",
                        description: "路線號（例如「1A」）",
                    },
                    bound: {
                        type: "string",
                        description:
                            "方向：O = 去程（outbound），I = 回程（inbound）",
                    },
                    service_type: {
                        type: "string",
                        description: "服務類型，通常係「1」，可以省略",
                    },
                },
                required: ["route", "bound"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "kmb_get_stop_eta",
            description:
                "攞某個巴士站（用 stop id）下一班車嘅到站時間（ETA）。",
            parameters: {
                type: "object",
                properties: {
                    stop_id: {
                        type: "string",
                        description:
                            "巴士站 ID（由 find_nearby_kmb_stops 或 kmb_get_route_stops 回傳）",
                    },
                },
                required: ["stop_id"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "find_nearby_kmb_stops",
            description:
                "用地名搜尋附近嘅九巴巴士站（內部會做 geocoding 再搵最近車站）。俾唔到準確位置時先用。",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "地方名/地標（例如「旺角朗豪坊」）",
                    },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "ctb_search_routes",
            description:
                "搜尋城巴(CTB)巴士路線，用路線號或起點/終點地名做關鍵字。回傳路線號、起點同終點。",
            parameters: {
                type: "object",
                properties: {
                    keyword: {
                        type: "string",
                        description:
                            "路線號（例如「962」）或地名（例如「中環」）",
                    },
                },
                required: ["keyword"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "ctb_get_route_stops",
            description:
                "攞某一條城巴(CTB)路線嘅順序車站表（由起點到終點）。要先知道 route 同 bound。",
            parameters: {
                type: "object",
                properties: {
                    route: {
                        type: "string",
                        description: "路線號（例如「962」）",
                    },
                    bound: {
                        type: "string",
                        description: "方向：outbound = 去程，inbound = 回程",
                    },
                },
                required: ["route", "bound"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "ctb_get_stop_eta",
            description:
                "攞城巴(CTB)某個巴士站 + 某條路線嘅下一班車到站時間（ETA）。要先有 stop_id 同 route。",
            parameters: {
                type: "object",
                properties: {
                    stop_id: {
                        type: "string",
                        description: "巴士站 ID（由 ctb_get_route_stops 回傳）",
                    },
                    route: {
                        type: "string",
                        description: "路線號（例如「962」）",
                    },
                },
                required: ["stop_id", "route"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "find_nearby_ctb_stops",
            description:
                "用地名搜尋附近嘅城巴(CTB)巴士站（內部做 geocoding 再搵最近車站）。俾唔到準確位置時先用。",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "地方名/地標（例如「中環」）",
                    },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "mtr_get_lines",
            description: "列出所有港鐵(MTR)路線同佢哋嘅車站。",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "mtr_find_route",
            description:
                "搵兩個港鐵站之間嘅搭車路線（連轉車站）。輸入要用港鐵站名（繁體中文）。",
            parameters: {
                type: "object",
                properties: {
                    from: {
                        type: "string",
                        description: "出發車站名（例如「旺角」）",
                    },
                    to: {
                        type: "string",
                        description: "目的地車站名（例如「中環」）",
                    },
                },
                required: ["from", "to"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "plan_journey",
            description:
                "綜合規劃「出發地 → 目的地」嘅交通方法：同時考慮港鐵（若兩邊都係車站）、九巴(KMB)同城巴(CTB)直達巴士（上車站喺落車站前面嘅路線），並回傳最近車站同下一班車時間。出發地/目的地可以用地名、地標或港鐵站名。",
            parameters: {
                type: "object",
                properties: {
                    origin: {
                        type: "string",
                        description: "出發地（例如「旺角朗豪坊」或「旺角」）",
                    },
                    destination: {
                        type: "string",
                        description:
                            "目的地（例如「中環」或「銅鑼灣時代廣場」）請預先幫user處理好出發地及目的地, 確保清晰",
                    },
                },
                required: ["origin", "destination"],
            },
        },
    },
];

// 共用 tool handlers（provider 無關）
export const functionHandlers: Record<string, (args: any) => Promise<any>> = {
    get_url_text_content: async ({ url }: { url: string }) => {
        console.log(`🔗 get_url_text_content: ${url}`);
        try {
            // Playwright 版：真 browser 渲染（支援 JS / SPA）+ 抽正文文字
            const { title, text } = await crawlUrlToText(url);
            console.log(
                `✅ get_url_text_content OK: ${url} (title=${title}, ${text.length} chars)`
            );
            return { siteTitle: title, textContent: text };
        } catch (error) {
            console.log(
                `❌ get_url_text_content FAIL: ${url}`,
                (error as any)?.message || error
            );
            return {
                siteTitle: "Error while trying to get title",
                textContent: "Error while trying to get body text",
            };
        }
    },
    web_search: async ({ query }: { query: string }) => {
        try {
            const results = await searchWeb(query);
            return { query, count: results.length, results };
        } catch (error) {
            console.log("❌ web_search 失敗:", (error as any)?.message || error);
            return { query, error: "搜尋失敗，請稍後再試" };
        }
    },
    get_cached_stickers: async () => {
        const stickers = getCachedStickers();
        return {
            count: stickers.length,
            stickers: stickers.slice(0, 50).map((s) => ({
                // 用 short id（file_unique_id），唔好用長 file_id —— 避免 AI 複製時改錯
                stickerId: s.id,
                meaning: s.meaning,
                emoji: s.emoji,
                pack: s.setName,
            })),
        };
    },
    kmb_search_routes: async ({ keyword }: { keyword: string }) => {
        try {
            const routes = await searchKmbRoutes(keyword);
            return { count: routes.length, routes };
        } catch (error) {
            return { error: "KMB 路線搜尋失敗，請稍後再試" };
        }
    },
    kmb_get_route_stops: async ({
        route,
        bound,
        service_type = "1",
    }: {
        route: string;
        bound: string;
        service_type?: string;
    }) => {
        try {
            const stops = await getKmbRouteStops(route, bound, service_type);
            return { route, bound, count: stops.length, stops };
        } catch (error) {
            return { error: "攞唔到路線車站表" };
        }
    },
    kmb_get_stop_eta: async ({ stop_id }: { stop_id: string }) => {
        try {
            const eta = await getKmbStopEta(stop_id);
            return { stop_id, count: eta.length, eta };
        } catch (error) {
            return { error: "攞唔到到站時間" };
        }
    },
    find_nearby_kmb_stops: async ({ query }: { query: string }) => {
        try {
            return await findNearbyKmbStops(query);
        } catch (error) {
            return { error: "搵唔到附近巴士站" };
        }
    },
    ctb_search_routes: async ({ keyword }: { keyword: string }) => {
        try {
            const routes = await searchCitybusRoutes(keyword);
            return { count: routes.length, routes };
        } catch (error) {
            return { error: "城巴路線搜尋失敗，請稍後再試" };
        }
    },
    ctb_get_route_stops: async ({
        route,
        bound,
    }: {
        route: string;
        bound: string;
    }) => {
        try {
            const stops = await getCitybusRouteStops(route, bound);
            return { route, bound, count: stops.length, stops };
        } catch (error) {
            return { error: "攞唔到城巴路線車站表" };
        }
    },
    ctb_get_stop_eta: async ({
        stop_id,
        route,
    }: {
        stop_id: string;
        route: string;
    }) => {
        try {
            const eta = await getCitybusStopEta(stop_id, route);
            return { stop_id, route, count: eta.length, eta };
        } catch (error) {
            return { error: "攞唔到城巴到站時間" };
        }
    },
    find_nearby_ctb_stops: async ({ query }: { query: string }) => {
        try {
            return await findNearbyCitybusStops(query);
        } catch (error) {
            return { error: "搵唔到附近城巴巴士站" };
        }
    },
    mtr_get_lines: async () => {
        return { lines: getMtrLines() };
    },
    mtr_find_route: async ({ from, to }: { from: string; to: string }) => {
        return findMtrRoute(from, to);
    },
    plan_journey: async ({
        origin,
        destination,
    }: {
        origin: string;
        destination: string;
    }) => {
        try {
            return await planJourney(origin, destination);
        } catch (error) {
            return { error: "行程規劃失敗，請稍後再試" };
        }
    },
};
