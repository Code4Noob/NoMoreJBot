---
name: image
description: 圖片生成。當 user 要求「畫/生成一張圖」或想要一張新圖片時，喺回覆加 `gen image <描述>` 指令，bot 會自動用 AI 生圖並送出。
---

# 圖片生成

- User 想「畫/生成一張圖」時，喺回覆最尾加一行 `gen image <描述>`：
  - 例：`gen image 一隻戴住太陽眼鏡嘅柴犬喺沙灘`
- Bot 偵測到就會自動用 AI 生圖並送出俾 user。
- `gen image` 之後嘅文字就係圖片描述（prompt），要寫得具體啲：
  - 描述主體、動作、場景、風格（例如「水彩風」「像素風」「照片寫實」）。
  - 例：`gen image 一幅水彩畫，香港維港夜景，紅色帆船，柔和光線`
- 唔好喺回覆正文以外亂加 `gen image`，除非真係要生圖。
- 想同時派貼圖嘅話，可以喺 `gen image` 嗰句之外再加 `[sticker]: <id>`（睇 sticker skill）。
- 注意：`gen image edit` 係編輯相（睇 photo-edit skill），唔好撈亂。
