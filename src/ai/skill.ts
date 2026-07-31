import fs from "fs";
import path from "path";

/**
 * 載入 skill.md 做預設 system prompt（provider 共用）
 *
 * 用 .env 嘅 AI_SKILL 切換 skillset（對應 src/ai/skills/<AI_SKILL>.md）：
 *   AI_SKILL=skill   -> src/ai/skills/skill.md（預設）
 *   AI_SKILL=admin   -> src/ai/skills/admin.md
 * 唔設定 AI_SKILL 就會用 default skill.md
 */
const skillName = process.env.AI_SKILL || "skill";
const skillMarkdownPath = path.resolve(process.cwd(), `src/ai/skills/${skillName}.md`);
let skillSystemPrompt = "";
try {
    if (fs.existsSync(skillMarkdownPath)) {
        skillSystemPrompt = fs.readFileSync(skillMarkdownPath, "utf-8");
        console.log(`✅ 成功載入 skill.md 知識庫！（${skillName}）`);
    } else {
        console.warn(`⚠️ 搵唔到 skill file: ${skillMarkdownPath}，system prompt 為空`);
    }
} catch (err) {
    console.error("❌ 讀取 skill.md 失敗:", err);
}

export { skillSystemPrompt, skillName };
