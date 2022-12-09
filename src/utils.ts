import moment from "moment-timezone";

moment.tz.setDefault("Asia/Taipei");

const validateJCount = (date: Date, now: Date = new Date()) => {
  if (date === null || date === undefined) return true;
  // not today
  return !(
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
};

const fromNow = (from: string) => {
  // TODO: better way to calculate the diff?
  const now = moment(new Date().setHours(0, 0, 0));
  const days = now.diff(moment(new Date(from).setHours(0, 0, 1)), "days");
  console.log(now, moment(new Date(from).setHours(0, 0, 0)));
  return days >= 0 ? `${days} days ago` : `${Math.abs(days)} days later`;
};

export { validateJCount, fromNow };
