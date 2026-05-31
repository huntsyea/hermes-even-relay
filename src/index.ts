import { DurableObject } from "cloudflare:workers";
import { MAX_FRAME_BYTES, messageSize, roleForPath } from "./relay";

export interface Env {
  RELAY_SESSIONS: DurableObjectNamespace<RelaySession>;
}

type SocketRole = "gateway" | "device";

interface SocketAttachment {
  role: SocketRole;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
  };
}

function notFound(): Response {
  return json({ error: "not found" }, { status: 404 });
}

function relaySession(request: Request, env: Env): DurableObjectStub<RelaySession> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session") || "default";
  return env.RELAY_SESSIONS.get(env.RELAY_SESSIONS.idFromName(sessionId));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === "GET" && url.pathname === "/healthz") {
      return json({ ok: true }, { headers: corsHeaders() });
    }

    if (url.pathname === "/v1/gateway" || url.pathname === "/v1/device") {
      if (request.headers.get("upgrade") !== "websocket") {
        return json({ error: "expected websocket" }, { status: 426 });
      }
      return relaySession(request, env).fetch(request);
    }

    return notFound();
  },
} satisfies ExportedHandler<Env>;

export class RelaySession extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = roleForPath(url.pathname);
    if (!role) {
      return notFound();
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    server.serializeAttachment({ role } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (messageSize(message) > MAX_FRAME_BYTES) {
      ws.close(1009, "frame too large");
      return;
    }

    const attachment = ws.deserializeAttachment() as SocketAttachment | undefined;
    const targetRole = attachment?.role === "gateway" ? "device" : "gateway";

    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws) {
        continue;
      }
      const peerAttachment = peer.deserializeAttachment() as SocketAttachment | undefined;
      if (peerAttachment?.role === targetRole) {
        peer.send(message);
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    ws.close(1011, "relay error");
  }
}
