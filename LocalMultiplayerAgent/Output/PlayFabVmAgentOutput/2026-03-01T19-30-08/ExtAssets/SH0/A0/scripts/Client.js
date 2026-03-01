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
            gridRevision: -1
        };

        this.myId = null;
        this.lastInputTime = 0;
    }

    async init() {
        const configs = await this.assetSystem.loadAll();
        this.lootSystem = new LootSystem(configs.items);

        // --- Load Entity & Item Sprites ---
        const imagesToLoad = {
            'eliteknight.png': './assets/images/actors/eliteknight.png', // Player
            'potion_red.png': './assets/images/items/potion_red.png'       // Default Potion
        };

        // 1. Load Enemy Sprites
        if (configs.enemies) {
            for (const key in configs.enemies) {
                const enemy = configs.enemies[key];
                if (enemy.sprite) {
                    imagesToLoad[enemy.sprite] = `./assets/images/actors/${enemy.sprite}`;
                }
            }
        }

        // 2. Load Item Sprites
        if (configs.items) {
            const processCategory = (cat) => {
                if (!cat) return;
                for (const key in cat) {
                    const item = cat[key];
                    if (item.sprite) {
                        imagesToLoad[item.sprite] = `./assets/images/items/${item.sprite}`;
                    }
                }
            };
            processCategory(configs.items.weapons);
            processCategory(configs.items.armor);
            processCategory(configs.items.consumables);
        }
        await this.assetSystem.loadImages(imagesToLoad);
        
        this.renderSystem = new RenderSystem('game-canvas', window.innerWidth, window.innerHeight, 48);
        await this.renderSystem.setAssetLoader(this.assetSystem);
        this.renderSystem.setEnemiesConfig(configs.enemies);
        
        this.ws = new WebSocket(`${this.serverAddress}?ticket=${this.ticket}`);
        
        this.ws.onopen = () => {
            console.log('Connected to server');
        };

        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === NetworkEvents.SNAPSHOT) {
                this.handleSnapshot(message.payload);
            } else if (message.type === NetworkEvents.INIT_WORLD) {
                this.myId = message.payload.id;
                const el = document.getElementById('room-code-display');
                if (el) el.innerText = "Live";
            } else if (message.type === NetworkEvents.EFFECT) {
                if (message.payload.type === 'attack') {
                    this.renderSystem.triggerAttack(message.payload.sourceId);
                    this.renderSystem.triggerDamage(message.payload.targetId, message.payload.sourceId);
                }
            } else if (message.type === NetworkEvents.ENTITY_DEATH) {
                this.renderSystem.triggerDeath(message.payload.id);
            } else if (message.type === NetworkEvents.UPDATE_INVENTORY) {
                if (this.lootSystem) {
                    this.lootSystem.inventories.set(this.myId, message.payload.inventory);
                    this.lootSystem.equipment.set(this.myId, message.payload.equipment);
                    this.uiSystem.renderInventory();
                    this.uiSystem.updateQuickSlotUI();
                }
            } else if (message.type === NetworkEvents.LOOT_OPENED) {
                if (this.lootSystem) {
                    this.lootSystem.markOpened(message.payload.id);
                }
            }
        };

        this.ws.onclose = () => {
            console.log('Disconnected from server');
        };

        this.inputManager.on('intent', (intent) => {
            this.sendInput(intent);
        });

        this.inputManager.on('click', (data) => {
            const cam = this.renderSystem.camera;
            const ts = this.renderSystem.tileSize;
            const scale = this.renderSystem.scale;
            
            const gridX = Math.floor(((data.x / scale) + cam.x) / ts);
            const gridY = Math.floor(((data.y / scale) + cam.y) / ts);
            
            this.sendInput({
                type: 'TARGET_ACTION',
                x: gridX,
                y: gridY,
                shift: data.shift
            });
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
        if (snapshot.gridRevision !== undefined) this.worldState.gridRevision = snapshot.gridRevision;

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

        // Poll for continuous movement input
        const now = Date.now();
        if (now - this.lastInputTime > 50) { // Cap at ~20 inputs/sec
            const moveIntent = this.inputManager.getMovementIntent();
            if (moveIntent) {
                this.sendInput(moveIntent);
                this.lastInputTime = now;
            }
        }

        if (this.uiSystem && this.worldState.gameTime !== undefined) {
            this.uiSystem.updateTimer(this.worldState.gameTime);
        }

        this.renderSystem.render(
            this.worldState.grid,
            this.worldState.entities,
            this.worldState.loot,
            this.worldState.projectiles,
            null,
            this.myId,
            false,
            this.worldState.gridRevision
        );
    }
}
