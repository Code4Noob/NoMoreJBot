# Per-user AI skills

每個 user 可以放自己嘅專屬人格檔案（Agent Skills 格式）：

```
src/ai/skills/users/{userId}/SKILL.md
```

- `{userId}` = Telegram user ID（`ctx.from.id`）
- 存在就會同 base skill 合併做 system prompt
- 唔存在就淨係用 base skill（bot 會自動建立空檔案）
- 呢啲檔案係 gitignored（唔 commit）

例如 `123456789/SKILL.md`：
```markdown
---
name: 123456789
description: Per-user personality for Telegram user 123456789.
---

你同呢個 user 講嘢要串啲，叫佢做死毒撚
```

Bot 用 `[user_skill]: <新人格>` marker 自動寫入呢個檔案（會包 frontmatter，`name` = userId）。
