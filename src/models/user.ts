import { Chat, chatSchema } from "./chat";
import { Schema, Types, model } from "mongoose";

interface IUser {
    _id: Types.ObjectId;
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
    language_code?: string;
    chat: [];
    day?: number;
    day_updated_at?: Date;
}

const userSchema = new Schema<IUser>({
    _id: { type: Schema.Types.ObjectId, required: true },
    id: { type: Number, required: true },
    is_bot: { type: Boolean, required: true },
    first_name: { type: String, required: true },
    username: { type: String },
    language_code: { type: String },
    chat: [{ type: Schema.Types.ObjectId, ref: "Chat" }],
    day: { type: Number },
    day_updated_at: { type: Date },
});

const User = model("User", userSchema);

export { User, userSchema };
