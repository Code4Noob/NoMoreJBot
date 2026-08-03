# Per-user AI skills

每個 user 可以放自己嘅專屬人格檔案：

```
src/ai/skills/users/{userId}.md
```

- `{userId}` = Telegram user ID（`ctx.from.id`）
- 存在就會同 base skill 合併做 system prompt
- 唔存在就淨係用 base skill
- 呢啲檔案係 gitignored（唔 commit）

例如 `123456789.md`：
```
你同呢個 user 講嘢要串啲，叫佢做死毒撚
```
