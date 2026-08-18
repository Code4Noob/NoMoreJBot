# Utility skills（工具指示）

放一啲通用嘅工具/行為指示，每個 skill 一個 folder（Agent Skills 格式），會合併入 system prompt（順序 base → utils → users）：

```
src/ai/skills/utils/{name}/SKILL.md
```

- 每個 `SKILL.md` 開頭有 YAML frontmatter（`name` + `description`），`name` 要同 folder 名一致（細楷 + 連字號）
- 後面係 skill 內容（instructions）
- loader 會剝走 frontmatter，用 frontmatter 嘅 `name`（fallback folder 名）做 `[skill: 名稱]` 標頭再合併
- **呢啲 utils skills 同 base skill 照 commit**（唔 gitignore）；淨係 `users/` 下嘅 per-user skill 先係 gitignored（可能有 persona / config）

例如 `image/SKILL.md`：

```markdown
---
name: image
description: 圖片生成。當 user 要求畫圖時，喺回覆加 `gen image <描述>`。
---

# 圖片生成

- User 想畫圖時，喺回覆最尾加一行 `gen image <描述>`。
```
