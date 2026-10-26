
'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
  server,
  perMessageDeflate: false,
  maxPayload: 1024 * 1024
});

let latestStatePacket = null;
let controllerSocket = null;

const pendingActions = new Map();
const ACTION_TIMEOUT_MS = 10000;

app.get('/', (_req, res) => {
  res.type('text').send('SkyRush Pro Cloud WebSocket Relay is Active!');
});

app.get('/health', (_req, res) => {
  const clients = [...wss.clients].filter(
    client => client.readyState === WebSocket.OPEN
  );

  res.json({
    ok: true,
    service: 'SkyRush Pro Cloud WebSocket Relay',
    connectedClients: clients.length,
    controllerConnected: Boolean(
      controllerSocket &&
      controllerSocket.readyState === WebSocket.OPEN
    ),
    tvClients: clients.filter(client => client.skyRole === 'tv').length,
    hasCachedState: Boolean(latestStatePacket),
    pendingActions: pendingActions.size,
    timestamp: new Date().toISOString()
  });
});

function send(ws, packet) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;

  try {
    ws.send(typeof packet === 'string' ? packet : JSON.stringify(packet));
    return true;
  } catch (error) {
    console.error('Send failed:', error.message);
    return false;
  }
}

function refreshController() {
  if (
    controllerSocket &&
    controllerSocket.readyState === WebSocket.OPEN
  ) return;

  controllerSocket = null;

  for (const client of wss.clients) {
    if (
      client.skyRole === 'controller' &&
      client.readyState === WebSocket.OPEN
    ) {
      controllerSocket = client;
      break;
    }
  }
}

function sendStateToTVs() {
  if (!latestStatePacket) return;

  for (const client of wss.clients) {
    if (client.skyRole === 'tv') {
      send(client, latestStatePacket);
    }
  }
}

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.skyRole = 'unknown';

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  console.log('Client connected');

  ws.on('message', raw => {
    let packet;

    try {
      packet = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!packet || typeof packet !== 'object') return;

    // Register each browser's role.
    if (packet.type === 'hello') {
      const role = packet.role;

      if (role !== 'controller' && role !== 'tv') {
        ws.skyRole = 'unknown';
        return;
      }

      ws.skyRole = role;

      if (role === 'controller') {
        controllerSocket = ws;

        // Immediately provide the controller with a cached state,
        // if one exists, so it can restore its display.
        if (latestStatePacket) {
          send(ws, latestStatePacket);
        }
      }

      if (role === 'tv' && latestStatePacket) {
        send(ws, latestStatePacket);
      }

      console.log(`Client registered as ${ws.skyRole}`);
      return;
    }

    // Only the Admin controller may publish authoritative game state.
    if (packet.type === 'state') {
      if (ws.skyRole !== 'controller') return;
      if (!packet.state || typeof packet.state !== 'object') return;

      latestStatePacket = JSON.stringify(packet);
      sendStateToTVs();
      return;
    }

    // TV requests the most recent state.
    if (packet.type === 'request-state') {
      if (latestStatePacket) send(ws, latestStatePacket);

      refreshController();

      if (controllerSocket && controllerSocket !== ws) {
        send(controllerSocket, { type: 'request-state' });
      }

      return;
    }

    // Only a registered TV may request a player action.
    if (packet.type === 'action' && ws.skyRole === 'tv') {
      const action = packet.action;

      if (!action || typeof action !== 'object') return;

      const id = Number(action.id);

      if (
        action.type === 'station' &&
        ![1, 2, 3, 4].includes(id)
      ) {
        send(ws, {
          type: 'action-result',
          requestId: action.requestId || '',
          ok: false,
          message: 'Invalid player number'
        });
        return;
      }

      refreshController();

      const requestId = String(
        action.requestId ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`
      );

      if (!controllerSocket) {
        send(ws, {
          type: 'action-result',
          requestId,
          ok: false,
          message: 'Admin offline — action not sent'
        });
        return;
      }

      // Avoid accidentally executing a duplicated request.
      if (pendingActions.has(requestId)) return;

      action.requestId = requestId;

      const timeout = setTimeout(() => {
        const pending = pendingActions.get(requestId);

        if (!pending) return;

        pendingActions.delete(requestId);

        send(pending.requester, {
          type: 'action-result',
          requestId,
          ok: false,
          message: 'Admin response timed out — check game state before retrying'
        });
      }, ACTION_TIMEOUT_MS);

      pendingActions.set(requestId, {
        requester: ws,
        timeout
      });

      if (!send(controllerSocket, packet)) {
        clearTimeout(timeout);
        pendingActions.delete(requestId);

        send(ws, {
          type: 'action-result',
          requestId,
          ok: false,
          message: 'Could not send action to Admin'
        });
      }

      return;
    }

    // Only the Admin may return an action result.
    if (
      packet.type === 'action-result' &&
      ws.skyRole === 'controller'
    ) {
      const requestId = String(packet.requestId || '');
      const pending = pendingActions.get(requestId);

      if (!pending) return;

      clearTimeout(pending.timeout);
      pendingActions.delete(requestId);

      send(pending.requester, packet);
    }
  });

  ws.on('close', () => {
    if (controllerSocket === ws) controllerSocket = null;

    for (const [id, pending] of pendingActions.entries()) {
      if (pending.requester === ws) {
        clearTimeout(pending.timeout);
        pendingActions.delete(id);
      }
    }

    refreshController();
    console.log('Client disconnected');
  });

  ws.on('error', error => {
    console.error('WebSocket error:', error.message);
  });
});

// Remove dead connections and allow browsers to reconnect.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }

    ws.isAlive = false;

    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  }
}, 25000);

wss.on('close', () => clearInterval(heartbeat));

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log(`SkyRush relay listening on port ${PORT}`);
});
