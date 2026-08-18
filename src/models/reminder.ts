import { Schema, Types, model } from "mongoose";

interface IReminder {
    _id: Types.ObjectId;
    userId: number;
    chatId: number;
    name?: string;
    text: string;
    remindAt: Date;
    delivered: boolean;
}

const reminderSchema = new Schema<IReminder>({
    // 唔好手動定義 _id —— 手動 + required 會令 Mongoose 唔自動生成，create() 會報 "Path `_id` is required"
    userId: { type: Number, required: true },
    chatId: { type: Number, required: true },
    name: { type: String },
    text: { type: String, required: true },
    remindAt: { type: Date, required: true },
    delivered: { type: Boolean, default: false },
});

reminderSchema.index({ remindAt: 1, delivered: 1 });

const Reminder = model("Reminder", reminderSchema);

export { Reminder, reminderSchema };
export type { IReminder };
