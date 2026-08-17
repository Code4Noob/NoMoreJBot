/**
 * 香港交通工具層（KMB/LWB 巴士 + MTR）。
 *
 * 數據來源（全部官方公開、免 key）：
 *   KMB/LWB 路線/車站/ETA：https://data.etabus.gov.hk/v1/transport/kmb/
 *   Geocoding（地名 → 經緯度）：Nominatim (OpenStreetMap)
 *   MTR：冇官方公開 API → 用內置嘅路線/車站靜態數據 + BFS 搵路
 *
 * 註：KMB API 係香港政府 data.gov.hk 服務，直連即可，唔使行 VPN。
 */
import axios from "axios";
import hkdayjs from "../utils/dayjs";

const KMB_BASE = "https://data.etabus.gov.hk/v1/transport/kmb";

// ---------- 類型 ----------
export interface KmbRoute {
    route: string;
    bound: string; // O = outbound, I = inbound
    service_type: string;
    orig_tc: string;
    orig_en: string;
    dest_tc: string;
    dest_en: string;
}

export interface KmbStop {
    stop: string;
    name_tc: string;
    name_en: string;
    lat: string;
    long: string;
}

export interface KmbEta {
    route: string;
    dir: string;
    service_type: string;
    dest: string;
    eta: string; // HH:mm（香港時間）
    mins: number; // 幾分鐘後到
    remark: string;
}

// ---------- 快取（路線 / 車站表較大，cache 1 個鐘） ----------
const CACHE_TTL = 1000 * 60 * 60;
let routeListCache: { ts: number; data: KmbRoute[] } | null = null;
let stopListCache: { ts: number; data: KmbStop[] } | null = null;
const routeStopCache = new Map<
    string,
    { ts: number; data: { seq: number; stop: string; name: string }[] }
>();

async function fetchKmbRoutes(): Promise<KmbRoute[]> {
    if (routeListCache && Date.now() - routeListCache.ts < CACHE_TTL)
        return routeListCache.data;
    const { data } = await axios.get(`${KMB_BASE}/route/`);
    routeListCache = { ts: Date.now(), data: data?.data || [] };
    return routeListCache.data;
}

async function fetchKmbStops(): Promise<KmbStop[]> {
    if (stopListCache && Date.now() - stopListCache.ts < CACHE_TTL)
        return stopListCache.data;
    const { data } = await axios.get(`${KMB_BASE}/stop`);
    stopListCache = { ts: Date.now(), data: data?.data || [] };
    return stopListCache.data;
}

// bound: O/I → API 用 outbound/inbound
function toApiBound(bound: string): string {
    return bound === "I" || String(bound).toLowerCase() === "inbound"
        ? "inbound"
        : "outbound";
}

// ---------- KMB 路線 ----------
/** 用關鍵字搜路線（路線號 / 起點 / 終點） */
export async function searchKmbRoutes(keyword: string): Promise<any[]> {
    const routes = await fetchKmbRoutes();
    const kw = (keyword || "").trim();
    const lower = kw.toLowerCase();
    if (!kw) return [];
    const matches = routes.filter(
        (r) =>
            r.route.toLowerCase().includes(lower) ||
            r.orig_tc.includes(kw) ||
            r.dest_tc.includes(kw) ||
            r.orig_en.toLowerCase().includes(lower) ||
            r.dest_en.toLowerCase().includes(lower)
    );
    return matches.slice(0, 20).map((r) => ({
        route: r.route,
        bound: r.bound,
        service_type: r.service_type,
        from: r.orig_tc,
        to: r.dest_tc,
    }));
}

// ---------- KMB 車站（路線 → 車站表） ----------
async function getKmbRouteStopsInternal(
    route: string,
    bound: string,
    serviceType: string
): Promise<{ seq: number; stop: string; name: string }[]> {
    const key = `${route}|${bound}|${serviceType}`;
    const cached = routeStopCache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

    const dir = toApiBound(bound);
    const stops = await fetchKmbStops();
    const stopMap = new Map(stops.map((s) => [s.stop, s.name_tc]));
    const { data } = await axios.get(
        `${KMB_BASE}/route-stop/${encodeURIComponent(route)}/${dir}/${encodeURIComponent(serviceType)}`
    );
    const list = (data?.data || [])
        .map((s: any) => ({
            seq: Number(s.seq),
            stop: s.stop,
            name: stopMap.get(s.stop) || "",
        }))
        .sort((a: any, b: any) => a.seq - b.seq);
    routeStopCache.set(key, { ts: Date.now(), data: list });
    return list;
}

/** 某路線嘅順序車站表 */
export async function getKmbRouteStops(
    route: string,
    bound: string,
    serviceType = "1"
): Promise<any[]> {
    const list = await getKmbRouteStopsInternal(route, bound, serviceType);
    return list.map((s) => ({ seq: s.seq, stop: s.stop, name: s.name }));
}

// ---------- KMB ETA ----------
/** 某車站嘅到站時間（ETA） */
export async function getKmbStopEta(stopId: string): Promise<KmbEta[]> {
    const { data } = await axios.get(
        `${KMB_BASE}/stop-eta/${encodeURIComponent(stopId)}`
    );
    const list: any[] = data?.data || [];
    const now = hkdayjs();
    return list.slice(0, 6).map((e) => {
        const eta = hkdayjs(e.eta);
        const mins = Math.max(0, eta.diff(now, "minute"));
        return {
            route: e.route,
            dir: e.dir,
            service_type: String(e.service_type ?? 1),
            dest: e.dest_tc || e.dest_en || "",
            eta: eta.format("HH:mm"),
            mins,
            remark: e.rmk_tc || e.rmk_en || "",
        };
    });
}

// ---------- Geocoding（Nominatim） ----------
const geocodeCache = new Map<string, { lat: number; lon: number } | null>();

async function nominatimSearch(
    q: string
): Promise<{ lat: number; lon: number } | null> {
    const { data } = await axios.get(
        "https://nominatim.openstreetmap.org/search",
        {
            params: { q, format: "json", limit: 3 },
            headers: {
                "User-Agent": "NoMoreJBot/1.0 (Telegram bot)",
                "Accept-Language": "zh-Hant, zh, en",
            },
            timeout: 8000,
        }
    );
    const list: any[] = data || [];
    if (!list.length) return null;
    // 優先揀香港嘅結果（display_name 有「Hong Kong / 香港 / China」）
    const hk = list.find((r) =>
        /Hong Kong|香港|China|中国/.test(r.display_name || "")
    );
    const chosen = hk || list[0];
    return { lat: parseFloat(chosen.lat), lon: parseFloat(chosen.lon) };
}

async function geocode(
    query: string
): Promise<{ lat: number; lon: number } | null> {
    const key = (query || "").trim();
    if (!key) return null;
    if (geocodeCache.has(key)) return geocodeCache.get(key)!;
    try {
        // 先試加「Hong Kong」後綴（英文名咁先定位到香港），
        // 搵唔到再試原句（中文名加後綴反而會搵唔到）。
        const result =
            (await nominatimSearch(`${key}, Hong Kong`)) ||
            (await nominatimSearch(key));
        geocodeCache.set(key, result);
        return result;
    } catch {
        geocodeCache.set(key, null);
        return null;
    }
}

// ---------- 距離 / 最近車站 ----------
function haversineKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function nearestKmbStops(
    lat: number,
    lon: number,
    limit: number,
    radiusKm = 1.5
) {
    const stops = await fetchKmbStops();
    return stops
        .map((s) => ({
            stop: s.stop,
            name: s.name_tc,
            dist_m: Math.round(
                haversineKm(lat, lon, parseFloat(s.lat), parseFloat(s.long)) *
                    1000
            ),
        }))
        .filter((s) => s.dist_m <= radiusKm * 1000)
        .sort((a, b) => a.dist_m - b.dist_m)
        .slice(0, limit);
}

/** 用地名/關鍵字搵最近嘅 KMB 車站 */
export async function findNearbyKmbStops(
    query: string,
    radiusKm = 1.5
): Promise<any> {
    const point = await geocode(query);
    if (!point)
        return {
            error: `搵唔到「${query}」嘅位置，請俾更準確嘅地方名`,
            results: [],
        };
    const results = await nearestKmbStops(point.lat, point.lon, 8, radiusKm);
    return { query, results };
}

// ---------- MTR 靜態數據 ----------
interface MtrLine {
    line: string;
    stations: string[];
}

const MTR_LINES: MtrLine[] = [
    {
        line: "東鐵綫",
        stations: [
            "金鐘",
            "會展",
            "紅磡",
            "旺角東",
            "九龍塘",
            "大圍",
            "沙田",
            "火炭",
            "大學",
            "大埔墟",
            "太和",
            "粉嶺",
            "上水",
        ],
    },
    {
        line: "荃灣綫",
        stations: [
            "中環",
            "金鐘",
            "尖沙咀",
            "佐敦",
            "油麻地",
            "旺角",
            "太子",
            "深水埗",
            "長沙灣",
            "荔枝角",
            "美孚",
            "荔景",
            "葵芳",
            "葵興",
            "大窩口",
            "荃灣",
        ],
    },
    {
        line: "觀塘綫",
        stations: [
            "黃埔",
            "何文田",
            "油麻地",
            "旺角",
            "太子",
            "石硤尾",
            "九龍塘",
            "樂富",
            "黃大仙",
            "鑽石山",
            "彩虹",
            "九龍灣",
            "牛頭角",
            "觀塘",
            "藍田",
            "油塘",
            "調景嶺",
        ],
    },
    {
        line: "港島綫",
        stations: [
            "堅尼地城",
            "香港大學",
            "西營盤",
            "上環",
            "中環",
            "金鐘",
            "灣仔",
            "銅鑼灣",
            "天后",
            "炮台山",
            "北角",
            "鰂魚涌",
            "太古",
            "西灣河",
            "筲箕灣",
            "杏花邨",
            "柴灣",
        ],
    },
    {
        line: "將軍澳綫",
        stations: [
            "北角",
            "鰂魚涌",
            "油塘",
            "調景嶺",
            "將軍澳",
            "坑口",
            "寶琳",
        ],
    },
    {
        line: "南港島綫",
        stations: ["金鐘", "海洋公園", "黃竹坑", "利東", "海怡半島"],
    },
    {
        line: "屯馬綫",
        stations: [
            "屯門",
            "兆康",
            "天水圍",
            "朗屏",
            "元朗",
            "錦上路",
            "荃灣西",
            "美孚",
            "南昌",
            "柯士甸",
            "尖東",
            "紅磡",
            "何文田",
            "土瓜灣",
            "宋皇臺",
            "啟德",
            "鑽石山",
            "顯徑",
            "大圍",
            "車公廟",
            "沙田圍",
            "第一城",
            "石門",
            "大水坑",
            "恆安",
            "馬鞍山",
            "烏溪沙",
        ],
    },
    {
        line: "東涌綫",
        stations: [
            "香港",
            "九龍",
            "奧運",
            "南昌",
            "荔景",
            "青衣",
            "欣澳",
            "東涌",
        ],
    },
    { line: "機場快綫", stations: ["香港", "九龍", "青衣", "機場", "博覽館"] },
    { line: "迪士尼綫", stations: ["欣澳", "迪士尼"] },
];

// 站名唔同但行人隧道連接（當轉乘處理）
const VIRTUAL_INTERCHANGES: [string, string][] = [["尖沙咀", "尖東"]];

interface Edge {
    to: string;
    line: string;
}

function buildMtrGraph(): Map<string, Edge[]> {
    const g = new Map<string, Edge[]>();
    const add = (a: string, b: string, line: string) => {
        if (!g.has(a)) g.set(a, []);
        g.get(a)!.push({ to: b, line });
        if (!g.has(b)) g.set(b, []);
        g.get(b)!.push({ to: a, line });
    };
    for (const l of MTR_LINES) {
        for (let i = 0; i < l.stations.length - 1; i++) {
            add(l.stations[i], l.stations[i + 1], l.line);
        }
    }
    for (const [a, b] of VIRTUAL_INTERCHANGES) add(a, b, "步行轉乘");
    return g;
}

function matchStation(input: string): string | null {
    const q = (input || "").trim();
    if (!q) return null;
    const all = new Set<string>();
    for (const l of MTR_LINES) for (const s of l.stations) all.add(s);
    for (const [a, b] of VIRTUAL_INTERCHANGES) {
        all.add(a);
        all.add(b);
    }
    const arr = [...all];
    // 精確
    for (const s of arr) if (s === q) return s;
    // 包含（揀最短、最貼切嗰個）
    const contains = arr.filter((s) => s.includes(q));
    if (contains.length) return contains.sort((a, b) => a.length - b.length)[0];
    // 反過嚟（例如「旺角站」→「旺角」）
    const reverse = arr.filter((s) => q.includes(s));
    if (reverse.length) return reverse.sort((a, b) => b.length - a.length)[0];
    return null;
}

/** 列出所有 MTR 路線及車站 */
export function getMtrLines(): any[] {
    return MTR_LINES.map((l) => ({ line: l.line, stations: l.stations }));
}

/** 搵兩個車站之間嘅 MTR 路線（Dijkstra，轉車次數最少優先） */
export function findMtrRoute(from: string, to: string): any {
    const fromStation = matchStation(from);
    const toStation = matchStation(to);
    if (!fromStation || !toStation) {
        const missing = !fromStation ? from : to;
        return { error: `搵唔到 MTR 車站「${missing}」`, suggestions: [] };
    }
    if (fromStation === toStation) {
        return {
            from: fromStation,
            to: toStation,
            changes: 0,
            segments: [{ line: "同一車站", from: fromStation, to: toStation }],
        };
    }

    const graph = buildMtrGraph();
    // Dijkstra：每搭一個站 cost 1，每轉一次車加 TRANSFER_COST，
    // 咁樣唔會淨係揀最少站數、而忽略咗轉車次數（例如旺角去紅磡應該直接坐觀塘綫）。
    const TRANSFER_COST = 1;
    const start = `${fromStation}::`;
    const dist = new Map<string, number>();
    const parent = new Map<
        string,
        { from: string; station: string; line: string }
    >();
    const pq: { state: string; cost: number }[] = [];

    dist.set(start, 0);
    pq.push({ state: start, cost: 0 });

    let endState: string | null = null;

    while (pq.length) {
        // 攞 cost 最細嗰個（state 數量細，linear scan 已夠快）
        pq.sort((a, b) => a.cost - b.cost);
        const { state, cost } = pq.shift()!;
        if (cost !== (dist.get(state) ?? Infinity)) continue; // stale entry
        const [station, curLine] = state.split("::");
        if (station === toStation) {
            endState = state;
            break;
        }
        for (const edge of graph.get(station) || []) {
            const next = `${edge.to}::${edge.line}`;
            const transfer =
                curLine && curLine !== edge.line ? TRANSFER_COST : 0;
            const nextCost = cost + 1 + transfer;
            if (nextCost < (dist.get(next) ?? Infinity)) {
                dist.set(next, nextCost);
                parent.set(next, {
                    from: state,
                    station: edge.to,
                    line: edge.line,
                });
                pq.push({ state: next, cost: nextCost });
            }
        }
    }

    if (!endState) return { error: "搵唔到路徑", segments: [] };

    // 重建路徑
    const path: { station: string; line: string }[] = [];
    let cur = endState;
    while (cur !== start) {
        const p = parent.get(cur)!;
        path.push({ station: p.station, line: p.line });
        cur = p.from;
    }
    path.push({ station: fromStation, line: "" });
    path.reverse();

    // 分組做分段（轉車位 = 上段終點 = 下段起點）
    const segments: { line: string; from: string; to: string }[] = [];
    let line = "";
    let segFrom = path[0].station;
    for (let i = 1; i < path.length; i++) {
        const stepLine = path[i].line;
        if (!line) {
            line = stepLine;
            continue;
        }
        if (stepLine === line) continue;
        // 轉車發生喺上一站（path[i-1]）
        segments.push({ line, from: segFrom, to: path[i - 1].station });
        line = stepLine;
        segFrom = path[i - 1].station;
    }
    segments.push({ line, from: segFrom, to: path[path.length - 1].station });

    return {
        from: fromStation,
        to: toStation,
        changes: segments.length - 1,
        segments,
    };
}

// ---------- 綜合行程（巴士直達 + MTR） ----------
async function routesAtStop(stopId: string): Promise<KmbEta[]> {
    try {
        return await getKmbStopEta(stopId);
    } catch {
        return [];
    }
}

/**
 * 由「出發地 → 目的地」搵交通方法：
 *   1) MTR：兩邊都 match 到車站就俾港鐵路線
 *   2) 巴士：geocode → 最近車站 → 搵有冇巴士直達（路線相同 + 上車站喺落車站前面）
 */
export async function planJourney(
    origin: string,
    destination: string
): Promise<any> {
    const result: any = { origin, destination, mtr: null, bus: null };

    // MTR
    const fromStation = matchStation(origin);
    const toStation = matchStation(destination);
    if (fromStation && toStation && fromStation !== toStation) {
        result.mtr = findMtrRoute(fromStation, toStation);
    }

    // 巴士
    const [originPoint, destPoint] = await Promise.all([
        geocode(origin),
        geocode(destination),
    ]);
    if (originPoint && destPoint) {
        const [origStops, destStops] = await Promise.all([
            nearestKmbStops(originPoint.lat, originPoint.lon, 8),
            nearestKmbStops(destPoint.lat, destPoint.lon, 8),
        ]);
        const destStopIds = new Set(destStops.map((s) => s.stop));

        // 攞每個近車站嘅路線（並行）
        const origEtas = await Promise.all(
            origStops.map((s) => routesAtStop(s.stop))
        );

        const candidates: any[] = [];
        const seen = new Set<string>();
        for (let i = 0; i < origStops.length; i++) {
            const os = origStops[i];
            for (const e of origEtas[i]) {
                // 落車站：呢條路線喺上車站之後有冇經目的地附近嘅站
                const stops = await getKmbRouteStopsInternal(
                    e.route,
                    e.dir,
                    e.service_type
                );
                const boardIdx = stops.findIndex((s) => s.stop === os.stop);
                if (boardIdx < 0) continue;
                const alight = stops.find(
                    (s, idx) => idx > boardIdx && destStopIds.has(s.stop)
                );
                if (!alight) continue;
                const key = `${e.route}|${e.dir}|${os.stop}|${alight.stop}`;
                if (seen.has(key)) continue;
                seen.add(key);
                candidates.push({
                    route: e.route,
                    bound: e.dir,
                    service_type: e.service_type,
                    board: os.name,
                    boardStopId: os.stop,
                    alight: alight.name,
                    alightStopId: alight.stop,
                    nextBus: `${e.eta}（${e.mins} 分鐘）`,
                    dest: e.dest,
                });
            }
        }

        result.bus = {
            originNearby: origStops,
            destinationNearby: destStops,
            directOptions: candidates.slice(0, 8),
        };
    }

    return result;
}
