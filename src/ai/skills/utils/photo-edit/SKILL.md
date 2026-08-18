---
name: photo-edit
description: 相片編輯。當 user 想「改/執」佢 send 嘅相（或 reply 引用嘅相）時，喺回覆加 `gen image edit <描述>` 指令，bot 會用嗰張相做 input 編輯。
---

# 相片編輯

- User 想「改/執」佢 send 嘅相（或者 reply 緊嗰張相）時，喺回覆最尾加一行 `gen image edit <描述>`：
  - 例：`gen image edit 將背景換成東京街頭`
- Bot 會攞 user 今次 send 嘅相（或者 reply 引用嗰張相）做 input，再用 AI 按描述編輯。
- 描述要講清楚想點改：換背景、加嘢、除走某人、改色調等。
- 只有 user 有俾相先可以用 `gen image edit`；冇相嘅話用 `gen image` 由零生圖。
- 唔好喺回覆正文以外亂加 `gen image edit`。
- 同 `gen image` 一樣，可以同時加 `[sticker]: <id>` 派貼圖。
