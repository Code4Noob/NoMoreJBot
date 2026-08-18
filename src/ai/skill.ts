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
 * 解析 Agent Skills 格式嘅 SKILL.md：剝走 YAML frontmatter，攞返 name（fallback 用 folder name）
 */
function parseSkillFile(content: string): { name: string; body: string } {
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (m) {
        const nameMatch = m[1].match(/^\s*name\s*:\s*(.+)$/m);
        const name = nameMatch ? nameMatch[1].trim() : "";
        return { name, body: m[2].trim() };
    }
    return { name: "", body: content.trim() };
}

/**
 * Base skill（人人通用嘅人格）
 * 用 .env 嘅 AI_SKILL 切換 skillset（Agent Skills 格式：src/ai/skills/<AI_SKILL>/SKILL.md，
 * 兼容返舊 flat：src/ai/skills/<AI_SKILL>.md）：
 *   AI_SKILL=base   -> src/ai/skills/base/SKILL.md（預設）
 *   AI_SKILL=admin  -> src/ai/skills/admin/SKILL.md
 */
const baseSkillName = process.env.AI_SKILL || "base";
const baseSkillPrompt =
    loadFile(path.join(SKILLS_DIR, baseSkillName, "SKILL.md")) ||
    loadFile(path.join(SKILLS_DIR, `${baseSkillName}.md`));
const baseSystemPrompt = parseSkillFile(baseSkillPrompt).body;
if (baseSystemPrompt.trim()) {
    console.log(`✅ 成功載入 base skill 知識庫！（${baseSkillName}）`);
} else {
    console.warn(
        `⚠️ 搵唔到 base skill file: ${SKILLS_DIR}/${baseSkillName}/SKILL.md（或 .md）`
    );
}

/** 讀取 utils/ 入面每個 skill folder（Agent Skills 格式：<dir>/SKILL.md），合併做一個 string（每個自動加 [skill: 名稱] 標頭） */
function loadUtilsPrompt(): string {
    let combined = "";
    try {
        if (!fs.existsSync(UTILS_DIR)) return "";
        const dirs = fs
            .readdirSync(UTILS_DIR, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
            .sort();
        for (const dir of dirs) {
            const content = loadFile(path.join(UTILS_DIR, dir, "SKILL.md")).trim();
            if (content) {
                const { name, body } = parseSkillFile(content);
                const skillName = name || dir;
                combined += (combined ? "\n\n" : "") + `[skill: ${skillName}]\n${body}`;
            }
        }
    } catch (err) {
        console.error("❌ 讀取 utils skills 失敗:", err);
    }
    return combined;
}

const utilsSystemPrompt = loadUtilsPrompt();

/**
 * 確保某 user 有 skill 檔案（未有就自動建立一個空嘅）
 * Agent Skills 格式：users/{userId}/SKILL.md
 */
function ensureUserSkill(userId: string | number): void {
    try {
        const dir = path.join(USERS_DIR, String(userId));
        const p = path.join(dir, "SKILL.md");
        if (!fs.existsSync(p)) {
            fs.mkdirSync(dir, { recursive: true });
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
        const userSkill = parseSkillFile(
            loadFile(path.join(USERS_DIR, String(userId), "SKILL.md"))
        ).body;
        if (userSkill) parts.push(userSkill);
    }
    return parts.join("\n\n");
}

/**
 * 保存 / 更新某 user 嘅專屬 skill（寫入 src/ai/skills/users/{userId}/SKILL.md）
 * Agent Skills 格式：包 YAML frontmatter（name = userId），body 就係人格內容
 * 注意：係「成個 replace」——writeFileSync 會覆蓋成個檔案，唔會 append
 */
export function saveUserSkill(userId: string | number, content: string): void {
    try {
        const dir = path.join(USERS_DIR, String(userId));
        fs.mkdirSync(dir, { recursive: true });
        const p = path.join(dir, "SKILL.md");
        const wrapped = `---\nname: ${userId}\ndescription: Per-user personality for Telegram user ${userId}.\n---\n\n${content.trim()}\n`;
        // 成個覆蓋，唔係 append
        fs.writeFileSync(p, wrapped, "utf-8");
        console.log(`💾 已更新 user ${userId} 嘅 skill（replace）`);
    } catch (err) {
        console.error(`❌ 寫入 user skill ${userId} 失敗:`, err);
    }
}

export { baseSystemPrompt, baseSkillName };
