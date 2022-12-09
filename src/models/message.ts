import { Schema, Types, model } from "mongoose";

interface IMessage {
  _id: Types.ObjectId;
}

const messageSchema = new Schema<IMessage>({
  _id: { type: Schema.Types.ObjectId, required: true },
});

const Message = model("Message", messageSchema);

export { Message, messageSchema };
