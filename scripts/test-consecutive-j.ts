import { validateConsecutiveDay, validateJCount } from "../src/tools/date";

const assertEqual = (
    actual: boolean,
    expected: boolean,
    label: string
): void => {
    if (actual !== expected) {
        throw new Error(`${label}: expected ${expected}, received ${actual}`);
    }
};

const now = new Date();
const dateOffset = (days: number): Date => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    return date;
};

assertEqual(validateJCount(dateOffset(-1), now), true, "yesterday can update");
assertEqual(
    validateJCount(dateOffset(0), now),
    false,
    "today cannot update twice"
);
assertEqual(
    validateConsecutiveDay(dateOffset(-1)),
    true,
    "yesterday is consecutive"
);
assertEqual(
    validateConsecutiveDay(dateOffset(-2)),
    false,
    "two days ago is not consecutive"
);
assertEqual(
    validateConsecutiveDay(null as unknown as Date),
    true,
    "missing date starts a streak"
);

console.log("Consecutive J tests passed");
