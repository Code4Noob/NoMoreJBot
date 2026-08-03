# Utility skills（工具指示）

放一啲通用嘅工具/行為指示，每個檔案一個 skill，會合併入 system prompt（順序 base → utils → users）：

```
src/ai/skills/utils/{name}.md
```

- 每個檔案開頭加 `[skill: 名稱]`（例如 `[skill: 圖片生成]`），冇加都會自動用 filename 做名
- 冇特別標記嘅檔案都用 filename 做 skill 名
- 呢啲檔案係 gitignored（唔 commit）
