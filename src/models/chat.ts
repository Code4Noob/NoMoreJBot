import { Schema, Types, model } from "mongoose";

interface IChat {
  // _id: Types.ObjectId;
  id: number;
  title: string;
  type: string;
  all_members_are_administrators?: boolean;
}

const chatSchema = new Schema<IChat>({
  // _id: { type: Schema.Types.ObjectId, required: true },
  id: { type: Number, required: true },
  title: { type: String },
  type: { type: String, required: true },
  all_members_are_administrators: { type: Boolean },
});

const Chat = model("Chat", chatSchema);

export { Chat, chatSchema };
