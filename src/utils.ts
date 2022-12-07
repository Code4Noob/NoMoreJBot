const validateJCount = (date: Date, now: Date = new Date()) => {
  if (date === null || date === undefined) return true;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
};

export { validateJCount };
