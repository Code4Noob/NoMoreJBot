import hkdayjs from "../utils/dayjs";

const validateJCount = (date: Date, now: Date = new Date()) => {
    if (date === null || date === undefined) return true;
    // not today
    return !(
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()
    );
};

// 將常見輸入 normalize 做 DD-MM-YYYY：
// - 斜線 / 點 分隔（7/10/2026、7.10.2026）
// - 單數字日期 / 月份（7/10/2026 -> 07-10-2026）
const normalizeDate = (s: string): string => {
    const norm = s.replace(/[/.]/g, "-").trim();
    const parts = norm.split("-");
    if (parts.length !== 3) return norm;
    const [d, m, y] = parts;
    if (!/^\d+$/.test(d) || !/^\d+$/.test(m) || !/^\d+$/.test(y)) return norm;
    return `${d.padStart(2, "0")}-${m.padStart(2, "0")}-${y}`;
};

// 支援多種格式：數字（DD-MM-YYYY）+ 月份名（7 Oct / 7 Oct 2026 / 7 October 2026）
const DATE_FORMATS = [
    "D MMM YYYY",
    "D MMMM YYYY",
    "DD MMM YYYY",
    "DD MMMM YYYY",
    "D MMM",
    "D MMMM",
];

const parseDate = (s: string) => {
    const input = s.trim();
    const normalized = normalizeDate(input);
    const hasLetters = /[A-Za-z]/.test(normalized);
    // 有月份名（7 Oct / 7-Oct-2026）：dash 轉返空格再試 MMM 格式；
    // 純數字就淨係用 DD-MM-YYYY（normalize 咗）。
    const candidate = hasLetters ? normalized.replace(/-/g, " ") : normalized;
    const formats = hasLetters ? DATE_FORMATS : ["DD-MM-YYYY"];
    for (const format of formats) {
        const d = hkdayjs(candidate, format);
        if (d.isValid()) return d;
    }
    return hkdayjs(candidate);
};

const from = (date1: string, date2?: string): string => {
    const d1 = (date1 || "").trim();
    // 冇俾 date -> 當而家（避免 parse 空字串出垃圾日期，例如 "a month ago"）
    if (!d1) {
        return date2 ? hkdayjs().from(parseDate(date2)) : hkdayjs().fromNow();
    }
    if (!date2) {
        return fromNow(d1);
    }
    return parseDate(d1).from(parseDate(date2));
};

const fromNow = (date: string): string => {
    return parseDate(date).fromNow();
};

export { from, validateJCount };
