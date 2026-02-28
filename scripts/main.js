import { playFabManager } from './PlayFabManager.js';
import Client from './Client.js';
import UISystem from './UISystem.js';
import Database from './Database.js';

class App {
    constructor() {
        this.database = new Database();
        this.playerData = { name: 'Player', gold: 0, class: 'Fighter' };
        
        // Mock systems for UI before game starts
        this.lootSystem = {
            getInventory: () => [],
            getEquipment: () => ({}),
            getItemConfig: () => null,
            getItemType: () => 'misc'
        };
        this.state = { myId: null };
        
        this.uiSystem = new UISystem(this);
        this.client = null;
    }

    async init() {
        console.log("Initializing App...");
        this.playerData = await this.database.getPlayer();
        this.uiSystem.setupLobby();
    }

    // Called by Lobby UI
    startQuickJoin() {
        const queueName = 'Default'; // Must match queue configured in PlayFab
        this.uiSystem.updateLobbyStatus("Initializing Matchmaking...");
        
        playFabManager.startMatchmaking(queueName, (result, error) => {
            if (error) {
                console.error("Matchmaking Error:", error);
                this.uiSystem.updateLobbyStatus("Matchmaking Failed: " + (error.errorMessage || "Unknown Error"));
                return;
            }

            const ticketId = result.data.TicketId;
            console.log("Ticket created:", ticketId);
            this.uiSystem.updateLobbyStatus("Searching for match...");
            this.pollTicket(ticketId, queueName);
        });
    }

    pollTicket(ticketId, queueName) {
        const pollInterval = setInterval(() => {
            playFabManager.pollMatchmakingTicket(ticketId, queueName, (result, error) => {
                if (error) {
                    clearInterval(pollInterval);
                    console.error("Polling Error:", error);
                    this.uiSystem.updateLobbyStatus("Polling Error");
                    return;
                }

                const status = result.data.Status;
                console.log("Match Status:", status);

                if (status === 'Matched') {
                    clearInterval(pollInterval);
                    this.uiSystem.updateLobbyStatus("Match Found! Retrieving details...");
                    this.getMatchDetails(result.data.MatchId, queueName);
                } else if (status === 'Canceled' || status === 'Failed') {
                    clearInterval(pollInterval);
                    this.uiSystem.updateLobbyStatus("Matchmaking Canceled");
                } else {
                    this.uiSystem.updateLobbyStatus(`Status: ${status}...`);
                }
            });
        }, 6000); // Poll every 6 seconds
    }

    getMatchDetails(matchId, queueName) {
        playFabManager.getMatch(matchId, queueName, (result, error) => {
            if (error) {
                console.error("Get Match Error:", error);
                this.uiSystem.updateLobbyStatus("Failed to get server details.");
                return;
            }

            const serverDetails = result.data.ServerDetails;
            if (serverDetails) {
                const host = serverDetails.IPV4Address;
                const port = serverDetails.Ports.find(p => p.Name === 'game_port').Num;
                
                // We use the MatchId or a specific ticket as the session auth
                // For this implementation, we'll pass the PlayFab Session Ticket we already have implicitly,
                // but the server expects a 'ticket' param. We can pass the EntityToken or SessionTicket.
                // Since PlayFabManager stores the session ticket internally in the SDK, we can grab it:
                const sessionTicket = PlayFab._internalSettings.sessionTicket;
                
                this.connectToGame(host, port, sessionTicket);
            }
        });
    }

    async connectToGame(host, port, ticket) {
        console.log(`Connecting to ${host}:${port}...`);
        this.uiSystem.updateLobbyStatus(`Connecting to server...`);
        document.getElementById('lobby-screen').classList.add('hidden');
        
        this.client = new Client(`ws://${host}:${port}`, ticket);
        await this.client.init();
        
        // Hook up UI to Client
        this.client.uiSystem = this.uiSystem;
        // Update App state reference for UI
        this.lootSystem = this.client.worldState.loot; // This needs to be mapped correctly in Client
        
        // Update InventoryUI to use the real LootSystem from the Client
        if (this.uiSystem.inventoryUI && this.client.lootSystem) {
            this.uiSystem.inventoryUI.lootSystem = this.client.lootSystem;
        }
    }

    // Stub methods for UISystem compatibility until full refactor
    handleEquipItem(itemId, slot) { if(this.client) this.client.sendInput({ type: 'EQUIP', itemId, slot }); }
    handleUnequipItem(slot) { if(this.client) this.client.sendInput({ type: 'UNEQUIP', slot }); }
    handleDropItem(itemId, source) { if(this.client) this.client.sendInput({ type: 'DROP', itemId, source }); }
    handleInteractWithLoot(loot) { if(this.client) this.client.sendInput({ type: 'INTERACT_LOOT', lootId: loot.id }); }
}

const app = new App();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
} else {
    app.init();
}