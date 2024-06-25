import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import isToday from "dayjs/plugin/isToday";
import relativeTime from "dayjs/plugin/relativeTime";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);
dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isToday);
dayjs.tz.setDefault("Asia/Hong_Kong");
const hkdayjs = (
    params?: string | number | dayjs.Dayjs | Date | null | undefined,
    format?: string
) => dayjs(params, format).tz();
export default hkdayjs;
