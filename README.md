# NoMoreJBot

Telegram bot（Telegraf）整合多個 AI model，支援圖片生成 / 圖片辨識、天氣、六合彩、聊天歷史、以及可切換嘅 AI skillset。

## 功能

- **AI 對話** — @bot 即可對話，支援 tool calling（讀取 URL 內容）
- **多 AI Provider** — 可切換 Gemini / DeepSeek / GPT
- **圖片生成** — AI 回覆含 `gen image <描述>` 就自動生圖
- **圖片辨識** — 傳相 + @bot caption 即分析
- **回覆引用** — reply 一條訊息 + @bot，可讀埋被引用嗰條（text / 圖片）
- **可切換 skillset** — base skill + 每個 user 獨有嘅人格
- **聊天歷史** — file-based（`chat/history/{chatId}.txt`）
- **VPN 支援** — 可將 AI API call 經 Surfshark OpenVPN tunnel 出街
- **其他指令** — 天氣、六合彩、JLPT 詞彙、Day 追蹤等

## 快速開始

```bash
# 安裝
pnpm install

# 設定環境
cp .env.example .env
# 填入 BOT_TOKEN（BotFather 攞）+ 至少一個 AI key

# 開發（自動 rebuild + restart）
pnpm dev

# Build + 啟動
pnpm build
pnpm start
```

## 環境變數（.env）

| Var | 用途 | 預設 |
|---|---|---|
| `BOT_TOKEN` | Telegram bot token | 必填 |
| `BOT_NAME` | Bot 用戶名（mention 用） | 必填 |
| `AI_PROVIDER` | 揀 model：`gemini` / `deepseek` / `gpt` | `gemini` |
| `AI_SKILL` | 揀 base skill（`src/ai/skills/<AI_SKILL>.md`） | `base` |
| `GEMINI_API_KEY` | Gemini | - |
| `GEMINI_MODEL` | Gemini 對話 model | `gemini-3.6-flash` |
| `GEMINI_IMAGE_MODEL` | Gemini 生圖 model | `gemini-3.1-flash-lite-image` |
| `DEEPSEEK_API_KEY` | DeepSeek V4 | - |
| `DEEPSEEK_MODEL` | DeepSeek model | `deepseek-chat` |
| `DEEPSEEK_BASE_URL` | DeepSeek API base | `https://api.deepseek.com` |
| `AZURE_OPENAI_URL` | GPT（Azure OpenAI）endpoint | - |
| `AZURE_OPENAI_KEY` | GPT API key | - |
| `CHAT_CONTEXT_SIZE` | 每次送俾 AI 嘅歷史行數 | `30` |
| `MAX_HISTORY_LINES` | 歷史檔案最大行數（超過刪舊） | `200` |
| `MONGOURL` | MongoDB connection string | 必填 |
| `DB_NAME` | MongoDB database name | - |

## 架構

```
src/
├── ai/                    # AI abstraction（provider 無關）
│   ├── index.ts           # Dispatcher：getAIResponse() 按 AI_PROVIDER 揀 model
│   ├── types.ts           # 共用 AI 型別
│   ├── skill.ts           # 載入 skill.md（按 AI_SKILL 切換）
│   ├── logger.ts          # 統一 AI response logging
│   ├── tools.ts           # 共用 tool list + functionHandlers
│   ├── skills/            # skillset（真實 .md gitignored，.example 可 commit）
│   │   ├── skill.md
│   │   └── skill.md.example
│   └── models/            # AI providers
│       ├── gemini.ts
│       ├── deepseek.ts
│       └── gpt.ts
├── bot/
│   └── tg.ts              # Telegram bot handlers
├── models/                # MongoDB models
├── tools/                 # 工具函數（weather / marksix / date）
├── utils/
│   ├── vpn.ts             # VPN axios（自動偵測 tun interface）
│   └── dayjs.ts
├── db.ts
└── index.ts
```

## 切換 AI Model

```env
AI_PROVIDER=gemini    # 預設
AI_PROVIDER=deepseek  # 需要 DEEPSEEK_API_KEY
AI_PROVIDER=gpt       # 需要 AZURE_OPENAI_URL + AZURE_OPENAI_KEY
```

所有 provider 回傳格式一致（`message` / `toolCalls` / `usage`），都支援 tool calling，唔使改 bot 邏輯。

Gemini 可以喺 env 揀 model：

```env
GEMINI_MODEL=gemini-3.6-flash          # 對話
GEMINI_IMAGE_MODEL=gemini-3.1-flash-lite-image  # 生圖
```

## Skillset（persona）

### Base skill（人人通用）

`src/ai/skills/` 放 base 人格，用 `AI_SKILL` 切換：

```env
AI_SKILL=base    # 預設
AI_SKILL=admin
```

- 真實 `base.md` 係 gitignored（可能含 persona / config）
- 參考 `base.md.example` 整新 skillset

### Per-user skill（每個 user 獨有人格）

每個 user 可以喺 `src/ai/skills/users/{userId}.md` 放專屬人格（`userId` = Telegram user ID）：

```
src/ai/skills/users/123456789.md
```

- 存在就會同 base skill **合併**做 system prompt
- 唔存在就淨係用 base skill
- 呢啲檔案係 gitignored

**Bot 可以自己更新** — `base.md` 教咗 AI：想改變對某 user 嘅人格時，喺回覆最尾加 `[user_skill]: <新人格>`，bot 會自動寫入 `users/{userId}.md` 並由回覆中剝走 marker。

## VPN（Surfshark OpenVPN）

淨係 AI API call 會行 VPN，其他 Node instance / 網絡唔受影響：

```bash
# 1. 安裝 openvpn
sudo apt install openvpn

# 2. 將 Surfshark CA cert 貼入 vpn/surfshark-sg.ovpn 嘅 <ca>
# 3. 連線（會自動偵測 tun IP，唔使設 env）
sudo node scripts/vpn-connect.js
```

- `utils/vpn.ts` 自動偵測 tun interface IP，tunnel 未起就 fallback 普通 axios
- 唔使設任何 VPN env var

## 聊天歷史

所有群組訊息會寫入 `chat/history/{chatId}.txt`，@bot 時會自動攞最近嘅行數做 context。

可以喺 env 控制：

```env
CHAT_CONTEXT_SIZE=30     # 每次送俾 AI 嘅行數
MAX_HISTORY_LINES=200    # 檔案最大行數，超過會自動刪走最舊嘅
```

> 注意：需要喺 BotFather 關閉 Privacy Mode，bot 先收到全部群組訊息。

## 指令

```
start  - 開始使用
help   - 顯示說明
quit   - Admin 專用：bot 離開群組
j      - Day 追蹤（inline 按鈕）
picture- 隨機圖片
users  - Day 排行榜
me     - 自己嘅 Day
from   - 日期時間計算（DD-MM-YYYY）
weather- 天氣預報
marksix- 六合彩
jp     - 隨機 JLPT 詞彙
draw   - AI 生圖
```

另外 @bot 對話時，如果 AI 回覆包含 `gen image <描述>` 會自動生圖；傳相 + @bot 會自動分析圖片。
