import http from "node:http";
import https from "node:https";
import type { Socket } from "node:net";

function bumpSocketMaxListeners(socket: Socket): void {
  socket.setMaxListeners(0);
}

export function createKeepAliveAgents(maxSockets = 8): {
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
} {
  const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets,
    maxFreeSockets: maxSockets,
    scheduling: "lifo",
  });
  httpsAgent.on("free", bumpSocketMaxListeners);
  httpsAgent.on("socket", bumpSocketMaxListeners);

  const httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets,
    maxFreeSockets: maxSockets,
  });
  httpAgent.on("free", bumpSocketMaxListeners);
  httpAgent.on("socket", bumpSocketMaxListeners);

  return { httpAgent, httpsAgent };
}
