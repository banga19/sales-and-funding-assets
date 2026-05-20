/**
 * wsServer.js
 *
 * WebSocket endpoint that streams real-time log lines AND structured agent
 * events to the frontend at ws://localhost:3002/ws/agent.
 *
 * Message format:
 *   Log lines:    { type: 'log', level: 'info', message: '...', ts: '...' }
 *   Agent events: { type: 'agent', agent: 'bulk-sourcing', event: 'progress', data: {...}, ts: '...' }
 *
 * The WebSocket server is attached to the same HTTP server as Express, so
 * both protocols share port 3002 transparently.
 */

const { WebSocketServer } = require('ws');

const LOG_BUFFER_MAX = 200;
const EVENT_BUFFER_MAX = 100;
const logBuffer = [];
const eventBuffer = [];
let wss = null;

/**
 * broadcastLog — push a log line to all connected clients.
 * @param {string} line  Raw log string or JSON object
 */
var broadcastLog = (line) => {
  const entry = typeof line === 'string' ? line : JSON.stringify(line);
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
  if (wss) {
    for (const client of wss.clients) {
      if (client.readyState === 1 /* OPEN */) client.send(entry);
    }
  }
};

/**
 * broadcastAgentEvent — push a structured agent event to all connected clients.
 * @param {object} event  { agent, event, data }
 */
var broadcastAgentEvent = (event) => {
  const entry = JSON.stringify({
    type: 'agent',
    ts: new Date().toISOString(),
    ...event,
  });
  eventBuffer.push(entry);
  if (eventBuffer.length > EVENT_BUFFER_MAX) eventBuffer.shift();
  if (wss) {
    for (const client of wss.clients) {
      if (client.readyState === 1 /* OPEN */) client.send(entry);
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
    // Replay last 50 log lines + last 20 agent events
    const logSnapshot = logBuffer.slice(-50);
    const eventSnapshot = eventBuffer.slice(-20);
    for (const line of [...logSnapshot, ...eventSnapshot]) {
      if (_ws.readyState === 1) _ws.send(line);
    }
    if (req && req.url) console.info('[WS] client connected', { path: req.url });
  });

  wss.on('error', (err) => console.warn('[WS] server error', { error: err.message }));

  console.info('[wsServer] Listening on ws://localhost:3002/ws/agent');
  return wss;
}

module.exports = { startWSServer, broadcastLog, broadcastAgentEvent };
