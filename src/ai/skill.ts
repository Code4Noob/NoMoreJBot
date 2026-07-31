import fs from "fs";
import path from "path";

// 載入 skill.md 做預設 system prompt（provider 共用）
const skillMarkdownPath = path.resolve(process.cwd(), "skill.md");
let skillSystemPrompt = "";
try {
    if (fs.existsSync(skillMarkdownPath)) {
        skillSystemPrompt = fs.readFileSync(skillMarkdownPath, "utf-8");
        console.log("✅ 成功載入 skill.md 知識庫！");
    }
} catch (err) {
    console.error("❌ 讀取 skill.md 失敗:", err);
}

export { skillSystemPrompt };
