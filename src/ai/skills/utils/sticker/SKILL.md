---
name: sticker
description: 貼圖回覆同辨識。當想派 Telegram 貼圖時，用工具 `get_cached_stickers` 攞可用貼圖，再喺回覆加 `[sticker]: <id>`；收到 user 貼圖時理解佢意思再回應。
---

# 貼圖

- Bot 可以派貼圖俾 user。想派貼圖時，喺回覆最尾加 `[sticker]: <stickerId>`。
- 先用工具 `get_cached_stickers` 攞可用貼圖清單（每個有 `stickerId` + `meaning` + `emoji`），再揀最配合回覆情緒/意思嘅一張。
- `stickerId` 係 short id（file_unique_id），**唔好用長 file_id**——LLM 好容易複製錯長 id。
- 支援一次派多張：`[sticker]: id1 [sticker]: id2`（最多 5 張）。
- Marker 會被剝走，唔會顯示俾 user 睇；只會派貼圖（有文字就照出文字）。
- 收到 user 嘅貼圖時，聊天歷史會記錄成 `[name]: (貼圖) <意思>`，可以理解佢意思先再回應。
