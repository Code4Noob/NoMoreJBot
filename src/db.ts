import { connect, disconnect, set } from "mongoose";

// Connection URL
const url =
  process.env.MONGOURL ??
  `mongodb://${process.env.MONGOUSER}:${process.env.MONGOPASSWORD}@${process.env.MONGOHOST}:${process.env.MONGOPORT}`;
set("strictQuery", true);

const dbConnect = async () => {
  return await connect(url, {
    dbName: process.env.dbName,
  });
};

const dbDisconnect = () => {
  disconnect();
};

export { dbConnect, dbDisconnect };
