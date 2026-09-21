import YahooFinance from "yahoo-finance2";

// suppressNotices: 唔好喺 bot log 出 Yahoo survey 提示
const yahooFinance = new YahooFinance({
    suppressNotices: ["yahooSurvey"],
});

const STOCK_HELP_MESSAGE = `ℹ️ *【股市 & 外匯查詢指南】*

歡迎使用智能二合一查詢系統！你可以透過 \`/stock <代號>\` 查詢即時股市或全球匯率。

---

### 📈 1. 股票報價 (含美股 24H 夜盤)
支援港股及美股。美股會根據開市時間，*全自動切換* 顯示對應數據：
• *查詢港股：* \`/stock 2347.HK\` 或 \`0700.HK\` _(必須加 \`.HK\` 尾綴)_
• *查詢美股：* \`/stock AAPL\` 或 \`NVDA\`
  👉 *日間 (16:00 - 21:30)：* 自動顯示 *☀️ 盤前 (Premarket)*
  👉 *深夜 (21:30 - 04:00)：* 自動顯示 *🟢 正股現時價格*
  👉 *清晨 (04:00 - 08:00)：* 自動顯示 *🌙 盤後 (After Hours)*
  👉 *朝早 (08:00 - 16:00)：* 自動顯示 *🌌 夜盤 (Overnight)* _(如有)_

---

### 💱 2. 港幣換外幣 (1 HKD = ?)
直接輸入外幣 3 位字母，查看 *1 港幣* 可換到幾多外幣：
• \`/stock JPY\` (日元) | \`/stock USD\` (美金) | \`/stock TWD\` (台幣)

---

### 💱 3. 外幣換港幣 (1 外幣 = ? HKD)
在外幣前面 *加個 \`1\` 字*，查看 *1 單位外幣* 等於幾多港幣：
• \`/stock 1JPY\` (日元變港幣) | \`/stock 1USD\` (美金變港幣)

💡 _小提示：大寫小寫都通（例如 \`jpy\` 或 \`1usd\`）。_`;

/**
 * yahoo-finance2 v4 嘅 Quote 係 union type，部分欄位（pre/post market）只有
 * 美股 equity 先有；為咗 typecheck 乾淨，自己聲明我哋用得着嘅欄位。
 */
interface StockQuote {
    longName?: string;
    shortName?: string;
    regularMarketPrice?: number;
    regularMarketChange?: number;
    regularMarketChangePercent?: number;
    regularMarketDayHigh?: number;
    regularMarketDayLow?: number;
    regularMarketTime?: Date | number | string;
    currency?: string;
    marketState?:
        | "REGULAR"
        | "CLOSED"
        | "PRE"
        | "PREPRE"
        | "POST"
        | "POSTPOST"
        | string;
    preMarketPrice?: number;
    preMarketChange?: number;
    preMarketChangePercent?: number;
    postMarketPrice?: number;
    postMarketChange?: number;
    postMarketChangePercent?: number;
}

/**
 * 解析股票/外匯 symbol，回傳 Yahoo Finance 用的 symbol 及模式標記
 */
function parseSymbol(rawSymbol: string): {
    symbol: string;
    forceFxUI: boolean;
    isReverseMode: boolean;
} {
    let symbol = rawSymbol.trim();
    // Slack 會將 link 變成 <http://xxx|label> 格式，拆返個 label 出嚟
    const slackLinkRegex = /<http.*\|(.*)>/i;
    const match = symbol.match(slackLinkRegex);

    if (match && match[1]) {
        symbol = match[1].toUpperCase();
    } else {
        symbol = symbol.replace(/^<http:\/\/|>/gi, "");
    }

    let forceFxUI = false;
    let isReverseMode = false;

    if (/^1[A-Z]{3}$/.test(symbol)) {
        // 外幣換港幣（1 外幣 = ? HKD）
        forceFxUI = true;
        isReverseMode = true;
        const targetCurrency = symbol.substring(1);
        if (targetCurrency === "USD") symbol = "HKD=X";
        else symbol = `${targetCurrency}HKD=X`;
    } else if (
        !symbol.includes(".") &&
        (symbol.length === 3 ||
            (symbol.length === 6 && symbol.startsWith("HKD")))
    ) {
        // 港幣換外幣（1 HKD = ?）
        forceFxUI = true;
        const targetCurrency =
            symbol.length === 3 ? symbol : symbol.substring(3, 6);
        if (targetCurrency === "HKD") symbol = "HKDUSD=X";
        else symbol = `HKD${targetCurrency}=X`;
    } else if (symbol.includes("=X")) {
        forceFxUI = true;
        if (symbol.length === 8 && !symbol.startsWith("HKD"))
            isReverseMode = true;
    }

    return { symbol, forceFxUI, isReverseMode };
}

/**
 * 查詢股票或外匯報價
 * @param rawSymbol - 用戶輸入的原始 symbol（空 / HELP / 說明 → 顯示說明書）
 * @returns Slack mrkdwn / 純文字兩用嘅回覆文字
 */
async function getStockQuote(rawSymbol: string): Promise<string> {
    // 說明書
    if (!rawSymbol || rawSymbol === "HELP" || rawSymbol === "說明") {
        return STOCK_HELP_MESSAGE;
    }

    const { symbol, forceFxUI, isReverseMode } = parseSymbol(rawSymbol);

    try {
        const quote = (await yahooFinance.quote(
            symbol
        )) as unknown as StockQuote;

        if (!quote || !quote.regularMarketPrice) {
            return `❌ 搵唔到 \`${rawSymbol}\` 嘅資料。`;
        }

        const {
            longName,
            shortName,
            regularMarketPrice,
            regularMarketChange,
            regularMarketChangePercent,
            regularMarketDayHigh,
            regularMarketDayLow,
            regularMarketTime,
            currency,
        } = quote;

        const marketTime = regularMarketTime
            ? new Date(regularMarketTime).toLocaleString("zh-HK", {
                  timeZone: "Asia/Hong_Kong",
              })
            : "未知";

        const change = regularMarketChange ?? 0;
        const changePercent = regularMarketChangePercent ?? 0;
        const directionEmoji = change >= 0 ? "🟢" : "🔴";
        const plusSign = change > 0 ? "+" : "";

        // 模式 A：外幣匯率
        if (forceFxUI) {
            if (isReverseMode) {
                const targetName = rawSymbol.startsWith("1")
                    ? rawSymbol.substring(1).toUpperCase()
                    : symbol.substring(0, 3);
                return `💱 *【外匯即時匯率 (Yahoo v3) - ${targetName} 兌 港幣】* \n\n• *每 1 ${targetName} 可兌換：* *${regularMarketPrice.toFixed(4)} HKD*\n• *今日波動：* ${directionEmoji} \`${plusSign}${change.toFixed(4)}\` (\`${plusSign}${changePercent.toFixed(2)}%\`)\n• *今日最高/最低：* ${regularMarketDayHigh?.toFixed(4) || "N/A"} / ${regularMarketDayLow?.toFixed(4) || "N/A"} HKD\n\n_⏰ 數據時間：${marketTime}_`;
            }
            const targetName = symbol.startsWith("HKD")
                ? symbol.substring(3, 6)
                : "外幣";
            return `💱 *【外匯即時匯率 (Yahoo v3) - 港幣 兌 ${targetName}】* \n\n• *每 1 港幣 (HKD) 可兌換：* *${regularMarketPrice.toFixed(6)} ${targetName}*\n• *今日波動：* ${directionEmoji} \`${plusSign}${change.toFixed(6)}\` (\`${plusSign}${changePercent.toFixed(2)}%\`)\n• *今日最高/最低：* ${regularMarketDayHigh?.toFixed(6) || "N/A"} / ${regularMarketDayLow?.toFixed(6) || "N/A"} ${targetName}\n\n_⏰ 數據時間：${marketTime}_`;
        }

        // 模式 B：常規股票 + 24H 夜盤
        const {
            marketState,
            preMarketPrice,
            preMarketChange,
            preMarketChangePercent,
            postMarketPrice,
            postMarketChange,
            postMarketChangePercent,
        } = quote;

        const companyName = longName || shortName || symbol;

        let replyMessage = `📈 *【股市即時報價 (Yahoo v3) - ${companyName} (${symbol})】*\n\n`;
        replyMessage += `• *正股收盤/現價：* ${regularMarketPrice} ${currency}\n`;
        replyMessage += `• *今日正股升跌：* ${directionEmoji} \`${plusSign}${change.toFixed(2)}\` (\`${plusSign}${changePercent.toFixed(2)}%\`)\n`;
        replyMessage += `• *今日最高/最低：* ${regularMarketDayHigh || "N/A"} / ${regularMarketDayLow || "N/A"} ${currency}\n`;

        // 情況 1：US Premarket - 盤前
        if (preMarketPrice && marketState === "PRE") {
            const preChange = preMarketChange ?? 0;
            const preDirection = preChange >= 0 ? "🔼" : "🔽";
            const prePlus = preChange > 0 ? "+" : "";
            replyMessage += `\n☀️ *【US Premarket - 盤前交易中】*\n• *盤前最新價格：* *${preMarketPrice}* ${currency}\n• *盤前估計升跌：* ${preDirection} \`${prePlus}${preChange.toFixed(2)}\` (\`${prePlus}${(preMarketChangePercent ?? 0).toFixed(2)}%\`)\n`;
        }
        // 情況 2：US After Hours - 盤後
        else if (postMarketPrice && marketState === "POST") {
            const postChange = postMarketChange ?? 0;
            const postDirection = postChange >= 0 ? "🌙" : "📉";
            const postPlus = postChange > 0 ? "+" : "";
            replyMessage += `\n🌙 *【US After Hours - 盤後交易中】*\n• *盤後最新價格：* *${postMarketPrice}* ${currency}\n• *盤後估計升跌：* ${postDirection} \`${postPlus}${postChange.toFixed(2)}\` (\`${postPlus}${(postMarketChangePercent ?? 0).toFixed(2)}%\`)\n`;
        }
        // 情況 3：US Overnight - 24H夜盤
        else if (
            postMarketPrice &&
            (marketState === "CLOSED" ||
                marketState === "PRE_MARKET" ||
                marketState === "OFFMARKET")
        ) {
            const nightChange = postMarketChange ?? 0;
            const nightDirection = nightChange >= 0 ? "🌌" : "🚨";
            const nightPlus = nightChange > 0 ? "+" : "";
            replyMessage += `\n🌌 *【US Overnight - 24H 夜盤交易中】*\n• *夜盤最新價格：* *${postMarketPrice}* ${currency}\n• *夜盤估計升跌：* ${nightDirection} \`${nightPlus}${nightChange.toFixed(2)}\` (\`${nightPlus}${(postMarketChangePercent ?? 0).toFixed(2)}%\`)\n`;
        }

        replyMessage += `\n_⏰ 數據更新時間：${marketTime}_`;
        if (marketState) replyMessage += ` _(市場狀態: ${marketState})_`;

        return replyMessage;
    } catch (error: any) {
        console.error("stock quote error:", error?.message || error);
        return `❌ 查詢 \`${rawSymbol}\` 時出錯（原因: ${error?.message || error}）。`;
    }
}

export { getStockQuote, parseSymbol, STOCK_HELP_MESSAGE };
