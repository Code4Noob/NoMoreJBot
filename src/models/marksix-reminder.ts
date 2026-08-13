import { Schema, Types, model } from "mongoose";

interface IMarksixReminder {
    _id: Types.ObjectId;
    chatId: string;
    cron: string;
    timezone: string;
    enabled: boolean;
}

const marksixReminderSchema = new Schema<IMarksixReminder>({
    _id: { type: Schema.Types.ObjectId, required: true },
    chatId: { type: String, required: true, unique: true },
    cron: { type: String, default: "0 0 * * *" },
    timezone: { type: String, default: "Asia/Hong_Kong" },
    enabled: { type: Boolean, default: true },
});

const MarksixReminder = model("MarksixReminder", marksixReminderSchema);

export { MarksixReminder, marksixReminderSchema };
export type { IMarksixReminder };
