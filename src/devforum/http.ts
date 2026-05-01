import http from "node:http";
import https from "node:https";
import axios from "axios";
import type { RateLimiter } from "../scheduler/rate-limiter.js";

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

export function setupRateLimiter(rateLimiter: RateLimiter) {
  devForumClient.interceptors.request.use(async (config) => {
    await rateLimiter.acquire();
    return config;
  });

  devForumClient.interceptors.response.use(
    (response) => {
      rateLimiter.resetBackoff();
      return response;
    },
    (error) => {
      if (error.response) {
        rateLimiter.reportError(error.response.status);
      }
      return Promise.reject(error);
    },
  );
}
