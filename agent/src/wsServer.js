/**
 * wsServer.js
 *
 * WebSocket endpoint that streams real-time log lines to the frontend at
 * ws://localhost:3002/ws/agent.
 *
 * The WebSocket server is attached to the same HTTP server as Express, so
 * both protocols share port 3002 transparently.
 */

const { WebSocketServer } = require('ws');

// Winston doesn't need explicit import for the broadcast interceptor
// because index.ts passes through the patched logger; we just declare wss.

const LOG_BUFFER_MAX = 200;
const logBuffer = [];
let wss = null;

var broadcast = (line) => {
  logBuffer.push(line);
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
  if (wss) {
    for (const client of wss.clients) {
      if (client.readyState === 1 /* OPEN */) client.send(line);
    }
  }
};

/**
 * Start WebSocket server on the same HTTP server as Express.
 * Must be called *after* `httpServer.listen()`.
 *
 * @param {import('http').Server} httpServer  The raw Node http.Server
 */
function startWSServer(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws/agent' });

  wss.on('connection', (_ws, req) => {
    // Replay last 50 lines so the drawer is not empty on first connect
    const snapshot = logBuffer.slice(-50);
    for (const line of snapshot) {
      if (_ws.readyState === 1) _ws.send(line);
    }
    if (req && req.url) console.info('[WS] client connected', { path: req.url });
  });

  wss.on('error', (err) => console.warn('[WS] server error', { error: err.message }));

  console.info('[wsServer] Listening on ws://localhost:3002/ws/agent');
  return wss;
}

module.exports = { startWSServer };
