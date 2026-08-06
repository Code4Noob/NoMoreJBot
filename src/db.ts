import { connect, disconnect, set, connection } from "mongoose";

// Connection URL
const url =
  process.env.MONGOURL ??
  `mongodb://${process.env.MONGOUSER}:${process.env.MONGOPASSWORD}@${process.env.MONGOHOST}:${process.env.MONGOPORT}`;
set("strictQuery", true);

const dbConnect = async () => {
  return await connect(url, {
    dbName: process.env.DB_NAME,
  });
};

const dbDisconnect = () => {
  disconnect();
};

const DB_STATES = ["disconnected", "connected", "connecting", "disconnecting"];

/**
 * DB health check：回報 mongoose connection state，connected 就再實際 ping 一次。
 * 用喺 /help health check。
 */
async function dbHealthCheck(): Promise<string> {
  const state = DB_STATES[connection.readyState] ?? String(connection.readyState);
  if (connection.readyState === 1) {
    try {
      await connection.db?.admin().command({ ping: 1 });
      return `✅ connected（ping OK）`;
    } catch (err: any) {
      return `⚠️ connected 但 ping 失敗: ${err?.message || err}`;
    }
  }
  return `⚠️ ${state}`;
}

export { dbConnect, dbDisconnect, dbHealthCheck };
