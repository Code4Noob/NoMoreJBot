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
    if (!date2) {
        return fromNow(date1);
    }
    return hkdayjs(date1).from(date2);
};

const fromNow = (date: string): string => {
    return hkdayjs(date, "DD-MM-YYYY").fromNow();
};

export { from, validateJCount };
