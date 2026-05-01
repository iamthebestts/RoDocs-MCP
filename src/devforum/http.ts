import http from "node:http";
import https from "node:https";
import axios from "axios";

const TOPIC_CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 15000;

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: TOPIC_CONCURRENCY,
  maxFreeSockets: TOPIC_CONCURRENCY,
  scheduling: "lifo",
});

httpsAgent.on("socket", (socket) => {
  if (socket.getMaxListeners() < 20) socket.setMaxListeners(20);
});

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: TOPIC_CONCURRENCY,
  maxFreeSockets: TOPIC_CONCURRENCY,
});

httpAgent.on("socket", (socket) => {
  if (socket.getMaxListeners() < 20) socket.setMaxListeners(20);
});

export const devForumClient = axios.create({
  timeout: REQUEST_TIMEOUT_MS,
  httpAgent,
  httpsAgent,
});
