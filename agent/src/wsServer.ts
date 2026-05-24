import type { IncomingMessage, ServerResponse } from 'http';
import type { WebSocket as WsWebSocket, WebSocketServer } from 'ws';

/**
 * startWSServer — attach a real WebSocket server to the given HTTP server.
 * @param server  The Node.js HTTP server instance (created by express).
 * @returns       An object with a `broadcast` function to send messages to all connected clients.
 */
export function startWSServer(server: ReturnType<typeof import('http').createServer>): { broadcast: (data: any) => void } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const WS = require('ws') as typeof import('ws');
  const wss: WebSocketServer = new WS.Server({ server });

  const clients = new Set<WsWebSocket>();

  wss.on('connection', (ws: WsWebSocket) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', (err: Error) => {
      console.error('[ws] WebSocket error:', err);
    });
  });

  console.log('[ws] WebSocket server initialised — real-time agent logs will be broadcasted.');

  const broadcast = (data: any) => {
    const message = JSON.stringify(data);
    for (const client of clients) {
      if (client.readyState === WS.OPEN) {
        client.send(message);
      }
    }
  };

  return { broadcast };
}

/**
 * broadcastAgentEvent — no-op stub kept for compatibility.
 * In the current implementation, real-time events are handled via the WebSocket server above.
 */
export function broadcastAgentEvent(_event: Record<string, unknown>): void {
  // Intentionally left empty; the WebSocket server handles broadcasting.
}