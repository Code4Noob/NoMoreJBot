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

const from = (date1: string, date2?: string): string => {
    const d1 = (date1 || "").trim();
    // 冇俾 date -> 當而家（避免 parse 空字串出垃圾日期，例如 "a month ago"）
    if (!d1) {
        return date2 ? hkdayjs().from(date2) : hkdayjs().fromNow();
    }
    if (!date2) {
        return fromNow(d1);
    }
    return hkdayjs(d1).from(date2);
};

const fromNow = (date: string): string => {
    return hkdayjs(date, "DD-MM-YYYY").fromNow();
};

export { from, validateJCount };
