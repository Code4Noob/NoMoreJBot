/**
 * 交通工具工具嘅 smoke test（直接用 Bun 跑，唔使開 bot）。
 *
 * 用法：
 *   bun scripts/test-transport.ts
 *
 * 覆蓋：MTR 路線（純本地）、KMB 路線搜尋 / 車站 / ETA、geocoding + 附近車站、
 * 綜合行程規劃（MTR + 九巴直達巴士）。
 */
import {
    searchKmbRoutes,
    getKmbRouteStops,
    getKmbStopEta,
    findNearbyKmbStops,
    findMtrRoute,
    getMtrLines,
    planJourney,
} from "../src/tools/transportation";

async function main() {
    console.log("=== MTR 路線（純本地，無網絡） ===");
    console.log("旺角 -> 紅磡:", JSON.stringify(findMtrRoute("旺角", "紅磡")));
    console.log("屯門 -> 柴灣:", JSON.stringify(findMtrRoute("屯門", "柴灣")));
    console.log("MTR 路線數量:", getMtrLines().length);

    console.log("\n=== KMB 路線搜尋 ===");
    const routes = await searchKmbRoutes("尖沙咀");
    console.log("尖沙咀 相關路線 (頭 3):", JSON.stringify(routes.slice(0, 3)));

    console.log("\n=== KMB 路線車站 ===");
    const stops = await getKmbRouteStops("1", "O");
    console.log("路線 1 去程 站數:", stops.length);
    console.log("頭 3 站:", JSON.stringify(stops.slice(0, 3)));

    console.log("\n=== KMB 到站時間 (ETA) ===");
    const eta = await getKmbStopEta("18492910339410B1");
    console.log("竹園邨總站 頭 3 班:", JSON.stringify(eta.slice(0, 3)));

    console.log("\n=== Geocoding + 附近車站 ===");
    console.log(
        "旺角朗豪坊:",
        JSON.stringify(await findNearbyKmbStops("旺角朗豪坊"))
    );

    console.log("\n=== 綜合行程規劃 ===");
    console.log(
        "旺角 -> 尖沙咀碼頭:",
        JSON.stringify(await planJourney("旺角", "尖沙咀碼頭"))
    );
    console.log(
        "旺角朗豪坊 -> 中環:",
        JSON.stringify(await planJourney("旺角朗豪坊", "中環"))
    );
}

main()
    .then(() => {
        console.log("\n✅ 測試完成");
        process.exit(0);
    })
    .catch((e) => {
        console.error("❌ 測試失敗:", e);
        process.exit(1);
    });
