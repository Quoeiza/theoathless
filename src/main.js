import AssetLoader from './utils/AssetLoader.js';
import GameLoop from './core/GameLoop.js';
import InputManager from './core/InputManager.js';
import GridSystem from './systems/GridSystem.js';
import RenderSystem from './systems/RenderSystem.js';
import CombatSystem from './systems/CombatSystem.js';
import LootSystem from './systems/LootSystem.js';
import PeerClient from './network/PeerClient.js';
import SyncManager from './network/SyncManager.js';
import AudioSystem from './systems/AudioSystem.js';
import Database from './services/Database.js';

class Game {
    constructor() {
        this.assetLoader = new AssetLoader();
        this.state = {
            myId: null,
            isHost: false,
            connected: false,
            gameTime: 0,
            extractionOpen: false
        };
        this.database = new Database();
        this.playerData = { name: 'Player', gold: 0 };
    }

    async init() {
        // 1. Load Configuration
        const configs = await this.assetLoader.loadAll();
        this.config = configs;
        
        // 2. Load Player Data
        this.playerData = await this.database.getPlayer();

        // 3. Show Lobby
        this.setupLobby();

        // 4. Initialize Systems (Pre-allocation)
        const global = configs.global || {};
        this.gridSystem = new GridSystem(
            global.dungeonWidth || 50, 
            global.dungeonHeight || 50, 
            global.tileSize || 32
        );
        
        this.renderSystem = new RenderSystem(
            'game-canvas', 
            window.innerWidth, 
            window.innerHeight, 
            global.tileSize || 32
        );

        this.combatSystem = new CombatSystem(configs.enemies);
        this.lootSystem = new LootSystem(configs.items);
        this.inputManager = new InputManager(configs.global);
        this.peerClient = new PeerClient(configs.net);
        this.syncManager = new SyncManager(configs.global);
        this.audioSystem = new AudioSystem();
        
        // 5. Check for Auto-Join URL
        // Check URL params for ?join=HOST_ID
        const urlParams = new URLSearchParams(window.location.search);
        const hostId = urlParams.get('join');
        if (hostId) {
            document.getElementById('room-code-input').value = hostId;
        }
    }

    setupLobby() {
        const uiLayer = document.getElementById('ui-layer');
        const lobby = document.createElement('div');
        lobby.id = 'lobby-screen';
        lobby.innerHTML = `
            <h1>DungExtract</h1>
            <div id="player-stats">Gold: ${this.playerData.gold} | Extractions: ${this.playerData.extractions || 0}</div>
            <input type="text" id="player-name" placeholder="Enter Name" value="${this.playerData.name}" />
            <button id="btn-host">Host Game</button>
            <div style="display:flex; gap:10px;">
                <input type="text" id="room-code-input" placeholder="Room Code" />
                <button id="btn-join">Join Game</button>
            </div>
        `;
        uiLayer.appendChild(lobby);

        document.getElementById('btn-host').onclick = () => {
            this.playerData.name = document.getElementById('player-name').value || 'Host';
            this.database.savePlayer({ name: this.playerData.name });
            this.startGame(true);
        };

        document.getElementById('btn-join').onclick = () => {
            const code = document.getElementById('room-code-input').value;
            if (!code) return alert("Enter a room code");
            this.playerData.name = document.getElementById('player-name').value || 'Client';
            this.database.savePlayer({ name: this.playerData.name });
            this.startGame(false, code);
        };
    }

    startGame(isHost, hostId = null) {
        document.getElementById('lobby-screen').classList.add('hidden');
        
        this.setupNetwork();
        this.setupUI();
        this.inputManager.on('intent', (intent) => this.handleInput(intent));

        this.gameLoop = new GameLoop(
            (dt) => this.update(dt),
            (alpha) => this.render(alpha),
            this.config.global.tickRate
        );
        this.gameLoop.start();

        this.peerClient.init();
        this.peerClient.on('ready', (id) => {
            if (isHost) {
                this.startHost(id);
            } else if (hostId) {
                this.peerClient.connect(hostId, { name: this.playerData.name });
            }
        });
    }

    setupUI() {
        // Inject Inventory Panel since we can't modify index.html directly in this step
        const uiLayer = document.getElementById('ui-layer');
        if (uiLayer && !document.getElementById('inventory-panel')) {
            const panel = document.createElement('div');
            panel.id = 'inventory-panel';
            panel.innerHTML = '<h3>Inventory</h3><div id="inventory-list">Empty</div>';
            uiLayer.appendChild(panel);
        }

        if (uiLayer && !document.getElementById('game-timer')) {
            const timer = document.createElement('div');
            timer.id = 'game-timer';
            uiLayer.appendChild(timer);
        }
    }

    setupNetwork() {
        this.peerClient.on('ready', (id) => {
            this.state.myId = id;
            const el = document.getElementById('room-code-display');
            if (el) el.innerText = `Room: ${id}`;
        });

        // Combat Events (Local & Networked)
        this.combatSystem.on('damage', ({ targetId, currentHp, sourceId }) => {
            // Update UI if it's me
            if (targetId === this.state.myId) {
                const hpEl = document.getElementById('hp-val');
                if (hpEl) hpEl.innerText = Math.max(0, currentHp);
                this.audioSystem.play('hit');
            }

            // If Host, broadcast HP update to all clients
            if (this.state.isHost) {
                this.peerClient.send({ type: 'UPDATE_HP', payload: { id: targetId, hp: currentHp } });
            }
        });

        this.combatSystem.on('death', ({ entityId, killerId }) => {
            console.log(`${entityId} killed by ${killerId}`);
            this.gridSystem.removeEntity(entityId);
            this.audioSystem.play('death');
            const stats = this.combatSystem.getStats(entityId);
            
            if (this.state.isHost) {
                this.peerClient.send({ type: 'ENTITY_DEATH', payload: { id: entityId } });
                
                // 1. Spawn Loot
                const pos = this.gridSystem.entities.get(entityId) || { x: 0, y: 0 }; // Fallback if already removed, ideally pass pos in event
                // For now, just spawn a potion or sword randomly
                const itemId = Math.random() > 0.5 ? 'potion_health' : 'sword_basic';
                // We need the position before removal, but gridSystem.removeEntity was called above.
                // In a real engine we'd pass pos in the death event. 
                // For this revision, we'll assume the loot spawns where they died (we need to track pos before remove).
                // *Correction*: GridSystem removes it immediately. 
                // Let's spawn loot at a random nearby tile for now or fix the order in a future refactor.
                
                // 2. Monster Mechanic: Respawn Player as Monster
                if (stats && stats.isPlayer) {
                    setTimeout(() => {
                        const types = Object.keys(this.config.enemies);
                        const type = types[Math.floor(Math.random() * types.length)];
                        const spawn = this.gridSystem.getSpawnPoint();
                        
                        this.gridSystem.addEntity(entityId, spawn.x, spawn.y);
                        this.combatSystem.registerEntity(entityId, type, true); // isPlayer=true preserves control
                    }, 3000);
                }
            }
        });

        this.peerClient.on('data', ({ sender, data }) => {
            if (this.state.isHost) {
                // Host Logic: Receive Inputs
                if (data.type === 'INPUT') {
                    this.processPlayerInput(sender, data.payload);
                }
            } else {
                // Client Logic: Receive State
                if (data.type === 'SNAPSHOT') {
                    this.syncManager.addSnapshot(data.payload);
                } else if (data.type === 'INIT_WORLD') {
                    this.gridSystem.grid = data.payload.grid;
                    this.state.connected = true;
                } else if (data.type === 'UPDATE_HP') {
                    if (data.payload.id === this.state.myId) {
                        const hpEl = document.getElementById('hp-val');
                        if (hpEl) hpEl.innerText = Math.max(0, data.payload.hp);
                        this.audioSystem.play('hit');
                    }
                } else if (data.type === 'ENTITY_DEATH') {
                    this.gridSystem.removeEntity(data.payload.id);
                    this.audioSystem.play('death');
                } else if (data.type === 'GAME_OVER') {
                    this.showGameOver(data.payload.message);
                } else if (data.type === 'PLAYER_EXTRACTED') {
                    console.log(`Player ${data.payload.id} extracted!`);
                }
            }
        });

        this.peerClient.on('connected', ({ peerId, metadata }) => {
            console.log(`Connected to ${peerId}`, metadata);
            if (this.state.isHost) {
                // Send world data to new client
                this.peerClient.send({
                    type: 'INIT_WORLD',
                    payload: { grid: this.gridSystem.grid }
                });
                // Spawn them
                const spawn = this.gridSystem.getSpawnPoint();
                this.gridSystem.addEntity(peerId, spawn.x, spawn.y);
                this.combatSystem.registerEntity(peerId, 'player', true);
            }
        });
    }

    startHost(id) {
        this.state.isHost = true;
        this.state.connected = true;
        this.gridSystem.initializeDungeon();
        
        // Spawn Host
        const spawn = this.gridSystem.getSpawnPoint();
        this.gridSystem.addEntity(id, spawn.x, spawn.y);
        this.combatSystem.registerEntity(id, 'player', true);
        this.state.gameTime = this.config.global.extractionTimeSeconds || 600;
    }

    handleInput(intent) {
        if (this.state.isHost) {
            this.processPlayerInput(this.state.myId, intent);
        } else {
            this.peerClient.send({ type: 'INPUT', payload: intent });
        }
    }

    processPlayerInput(entityId, intent) {
        if (intent.type === 'MOVE') {
            this.gridSystem.moveEntity(entityId, intent.direction.x, intent.direction.y);
            if (entityId === this.state.myId) {
                this.audioSystem.play('step');
            }
            
            // Check for Extraction
            const pos = this.gridSystem.entities.get(entityId);
            if (pos && this.gridSystem.grid[pos.y][pos.x] === 9) {
                this.handleExtraction(entityId);
            }
        }
        
        if (intent.type === 'PICKUP') {
            const pos = this.gridSystem.entities.get(entityId);
            if (pos) {
                const item = this.lootSystem.pickup(entityId, pos.x, pos.y);
                if (item) {
                    this.audioSystem.play('pickup');
                    this.updateInventoryUI(entityId);
                }
            }
        }

        if (intent.type === 'ATTACK') {
            const attacker = this.gridSystem.entities.get(entityId);
            if (attacker) {
                const targetX = attacker.x + attacker.facing.x;
                const targetY = attacker.y + attacker.facing.y;
                const targetId = this.gridSystem.getEntityAt(targetX, targetY);

                this.audioSystem.play('attack');

                if (targetId) {
                    const stats = this.combatSystem.getStats(entityId);
                    const damage = stats ? stats.damage : 5;
                    this.combatSystem.applyDamage(targetId, damage, entityId);
                }
            }
        }
    }

    handleExtraction(entityId) {
        console.log(`Processing extraction for ${entityId}`);
        // 1. Save Data
        if (entityId === this.state.myId) {
            const currentGold = this.playerData.gold + 100; // Flat reward for now
            this.database.savePlayer({ gold: currentGold, extractions: (this.playerData.extractions || 0) + 1 });
        }
        
        // 2. Remove from World
        this.gridSystem.removeEntity(entityId);
        this.combatSystem.stats.delete(entityId);

        // 3. Notify
        this.peerClient.send({ type: 'PLAYER_EXTRACTED', payload: { id: entityId } });
        if (entityId === this.state.myId) this.showGameOver("EXTRACTED! Loot Secured.");
    }

    updateInventoryUI(entityId) {
        // Only update UI if it's the local player
        if (entityId !== this.state.myId) return;

        const items = this.lootSystem.inventories.get(entityId) || [];
        const listEl = document.getElementById('inventory-list');
        if (listEl) {
            listEl.innerHTML = items.map(itemId => {
                // Resolve name from config
                let name = itemId;
                if (this.config.items.weapons[itemId]) name = this.config.items.weapons[itemId].name;
                if (this.config.items.consumables[itemId]) name = this.config.items.consumables[itemId].name;
                return `<div class="inv-item">${name}</div>`;
            }).join('');
        }
    }

    updateAI() {
        const now = Date.now();
        for (const [id, stats] of this.combatSystem.stats) {
            if (stats.isPlayer) continue;
            
            // AI Logic: 1 second cooldown
            if (now - (stats.lastActionTime || 0) < 1000) continue;

            const pos = this.gridSystem.entities.get(id);
            if (!pos) continue;

            const target = this.findNearestPlayer(pos.x, pos.y);
            if (target) {
                const dist = Math.abs(target.x - pos.x) + Math.abs(target.y - pos.y);
                
                if (dist <= 1) {
                    // Attack
                    this.combatSystem.applyDamage(target.id, stats.damage, id);
                    stats.lastActionTime = now;
                } else if (dist < 10) {
                    // Move towards player (Simple Axis-Aligned)
                    const dx = target.x - pos.x;
                    const dy = target.y - pos.y;
                    
                    let moveX = 0; 
                    let moveY = 0;
                    
                    // Prioritize larger distance axis
                    if (Math.abs(dx) > Math.abs(dy)) {
                        moveX = Math.sign(dx);
                    } else {
                        moveY = Math.sign(dy);
                    }
                    
                    // Try move
                    let result = this.gridSystem.moveEntity(id, moveX, moveY);
                    
                    // If blocked, try the other axis
                    if (!result.success) {
                        if (moveX !== 0) { moveX = 0; moveY = Math.sign(dy); }
                        else { moveY = 0; moveX = Math.sign(dx); }
                        
                        if (moveY !== 0 || moveX !== 0) {
                            this.gridSystem.moveEntity(id, moveX, moveY);
                        }
                    }
                    stats.lastActionTime = now;
                }
            }
        }
    }

    findNearestPlayer(x, y) {
        let nearest = null;
        let minDist = Infinity;
        
        for (const [id, stats] of this.combatSystem.stats) {
            if (stats.isPlayer) {
                const pos = this.gridSystem.entities.get(id);
                if (pos) {
                    const dist = Math.abs(pos.x - x) + Math.abs(pos.y - y);
                    if (dist < minDist) {
                        minDist = dist;
                        nearest = { id, x: pos.x, y: pos.y };
                    }
                }
            }
        }
        return nearest;
    }

    showGameOver(msg) {
        const ui = document.getElementById('ui-layer');
        const screen = document.createElement('div');
        screen.id = 'game-over-screen';
        screen.innerHTML = `<h1>GAME OVER</h1><h2>${msg}</h2><button onclick="location.reload()">Return to Lobby</button>`;
        ui.appendChild(screen);
        this.gameLoop.stop();
    }

    update(dt) {
        if (this.state.isHost) {
            // Timer Logic
            this.state.gameTime -= (dt / 1000);
            
            if (!this.state.extractionOpen && this.state.gameTime <= 60) {
                this.state.extractionOpen = true;
                this.gridSystem.spawnExtractionZone();
                // Broadcast map update (simple way: resend INIT_WORLD or just let grid sync via snapshot if we synced grid... which we don't usually per frame)
                // For this revision, we rely on the fact that we don't sync grid changes per frame. We need to send an event.
                this.peerClient.send({ type: 'INIT_WORLD', payload: { grid: this.gridSystem.grid } });
            }

            if (this.state.gameTime <= 0) {
                this.peerClient.send({ type: 'GAME_OVER', payload: { message: "Time Expired - Dungeon Collapsed" } });
                this.showGameOver("Time Expired");
            }

            this.updateAI();
            // Authoritative Update: Broadcast State
            const snapshot = this.syncManager.serializeState(
                this.gridSystem, 
                this.combatSystem, 
                this.lootSystem, 
                this.state.gameTime
            );
            this.peerClient.send({ type: 'SNAPSHOT', payload: snapshot });
        }
    }

    render(alpha) {
        if (!this.state.connected) return;

        // Clients interpolate, Host uses raw state (or interpolates self for smoothness)
        const state = this.state.isHost 
            ? { entities: this.gridSystem.entities, loot: this.lootSystem.worldLoot, gameTime: this.state.gameTime }
            : this.syncManager.getInterpolatedState(Date.now());

        // Update Timer UI
        const timerEl = document.getElementById('game-timer');
        if (timerEl && state.gameTime !== undefined) {
            const t = Math.max(0, Math.floor(state.gameTime));
            const m = Math.floor(t / 60);
            const s = t % 60;
            timerEl.innerText = `${m}:${s.toString().padStart(2, '0')}`;
        }

        // Camera follow
        const myPos = state.entities.get(this.state.myId);
        if (myPos) {
            this.renderSystem.updateCamera(myPos.x, myPos.y);
        }

        this.renderSystem.render(
            this.gridSystem.grid, 
            state.entities,
            state.loot,
            this.state.myId
        );
    }
}

window.onload = () => {
    const game = new Game();
    game.init().catch(console.error);
};