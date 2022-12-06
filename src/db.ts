import { MongoClient } from "mongodb";

// Connection URL
const url = `mongodb://${process.env.MONGOUSER}:${process.env.MONGOPASSWORD}@${process.env.MONGOHOST}:${process.env.MONGOPORT}`;
const client = new MongoClient(url);

export default client;
