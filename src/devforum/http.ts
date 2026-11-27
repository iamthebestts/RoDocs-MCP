import axios from "axios";
import { RateLimiter } from "../scheduler/rate-limiter.js";
import { createKeepAliveAgents } from "../utils/axios-agents.js";

/** Shared cap for keep-alive sockets and DevForum concurrency defaults. */
export const DEVFORUM_HTTP_CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 15000;

const { httpAgent, httpsAgent } = createKeepAliveAgents(DEVFORUM_HTTP_CONCURRENCY);

export const devForumClient = axios.create({
  timeout: REQUEST_TIMEOUT_MS,
  httpAgent,
  httpsAgent,
  headers: {
    "User-Agent": "rodocsmcp/2.0.0",
    Accept: "application/json",
  },
  validateStatus: (status) => status === 200,
});

let rateLimiter = new RateLimiter(2);
let interceptorsInstalled = false;
const MAX_THROTTLE_RETRIES = 5;

type RetryConfig = { __retryCount?: number };

function installInterceptors(): void {
  if (interceptorsInstalled) return;
  interceptorsInstalled = true;

  devForumClient.interceptors.request.use(async (config) => {
    await rateLimiter.acquire();
    return config;
  });

  devForumClient.interceptors.response.use(
    (response) => {
      rateLimiter.resetBackoff();
      if (typeof response.data !== "object" || response.data === null) {
        return Promise.reject(
          new Error(`Invalid DevForum response body (status ${response.status})`),
        );
      }
      return response;
    },
    async (error: unknown) => {
      if (!axios.isAxiosError(error) || error.config === undefined) {
        return Promise.reject(error);
      }

      const status = error.response?.status;
      if (status !== undefined) {
        rateLimiter.reportError(status);
      }

      if (status === 202 || status === 429) {
        const config = error.config as RetryConfig;
        const retryCount = config.__retryCount ?? 0;
        if (retryCount < MAX_THROTTLE_RETRIES) {
          config.__retryCount = retryCount + 1;
          const backoffMs = 1000 * 2 ** retryCount + Math.floor(Math.random() * 500);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          return devForumClient.request(error.config);
        }
      }

      return Promise.reject(error);
    },
  );
}

installInterceptors();

export function setupRateLimiter(next: RateLimiter): void {
  rateLimiter = next;
}
