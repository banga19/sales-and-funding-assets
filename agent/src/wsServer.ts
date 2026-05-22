/**
 * wsServer.ts
 *
 * WebSocket server — stub implementation.
 *
 * In the full implementation, this module uses `ws` to attach an SSE/WebSocket
 * endpoint to the HTTP server so that the frontend dashboard can receive
 * real-time agent progress events without polling. The stub is kept minimal
 * so that the agent can start cleanly even when the `ws` package is not installed.
 *
 * To upgrade the stub to a real implementation:
 *   1. Install ws: npm install ws
 *   2. Replace the console.log calls below with actual socket.io / ws broadcasting.
 *   3. Wire up the NotificationHub subscriber to forward runCompleted/runFailed events.
 */

import type { IncomingMessage, ServerResponse } from 'http';

/**
 * startWSServer — attach a no-op WS listener to the given HTTP server.
 * @param server  The Node.js HTTP server instance (created by express).
 * @returns       The same server reference for chaining.
 */
export function startWSServer(server: ReturnType<typeof import('http').createServer>): ReturnType<typeof import('http').createServer> {
  console.log('[ws] WebSocket stub initialised — real-time events are routed through SSE endpoints for now.');
  return server;
}

/**
 * broadcastAgentEvent — no-op stub. In the full implementation this would forward
 * agent progress events to WebSocket clients subscribed to the event stream.
 */
export function broadcastAgentEvent(_event: Record<string, unknown>): void {
  // stub: SSE endpoints handle forwarding in the current implementation
}
