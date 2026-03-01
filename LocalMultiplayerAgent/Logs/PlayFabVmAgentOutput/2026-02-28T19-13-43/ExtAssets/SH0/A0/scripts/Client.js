import AssetSystem from './AssetSystem.js';
import InputManager from './InputManager.js';
import RenderSystem from './RenderSystem.js';
import AudioSystem from './AudioSystem.js';
import UISystem from './UISystem.js';
import LootSystem from './LootSystem.js';
import { NetworkEvents } from './NetworkEvents.js';

export default class Client {
    constructor(serverAddress, ticket) {
        this.serverAddress = serverAddress;
        this.ticket = ticket;
        this.assetSystem = new AssetSystem();
        this.inputManager = new InputManager({});
        this.renderSystem = null;
        this.audioSystem = new AudioSystem();
        this.lootSystem = null; // Initialized after assets load
        this.uiSystem = new UISystem(this);
        
        this.worldState = {
            entities: new Map(),
            projectiles: [],
            loot: new Map(),
        };

        this.myId = null;
    }

    async init() {
        const configs = await this.assetSystem.loadAll();
        this.lootSystem = new LootSystem(configs.items);
        
        this.renderSystem = new RenderSystem('game-canvas', window.innerWidth, window.innerHeight, 48);
        await this.renderSystem.setAssetLoader(this.assetSystem);
        
        this.ws = new WebSocket(`${this.serverAddress}?ticket=${this.ticket}`);
        
        this.ws.onopen = () => {
            console.log('Connected to server');
        };

        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === NetworkEvents.SNAPSHOT) {
                this.handleSnapshot(message.payload);
            }
        };

        this.ws.onclose = () => {
            console.log('Disconnected from server');
        };

        this.inputManager.on('intent', (intent) => {
            this.sendInput(intent);
        });

        this.render();
    }

    sendInput(intent) {
        if (this.ws.readyState === WebSocket.OPEN) {
            const input = {
                tick: 0, // Tick will be assigned by the server
                intent: intent
            };
            this.ws.send(JSON.stringify(input));
        }
    }

    handleSnapshot(snapshot) {
        // Update simple properties
        if (snapshot.gameTime !== undefined) this.worldState.gameTime = snapshot.gameTime;
        if (snapshot.projectiles) this.worldState.projectiles = snapshot.projectiles;
        if (snapshot.grid) this.worldState.grid = snapshot.grid;

        // Reconstruct Maps from serialized arrays
        if (snapshot.entities) {
            this.worldState.entities = new Map(snapshot.entities);
        }
        if (snapshot.loot) {
            this.worldState.loot = new Map(snapshot.loot);
        }
        if (this.lootSystem && this.worldState.loot) this.lootSystem.syncLoot(this.worldState.loot);
    }

    render() {
        requestAnimationFrame(() => this.render());
        if (!this.renderSystem) return;

        this.renderSystem.render(
            this.worldState.grid,
            this.worldState.entities,
            this.worldState.loot,
            this.worldState.projectiles,
            null,
            this.myId,
            false
        );
    }
}
