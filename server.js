
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let latestStatePacket = null;
let connectedClients = 0;

// Main service check
app.get('/', (_req, res) => {
  res.type('text').send(
    'SkyRush Pro Cloud WebSocket Relay is Active!'
  );
});

// Health check
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'SkyRush Pro Cloud WebSocket Relay',
    connectedClients,
    hasCachedState: Boolean(latestStatePacket),
    timestamp: new Date().toISOString()
  });
});

wss.on('connection', (ws) => {
  connectedClients++;

  console.log(
    `Client connected. Total: ${connectedClients}`
  );

  // Send the latest game state to a newly connected TV.
  if (latestStatePacket && ws.readyState === WebSocket.OPEN) {
    ws.send(latestStatePacket);
  }

  ws.on('message', (raw) => {
    const message = raw.toString();
    let packet;

    try {
      packet = JSON.parse(message);
    } catch (err) {
      console.error('Invalid JSON packet received.');
      return;
    }

    // Save the most recent game state.
    if (
      packet &&
      packet.type === 'state' &&
      packet.state &&
      typeof packet.state === 'object'
    ) {
      latestStatePacket = message;
    }

    // TV requests the latest game state.
    if (packet && packet.type === 'request-state') {
      // Reply with the cached state if available.
      if (
        latestStatePacket &&
        ws.readyState === WebSocket.OPEN
      ) {
        ws.send(latestStatePacket);
      }

      // Ask other connected clients, including Admin,
      // to send a fresh state snapshot.
      wss.clients.forEach((client) => {
        if (
          client !== ws &&
          client.readyState === WebSocket.OPEN
        ) {
          client.send(message);
        }
      });

      return;
    }

    // Relay all other packets to the other clients.
    wss.clients.forEach((client) => {
      if (
        client !== ws &&
        client.readyState === WebSocket.OPEN
      ) {
        client.send(message);
      }
    });
  });

  ws.on('close', () => {
    connectedClients = Math.max(0, connectedClients - 1);

    console.log(
      `Client disconnected. Total: ${connectedClients}`
    );
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`SkyRush relay listening on port ${PORT}`);
});
