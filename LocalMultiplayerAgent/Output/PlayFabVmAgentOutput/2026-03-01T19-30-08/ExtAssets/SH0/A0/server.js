import 'dotenv/config';
import { WebSocketServer } from 'ws';
import { Game } from './scripts/CoreGame.js';
import { NetworkEvents } from './scripts/NetworkEvents.js';
import { GSDKInstance } from './scripts/GSDK.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PlayFab = require('playfab-sdk/Scripts/PlayFab/PlayFab.js');
const PlayFabServer = require('playfab-sdk/Scripts/PlayFab/PlayFabServer.js');

// Configure PlayFab
PlayFab.settings.titleId = process.env.TITLE_ID;
PlayFab.settings.developerSecretKey = process.env.SERVER_SECRET_KEY;

// Start the GSDK
GSDKInstance.start();

// 1. Determine port from GSDK Config (Local Agent) or Env (Container/Cloud)
let port = process.env.PORT || 8080;
const connectionInfo = GSDKInstance.getGameServerConnectionInfo();
if (connectionInfo && connectionInfo.game_port) {
    port = parseInt(connectionInfo.game_port, 10);
}

const game = new Game();

// Broadcast world events (projectiles, effects, etc.)
game.onWorldUpdate = (event) => {
    const message = JSON.stringify(event);
    wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
            client.send(message);
        }
    });
};

// Send message to specific client
game.onUnicast = (playerId, event) => {
    const message = JSON.stringify(event);
    const client = Array.from(wss.clients).find(c => c.playerId === playerId);
    if (client && client.readyState === client.OPEN) {
        client.send(message);
    }
};

// 2. Initialise WebSocket server
const wss = new WebSocketServer({ port }, () => {
    console.log(`WebSocket server started on port ${port}`);
    
    // 3. Signal that the server is ready for players ONLY after the port is open
    GSDKInstance.readyForPlayers();
});

// 4. Handle transition to 'ACTIVE' state
// This occurs when Matchmaking has assigned players to this instance
GSDKInstance.registerActiveCallback(() => {
    console.log('Server moved to ACTIVE state. Starting game logic.');
    game.startGame();
});

wss.on('connection', async (ws, req) => {
    console.log('Client attempting to connect...');
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const ticket = url.searchParams.get('ticket');

    if (!ticket) {
        console.error('Connection attempt without session ticket. Closing connection.');
        ws.close();
        return;
    }

    let authResult;
    if (ticket === 'DEBUG') {
        console.log('Client connected with DEBUG ticket. Bypassing PlayFab auth.');
        authResult = {
            PlayFabId: `DEBUG_${Date.now()}`,
            TitleInfo: { DisplayName: 'DebugPlayer' }
        };
    } else {
        authResult = await authenticate(ticket);
    }

    if (!authResult) {
        console.error('Session ticket validation failed. Closing connection.');
        ws.close();
        return;
    }
    
    const playerId = authResult.PlayFabId;
    console.log(`Client connected with PlayFabId: ${playerId}`);
    ws.playerId = playerId;
    
    game.addPlayer(playerId, { name: authResult.TitleInfo ? authResult.TitleInfo.DisplayName : 'Unknown' });

    updateConnectedPlayers();

    // Send Init Packet so client knows their ID
    ws.send(JSON.stringify({
        type: NetworkEvents.INIT_WORLD,
        payload: { id: playerId }
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            game.handlePlayerInput(ws.playerId, data);
        } catch (e) {
            console.error('Failed to parse message:', message, e);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        game.removePlayer(ws.playerId);
        updateConnectedPlayers();
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        game.removePlayer(ws.playerId);
        updateConnectedPlayers();
    });
});

async function authenticate(ticket) {
    return new Promise((resolve) => {
        const request = {
            SessionTicket: ticket,
            TitleId: PlayFab.settings.titleId,
        };
        PlayFabServer.AuthenticateSessionTicket(request, (error, result) => {
            if (error) {
                console.error('PlayFab authentication error:', error.errorMessage);
                resolve(null);
            } else {
                resolve(result.data.UserInfo);
            }
        });
    });
}

function updateConnectedPlayers() {
    const players = Array.from(wss.clients).map(client => ({ PlayFabId: client.playerId }));
    GSDKInstance.updateConnectedPlayers(players);
}

// 5. Explicitly handle shutdown to allow Azure to recycle the instance
GSDKInstance.registerShutdownCallback(() => {
    console.log('Shutdown callback received. Shutting down server.');
    wss.close(() => {
        process.exit(0);
    });
});

// Broadcast game state to all clients at a regular interval
setInterval(() => {
    const state = game.getAuthoritativeState();
    const message = JSON.stringify({ type: NetworkEvents.SNAPSHOT, payload: state });
    
    wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
            client.send(message);
        }
    });
}, 125);