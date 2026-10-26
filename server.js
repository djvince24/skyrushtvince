const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let lastState = null;

wss.on('connection', (ws) => {
    console.log('Client connected.');

    // Send the last known game state immediately upon connection
    if (lastState) {
        ws.send(JSON.stringify(lastState));
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'STATE_UPDATE') {
                lastState = data; // Cache the latest state
            }
        } catch (e) {}

        // Broadcast the message to all other connected clients across the network
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    ws.on('close', () => {
        console.log('Client disconnected.');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`SkyRush Relay Server running on port ${PORT}`);
});
