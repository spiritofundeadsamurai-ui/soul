/**
 * WebSocket Notifications — Real-time push to connected clients
 *
 * Uses raw HTTP upgrade + WebSocket protocol (no ws package needed)
 * Events: memory_created, learning_added, task_completed, agent_response, search_result, media_created
 */

import { createHash, randomUUID } from "crypto";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";

interface WSClient {
  id: string;
  socket: Duplex;
  connectedAt: string;
  lastPing: number;
}

const clients = new Map<string, WSClient>();
let initialized = false;

// ─── WebSocket Frame Helpers ───

function encodeFrame(data: string): Buffer {
  const payload = Buffer.from(data, "utf-8");
  const len = payload.length;
  let header: Buffer;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // text frame, FIN
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

function decodeFrame(buf: Buffer): string | null {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  if (opcode === 0x08) return null; // close frame
  if (opcode === 0x09) return "__ping__";
  if (opcode === 0x0a) return "__pong__";

  const masked = (buf[1] & 0x80) !== 0;
  let payloadLen = buf[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    payloadLen = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  let mask: Buffer | null = null;
  if (masked) {
    mask = buf.subarray(offset, offset + 4);
    offset += 4;
  }

  const payload = buf.subarray(offset, offset + payloadLen);
  if (mask) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4];
    }
  }

  return payload.toString("utf-8");
}

// ─── Public API ───

/**
 * Initialize WebSocket handling on an HTTP server
 */
export function initWebSocket(server: any): void {
  if (initialized) return;
  initialized = true;

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url !== "/ws" && req.url !== "/ws/") {
      socket.destroy();
      return;
    }

    // WebSocket handshake
    const key = req.headers["sec-websocket-key"];
    if (!key) { socket.destroy(); return; }

    const accept = createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-5AB5DC85B7B8")
      .digest("base64");

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      "\r\n"
    );

    const clientId = randomUUID().split("-")[0];
    const client: WSClient = {
      id: clientId,
      socket,
      connectedAt: new Date().toISOString(),
      lastPing: Date.now(),
    };
    clients.set(clientId, client);

    // Send welcome
    socket.write(encodeFrame(JSON.stringify({
      event: "connected",
      data: { clientId, message: "Soul WebSocket connected" },
    })));

    // Handle incoming messages
    socket.on("data", (buf: Buffer) => {
      try {
        const msg = decodeFrame(buf);
        if (msg === null) {
          // Close frame
          clients.delete(clientId);
          socket.destroy();
          return;
        }
        if (msg === "__ping__") {
          // Send pong
          const pong = Buffer.alloc(2);
          pong[0] = 0x8a; pong[1] = 0;
          socket.write(pong);
          client.lastPing = Date.now();
          return;
        }
        if (msg === "__pong__") {
          client.lastPing = Date.now();
          return;
        }

        // Echo back with ack
        socket.write(encodeFrame(JSON.stringify({
          event: "ack",
          data: { received: msg },
        })));
      } catch {
        // Ignore malformed frames
      }
    });

    socket.on("close", () => clients.delete(clientId));
    socket.on("error", () => clients.delete(clientId));
  });

  // Ping interval to keep connections alive
  setInterval(() => {
    const now = Date.now();
    for (const [id, client] of clients) {
      if (now - client.lastPing > 60000) {
        clients.delete(id);
        client.socket.destroy();
        continue;
      }
      try {
        const ping = Buffer.alloc(2);
        ping[0] = 0x89; ping[1] = 0;
        client.socket.write(ping);
      } catch {
        clients.delete(id);
      }
    }
  }, 30000);
}

/**
 * Broadcast notification to all connected clients
 */
export function broadcastNotification(
  event: string,
  data: Record<string, any>
): number {
  const frame = encodeFrame(JSON.stringify({ event, data, timestamp: new Date().toISOString() }));
  let sent = 0;

  for (const [id, client] of clients) {
    try {
      client.socket.write(frame);
      sent++;
    } catch {
      clients.delete(id);
    }
  }

  return sent;
}

/**
 * Send notification to specific client
 */
export function sendToClient(
  clientId: string,
  event: string,
  data: Record<string, any>
): boolean {
  const client = clients.get(clientId);
  if (!client) return false;

  try {
    client.socket.write(encodeFrame(JSON.stringify({ event, data, timestamp: new Date().toISOString() })));
    return true;
  } catch {
    clients.delete(clientId);
    return false;
  }
}

/**
 * List connected WebSocket clients
 */
export function listConnectedClients(): Array<{ id: string; connectedAt: string }> {
  return Array.from(clients.values()).map((c) => ({
    id: c.id,
    connectedAt: c.connectedAt,
  }));
}

/**
 * Get number of connected clients
 */
export function getClientCount(): number {
  return clients.size;
}
