import { MongoClient } from "mongodb";

// Connection URL
const url = `mongodb://${process.env.MONGOUSER}:${process.env.MONGOPASSWORD}@${process.env.MONGOHOST}:${process.env.MONGOPORT}`;
console.log(url);
const client = new MongoClient(url);

async function main() {
  // Use connect method to connect to the server
  await client.connect();
  console.log("Connected successfully to server");
}

main().then(console.log).catch(console.error);

export default client;
