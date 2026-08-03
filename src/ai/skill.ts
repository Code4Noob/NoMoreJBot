import fs from "fs";
import path from "path";

const SKILLS_DIR = path.resolve(process.cwd(), "src/ai/skills");
const USERS_DIR = path.join(SKILLS_DIR, "users");
const UTILS_DIR = path.join(SKILLS_DIR, "utils");

function loadFile(p: string): string {
    try {
        if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
    } catch (err) {
        console.error(`❌ 讀取 ${p} 失敗:`, err);
    }
    return "";
}

/**
 * Base skill（人人通用嘅人格）
 * 用 .env 嘅 AI_SKILL 切換 skillset（對應 src/ai/skills/<AI_SKILL>.md）：
 *   AI_SKILL=base   -> src/ai/skills/base.md（預設）
 *   AI_SKILL=admin  -> src/ai/skills/admin.md
 */
const baseSkillName = process.env.AI_SKILL || "base";
const baseSystemPrompt = loadFile(path.join(SKILLS_DIR, `${baseSkillName}.md`));
if (baseSystemPrompt.trim()) {
    console.log(`✅ 成功載入 base skill 知識庫！（${baseSkillName}）`);
} else {
    console.warn(`⚠️ 搵唔到 base skill file: ${SKILLS_DIR}/${baseSkillName}.md`);
}

/**
 * 按 user 組合 system prompt：base + 該 user 嘅專屬 skill（如有）
 * user skill 檔案：src/ai/skills/users/{userId}.md
 */
/** 讀取 utils/ 入面所有 .md skill，合併做一個 string（每個自動加 [skill: 名稱] 標頭） */
function loadUtilsPrompt(): string {
    let combined = "";
    try {
        if (!fs.existsSync(UTILS_DIR)) return "";
        const files = fs.readdirSync(UTILS_DIR).filter((f) => f.endsWith(".md")).sort();
        for (const f of files) {
            let content = loadFile(path.join(UTILS_DIR, f)).trim();
            if (content) {
                const name = path.basename(f, ".md");
                // 檔案本身有 [skill: ...] 標頭就保留，冇就自動加
                if (!/^\[skill:/.test(content)) {
                    content = `[skill: ${name}]\n${content}`;
                }
                combined += (combined ? "\n\n" : "") + content;
            }
        }
    } catch (err) {
        console.error("❌ 讀取 utils skills 失敗:", err);
    }
    return combined;
}

const utilsSystemPrompt = loadUtilsPrompt();

/** 確保某 user 有 skill 檔案（未有就自動建立一個空嘅） */
function ensureUserSkill(userId: string | number): void {
    try {
        const p = path.join(USERS_DIR, `${String(userId)}.md`);
        if (!fs.existsSync(p)) {
            if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true });
            fs.writeFileSync(p, "", "utf-8");
            console.log(`📄 已為 user ${userId} 建立 skill 檔案`);
        }
    } catch (err) {
        console.error(`❌ 建立 user skill ${userId} 失敗:`, err);
    }
}

export function getSystemPrompt(userId?: string | number): string {
    const parts: string[] = [];
    // base（persona）優先
    if (baseSystemPrompt.trim()) parts.push(baseSystemPrompt.trim());
    // utils（圖片生成等工具指示）
    if (utilsSystemPrompt.trim()) parts.push(utilsSystemPrompt.trim());
    // user 專屬人格
    if (userId != null) {
        ensureUserSkill(userId); // 未有就自動建立
        const userSkill = loadFile(path.join(USERS_DIR, `${String(userId)}.md`)).trim();
        if (userSkill) parts.push(userSkill);
    }
    return parts.join("\n\n");
}

/**
 * 保存 / 更新某 user 嘅專屬 skill（寫入 src/ai/skills/users/{userId}.md）
 * 注意：係「成個 replace」——writeFileSync 會覆蓋成個檔案，唔會 append
 */
export function saveUserSkill(userId: string | number, content: string): void {
    try {
        if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true });
        const p = path.join(USERS_DIR, `${String(userId)}.md`);
        // 成個覆蓋，唔係 append
        fs.writeFileSync(p, `${content.trim()}\n`, "utf-8");
        console.log(`💾 已更新 user ${userId} 嘅 skill（replace）`);
    } catch (err) {
        console.error(`❌ 寫入 user skill ${userId} 失敗:`, err);
    }
}

export { baseSystemPrompt, baseSkillName };
