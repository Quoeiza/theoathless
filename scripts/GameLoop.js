import AssetSystem from './AssetSystem.js';
import InputManager from './InputManager.js';
import Ticker from './Ticker.js';
import GridSystem from './GridSystem.js';
import RenderSystem from './RenderSystem.js';
import CombatSystem from './CombatSystem.js';
import LootSystem from './LootSystem.js';
import PeerClient from './PeerClient.js';
import SyncManager from './SyncManager.js';
import AudioSystem from './AudioSystem.js';
import Database from './Database.js';
import UISystem from './UISystem.js';
import AISystem from './AISystem.js';

const NetworkEvents = {
    // Client to Host
    DISCOVERY_REQUEST: 'DISCOVERY_REQUEST',
    INPUT: 'INPUT',
    INTERACT_LOOT: 'INTERACT_LOOT',
    EQUIP_ITEM: 'EQUIP_ITEM',
    UNEQUIP_ITEM: 'UNEQUIP_ITEM',
    DROP_ITEM: 'DROP_ITEM',
    CLIENT_EFFECT: 'CLIENT_EFFECT',

    // Host to Client
    DISCOVERY_RESPONSE: 'DISCOVERY_RESPONSE',
    SNAPSHOT: 'SNAPSHOT',
    INIT_WORLD: 'INIT_WORLD',
    UPDATE_HP: 'UPDATE_HP',
    ENTITY_DEATH: 'ENTITY_DEATH',
    HUMANS_ESCAPED: 'HUMANS_ESCAPED',
    PLAYER_ESCAPED: 'PLAYER_ESCAPED',
    PORTAL_SPAWN: 'PORTAL_SPAWN',
    RESPAWN_MONSTER: 'RESPAWN_MONSTER',
    EFFECT: 'EFFECT',
    FLOAT_TEXT: 'FLOAT_TEXT',
    SPAWN_PROJECTILE: 'SPAWN_PROJECTILE',
    UPDATE_GOLD: 'UPDATE_GOLD',
    LOOT_SUCCESS: 'LOOT_SUCCESS',
    UPDATE_INVENTORY: 'UPDATE_INVENTORY',
    LOOT_OPENED: 'LOOT_OPENED',
};

export default class GameLoop {
    constructor() {
        this.assetSystem = new AssetSystem();
        this.state = {
            myId: null,
            isHost: false,
            connected: false,
            gameTime: 0,
            escapeOpen: false,
            actionBuffer: null,
            nextInputTick: 0,
            projectiles: [],
            interaction: null,
            netTimer: 0,
            handshakeInterval: null,
            isEscaping: false,
            autoPath: [],
            chaseTargetId: null,
            gameOver: false,

            // Client-side prediction & reconciliation
            inputBuffer: [],
            lastProcessedInputTick: 0,
            lastReconciledTime: 0
        };
        this.database = new Database();
        this.playerData = { name: 'Player', gold: 0, class: 'Fighter' };
        
        // Load Settings
        const savedSettings = localStorage.getItem('theoathless_settings');
        this.settings = savedSettings ? JSON.parse(savedSettings) : {
            masterVolume: 0.4,
            musicVolume: 0.5,
            sfxVolume: 0.5,
            shadows: true,
            particles: true,
            dynamicLights: true
        };
        
        // Debug Stats
        this.debugStats = {
            bytesIn: 0,
            bytesOut: 0,
            packetsIn: 0,
            packetsOut: 0,
            lastSnapshotSize: 0,
            lastSnapshotEntities: 0,
            lastUpdate: Date.now()
        };

        // Delegate loop handling to core utility
        this.ticker = new Ticker(
            (dt) => this.update(dt), 
            (alpha) => this.render(alpha),
            20 // Tick rate (will be overwritten by config)
        );
    }

    async init() {
        this.createDebugUI();
        await this._loadAssetsAndConfig();
        await this._loadPlayerData();
        await this._initializeSystems();
        this._setupLobby();
    }

    /**
     * Loads all game configuration files and dynamic assets.
     * @private
     */
    async _loadAssetsAndConfig() {
        this.config = await this.assetSystem.loadAll();

        if (this.config.global && this.config.global.tickRate) {
            this.ticker.tickRate = this.config.global.tickRate;
            this.ticker.timePerTick = 1000 / this.config.global.tickRate;
        }

        const actorImages = {
            'eliteknight.png': './assets/images/actors/eliteknight.png'
        };
        if (this.config.enemies) {
            for (const key in this.config.enemies) {
                const enemy = this.config.enemies[key];
                if (enemy.sprite) {
                    actorImages[enemy.sprite] = `./assets/images/actors/${enemy.sprite}`;
                }
            }
        }
        await this.assetSystem.loadImages(actorImages);
    }

    /**
     * Loads player data from the local database.
     * @private
     */
    async _loadPlayerData() {
        this.playerData = (await this.database.getPlayer()) || { name: 'Player', gold: 0, escapes: 0 };
    }

    /**
     * Initializes all game systems.
     * @private
     */
    async _initializeSystems() {
        const global = this.config.global || {};
        this.gridSystem = new GridSystem(
            global.dungeonWidth || 48, 
            global.dungeonHeight || 48, 
            global.tileSize || 48
        );
        
        this.renderSystem = new RenderSystem(
            'game-canvas', 
            window.innerWidth, 
            window.innerHeight, 
            global.tileSize || 48
        );
        await this.renderSystem.setAssetLoader(this.assetSystem);
        this.renderSystem.setGridSystem(this.gridSystem);

        this.combatSystem = new CombatSystem(this.config.enemies);
        this.renderSystem.setCombatSystem(this.combatSystem);
        this.lootSystem = new LootSystem(this.config.items);
        this.combatSystem.setLootSystem(this.lootSystem);
        this.inputManager = new InputManager(this.config.global);
        this.peerClient = new PeerClient(this.config.net);
        
        // DEBUG: Monitor Outgoing Traffic
        const origSend = this.peerClient.send.bind(this.peerClient);
        this.peerClient.send = (data) => {
            this.monitorNetwork(data, false);
            origSend(data);
        };
        const origSendTo = this.peerClient.sendTo.bind(this.peerClient);
        this.peerClient.sendTo = (id, data) => {
            this.monitorNetwork(data, false);
            origSendTo(id, data);
        };

        this.syncManager = new SyncManager(this.config.global);
        this.audioSystem = new AudioSystem();
        await this.audioSystem.setAssetLoader(this.assetSystem);
        this.uiSystem = new UISystem(this);
        this.aiSystem = new AISystem(this.gridSystem, this.combatSystem, this.lootSystem);
        
        // Apply initial settings
        this.renderSystem.applySettings(this.settings);
        this.audioSystem.updateSettings(this.settings);
    }

    /**
     * Sets up the initial lobby screen, audio, and auto-join functionality.
     * @private
     */
    _setupLobby() {
        this.uiSystem.setupLobby();
        this.uiSystem.setupLobbySettings();

        this.audioSystem.playMusic('theme');
        this.audioSystem.resume();
        
        const unlockAudio = () => {
            this.audioSystem.unlock();
            document.removeEventListener('click', unlockAudio);
            document.removeEventListener('keydown', unlockAudio);
            document.removeEventListener('touchstart', unlockAudio);
        };
        document.addEventListener('click', unlockAudio);
        document.addEventListener('keydown', unlockAudio);
        document.addEventListener('touchstart', unlockAudio);
        
        const urlParams = new URLSearchParams(window.location.search);
        const hostId = urlParams.get('join');
        if (hostId) {
            document.getElementById('room-code-input').value = hostId;
        }
    }

    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        localStorage.setItem('theoathless_settings', JSON.stringify(this.settings));
        this.renderSystem.applySettings(this.settings);
        this.audioSystem.updateSettings(this.settings);
    }

    _initializeGameStart() {
        document.getElementById('lobby-screen').classList.add('hidden');
        this.audioSystem.playMusic('dungeon');
        
        this.setupNetwork();
        this.uiSystem.setupUI();
        this.inputManager.on('intent', (intent) => this.handleInput(intent));
        this.inputManager.on('click', (data) => this.handleMouseClick(data));
        this.inputManager.on('mousemove', (data) => this.handleMouseMove(data));
        this.audioSystem.resume();

        this.ticker.start();

        this.peerClient.on('error', (err) => {
            this.uiSystem.showNotification(`Connection Error: ${err.type}`);
            // Reload on fatal errors or connection failures
            if (['network', 'browser-incompatible', 'peer-unavailable', 'socket-error', 'socket-closed'].includes(err.type)) {
                setTimeout(() => location.reload(), 2000);
            }
        });
    }

    startQuickJoin() {
        this._initializeGameStart();

        this.peerClient.init();
        this.peerClient.on('ready', async (id) => {
            this.uiSystem.showNotification("Scanning for sessions...");
            try {
                const sessions = await this.peerClient.scanForSessions();
                // Sort by highest game time remaining (gameTime is sent in payload)
                const valid = sessions.sort((a, b) => b.gameTime - a.gameTime);
                
                if (valid.length > 0) {
                    const best = valid[0];
                    const parts = best.id.split('-');
                    const displayId = parts.length >= 2 ? parts[1] : best.id;
                    this.uiSystem.showNotification(`Joining Room ${displayId}...`);
                    document.getElementById('room-code-display').innerText = `Room: ${displayId}`;
                    this.peerClient.connect(best.id, { name: this.playerData.name, class: this.playerData.class, gold: this.playerData.gold });
                } else {
                    this.uiSystem.showNotification("No suitable sessions found.");
                    setTimeout(() => location.reload(), 2000);
                }
            } catch (e) {
                console.error("Quick Join Error:", e);
                this.uiSystem.showNotification("Quick Join Failed.");
                setTimeout(() => location.reload(), 2000);
            }
        });
    }

    respawnAsMonster(entityId) {
        const { type } = this.combatSystem.respawnPlayerAsMonster(entityId, this.gridSystem);
        
        if (this.state.isHost) {
             this.peerClient.send({ type: NetworkEvents.RESPAWN_MONSTER, payload: { id: entityId, type } });
        }
    }

    startGame(isHost, hostId = null) {
        this._initializeGameStart();

        if (isHost) {
            this.peerClient.initHost();
        } else {
            this.peerClient.init(); // Client initializes with random ID
        }

        this.peerClient.on('ready', (id) => {
            if (isHost) {
                const parts = id.split('-');
                const displayId = parts.length >= 2 ? parts[1] : id;
                this.startHost(id);
                document.getElementById('room-code-display').innerText = `Room: ${displayId}`;
            } else if (hostId) {
                document.getElementById('room-code-display').innerText = `Room: ${hostId}`;
                this.peerClient.connect(`theoathless-${hostId}`, { name: this.playerData.name, class: this.playerData.class, gold: this.playerData.gold });
            }
        });
    }

    handleDropItem(itemId, source) {
        if (!this.state.isHost) {
            this.peerClient.send({ type: NetworkEvents.DROP_ITEM, payload: { itemId, source } });
            return;
        }

        if (this.state.isHost) {
            this.lootSystem.performDrop(this.state.myId, itemId, source, this.gridSystem);
        }

        this.uiSystem.renderInventory();
        this.audioSystem.play('pickup');
        if (this.state.isHost) this.sendInventoryUpdate(this.state.myId);
    }

    handleEquipItem(itemId, slot) {
        if (!this.state.isHost) {
            this.peerClient.send({ type: NetworkEvents.EQUIP_ITEM, payload: { itemId, slot } });
            return;
        }
        const success = this.lootSystem.equipItem(this.state.myId, itemId, slot);
        if (success) {
            this.uiSystem.renderInventory();
            this.audioSystem.play('pickup');
        }
    }

    handleUnequipItem(slot) {
        if (!this.state.isHost) {
            this.peerClient.send({ type: NetworkEvents.UNEQUIP_ITEM, payload: { slot } });
            return;
        }
        const success = this.lootSystem.unequipItem(this.state.myId, slot);
        if (success) {
            this.uiSystem.renderInventory();
            this.audioSystem.play('pickup');
        }
    }

    handleInteractWithLoot(loot) {
        if (this.state.isHost) {
            this.processLootInteraction(this.state.myId, loot);
        } else {
            this.peerClient.send({ type: NetworkEvents.INTERACT_LOOT, payload: { lootId: loot.id } });
        }
    }

    processLootInteraction(entityId, loot) {
        const result = this.lootSystem.resolveInteraction(entityId, loot.id);

        if (result) {
            if (result.gold > 0) {
                if (entityId === this.state.myId) {
                    this.playerData.gold += result.gold;
                    this.uiSystem.updateGoldUI();
                    this.uiSystem.renderInventory();
                    if (this.state.isHost) {
                        const stats = this.combatSystem.getStats(entityId);
                        if (stats) stats.gold = (stats.gold || 0) + result.gold;
                    }
                } else if (this.state.isHost) {
                    this.peerClient.send({ type: NetworkEvents.UPDATE_GOLD, payload: { id: entityId, amount: result.gold } });
                }
            }

            if (entityId === this.state.myId) {
                this.audioSystem.play('pickup');
                this.uiSystem.updateQuickSlotUI();
                const goldText = result.gold > 0 ? ` + ${result.gold}g` : '';
                const itemName = this.lootSystem.getName(result.itemId);
                this.uiSystem.showNotification(`${itemName}${goldText}`);
                this.renderSystem.addFloatingText(this.gridSystem.entities.get(entityId).x, this.gridSystem.entities.get(entityId).y, `+${itemName}`, '#FFD700');
            } else {
                this.peerClient.send({ type: NetworkEvents.LOOT_SUCCESS, payload: { id: entityId } });
                this.peerClient.send({ type: NetworkEvents.LOOT_OPENED, payload: { lootId: loot.id } });
                if (this.state.isHost) this.sendInventoryUpdate(entityId);
            }
        }
    }

    setupNetwork() {
        this.peerClient.on('ready', (id) => {
            this.state.myId = id;
        });

        this.peerClient.on('disconnected', (peerId) => {
            if (this.state.isHost) {
                console.log(`Player ${peerId} disconnected.`);
                this.gridSystem.removeEntity(peerId);
                this.combatSystem.stats.delete(peerId);
                this.checkHumansEscaped();
            } else {
                this.uiSystem.showNotification("Host disconnected. Returning to lobby.");
                setTimeout(() => location.reload(), 2000);
            }
        });

        this.combatSystem.on('damage', ({ targetId, amount, currentHp, sourceId, options }) => {
            if (targetId === this.state.myId) {
                const hpEl = document.getElementById('hp-val');
                if (hpEl) hpEl.innerText = Math.max(0, currentHp); // UI Feedback (Local)

                this.renderSystem.triggerShake(5, 200);
                this.audioSystem.play('hit', this.gridSystem.entities.get(targetId).x, this.gridSystem.entities.get(targetId).y);
            }

            if (this.state.isHost && sourceId && amount > 0) {
                const sourceStats = this.combatSystem.getStats(sourceId);
                const targetStats = this.combatSystem.getStats(targetId);
                if (sourceStats && sourceStats.isPlayer && sourceStats.team === 'monster' && targetStats && targetStats.team === 'player') {
                    const goldReward = Math.floor(amount / 10);
                    if (goldReward > 0) {
                        sourceStats.gold = (sourceStats.gold || 0) + goldReward;
                        if (sourceId === this.state.myId) {
                            this.playerData.gold = (this.playerData.gold || 0) + goldReward;
                            this.database.updatePlayer({ gold: this.playerData.gold });
                            this.uiSystem.updateGoldUI();
                            this.uiSystem.showNotification(`+${goldReward}g (Damage)`);
                        } else {
                            this.peerClient.send({ type: NetworkEvents.UPDATE_GOLD, payload: { id: sourceId, amount: goldReward } });
                        }
                    }
                }
            }

            // Locally trigger effects for the host/local player
            this.renderSystem.addFloatingText(this.gridSystem.entities.get(targetId), amount, options);
            this.renderSystem.triggerDamage(targetId, sourceId);

            if (this.state.isHost) {
                // Send a single, rich event to clients
                this.peerClient.send({ 
                    type: NetworkEvents.UPDATE_HP, 
                    payload: { 
                        id: targetId, 
                        hp: currentHp,
                        sourceId: sourceId,
                        amount: amount,
                        options: options
                    } 
                });
            }
        });

        this.combatSystem.on('death', ({ entityId, killerId, stats }) => {
            const deathPos = this.gridSystem.entities.get(entityId);
            const deathX = deathPos ? deathPos.x : 0;
            const deathY = deathPos ? deathPos.y : 0;

            this.gridSystem.removeEntity(entityId);
            this.renderSystem.triggerDeath(entityId);
            this.audioSystem.play('death', deathX, deathY);
            
            if (this.state.isHost) {
                if (!stats.isPlayer && stats.team === 'monster' && killerId) {
                    const reward = Math.floor(Math.random() * 4) + 2;
                    if (killerId === this.state.myId) {
                        this.database.addRewards(reward).then(data => this.playerData = data);
                        this.uiSystem.updateGoldUI();
                        this.uiSystem.showNotification(`+${reward}g`);
                    } else {
                        this.peerClient.send({ type: NetworkEvents.UPDATE_GOLD, payload: { id: killerId, amount: reward } });
                    }
                }

                this.peerClient.send({ type: NetworkEvents.ENTITY_DEATH, payload: { id: entityId } });
                
                let dropX = deathX;
                let dropY = deathY;
                
                if (!deathPos && killerId) {
                    const kPos = this.gridSystem.entities.get(killerId);
                    if (kPos) { dropX = kPos.x; dropY = kPos.y; }
                }

                let goldToDrop = 0;
                if (stats && stats.isPlayer) {
                    goldToDrop = stats.gold || 0;
                    stats.gold = 0;
                    if (entityId === this.state.myId) {
                        goldToDrop = this.playerData.gold;
                        this.playerData.gold = 0;
                        this.database.updatePlayer({ gold: 0 });
                        this.uiSystem.updateGoldUI();
                    }
                }

                const items = this.lootSystem.getAllItems(entityId);
                this.lootSystem.createLootBag(dropX, dropY, items, goldToDrop);
                
                if (stats && stats.isPlayer) {
                    setTimeout(() => {
                        if (!this.state.gameOver) {
                            this.respawnAsMonster(entityId);
                        }
                    }, 3000);
                } else {
                    setTimeout(() => {
                        const newId = `ai_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                        const spawn = this.gridSystem.getSpawnPoint();
                        this.gridSystem.addEntity(newId, spawn.x, spawn.y);
                        const type = (stats && stats.type) ? stats.type : 'slime';
                        this.combatSystem.registerEntity(newId, type, false);
                    }, 100);
                }

                this.checkHumansEscaped();
            }
        });

        this.peerClient.on('data', ({ sender, data }) => {
            if (this.state.isHost) {
                if (data.type === NetworkEvents.DISCOVERY_REQUEST) {
                    this.peerClient.sendTo(sender, {
                        type: NetworkEvents.DISCOVERY_RESPONSE,
                        payload: { gameTime: this.state.gameTime, playerCount: this.combatSystem.getHumanCount() }
                    });
                    return;
                }
                if (data.type === NetworkEvents.INPUT) {
                    this.processPlayerInput(sender, data.payload);
                }
                if (data.type === NetworkEvents.INTERACT_LOOT) {
                    const loot = this.lootSystem.worldLoot.get(data.payload.lootId);
                    if (loot) this.processLootInteraction(sender, loot);
                }
                if (data.type === NetworkEvents.EQUIP_ITEM) {
                    this.handleEquipItem(data.payload.itemId, data.payload.slot);
                    this.sendInventoryUpdate(sender);
                }
                if (data.type === NetworkEvents.UNEQUIP_ITEM) {
                    this.handleUnequipItem(data.payload.slot);
                    this.sendInventoryUpdate(sender);
                }
                if (data.type === NetworkEvents.DROP_ITEM) {
                    this.handleDropItem(data.payload.itemId, data.payload.source);
                    this.sendInventoryUpdate(sender);
                }
            } else {
                if (data.type === NetworkEvents.SNAPSHOT) {
                    this.syncManager.addSnapshot(data.payload);
                } else if (data.type === NetworkEvents.INIT_WORLD) {
                    this.gridSystem.setGrid(data.payload.grid);
                    if (data.payload.snapshot) {
                        this.syncManager.addSnapshot(data.payload.snapshot);
                        this.state.gameTime = data.payload.snapshot.gameTime;
                        // Sync loot immediately to prevent collision issues on start
                        if (data.payload.snapshot.l) {
                            this.lootSystem.syncLoot(new Map(data.payload.snapshot.l));
                        }
                    }
                    if (this.state.handshakeInterval) {
                        clearInterval(this.state.handshakeInterval);
                        this.state.handshakeInterval = null;
                    }
                    this.state.connected = true;
                } else if (data.type === NetworkEvents.UPDATE_HP) {
                    const { id, hp, sourceId, amount, options } = data.payload;

                    // Update stats model
                    const stats = this.combatSystem.getStats(id);
                    if (stats) stats.hp = hp;
                    
                    // Trigger local screen effects if the message is about us
                    if (id === this.state.myId) {
                        const hpEl = document.getElementById('hp-val');
                        if (hpEl) hpEl.innerText = Math.max(0, hp);
                        this.audioSystem.play('hit');
                        this.renderSystem.triggerShake(5, 200);
                    }

                    // Trigger world-space visual effects for the damaged entity
                    const pos = this.gridSystem.entities.get(id);
                    if (pos) {
                        const color = amount > 0 ? '#ff4444' : '#44ff44';
                        let text = Math.abs(amount).toString();
                        if (options && options.isCrit) text += "!";
                        this.renderSystem.addFloatingText(pos.x, pos.y, text, color);
                    }
                    this.renderSystem.triggerDamage(id, sourceId);
                    if (sourceId) {
                        this.renderSystem.triggerAttack(sourceId);
                    }

                } else if (data.type === NetworkEvents.ENTITY_DEATH) {
                    this.gridSystem.removeEntity(data.payload.id);
                    this.renderSystem.triggerDeath(data.payload.id);
                    this.audioSystem.play('death');
                } else if (data.type === NetworkEvents.HUMANS_ESCAPED) {
                    this.uiSystem.showHumansEscaped(data.payload.message);
                } else if (data.type === NetworkEvents.PLAYER_ESCAPED) {
                    console.log(`Player ${data.payload.id} escaped!`);
                } else if (data.type === NetworkEvents.PORTAL_SPAWN) {
                    this.gridSystem.setTile(data.payload.x, data.payload.y, 9);
                    this.uiSystem.showNotification("The Escape Portal has opened!");
                    this.audioSystem.play('pickup', data.payload.x, data.payload.y);
                } else if (data.type === NetworkEvents.RESPAWN_MONSTER) {
                    if (data.payload.id === this.state.myId) {
                        this.uiSystem.showNotification(`Respawned as ${data.payload.type}`);
                        const stats = this.combatSystem.getStats(this.state.myId);
                        if (stats) {
                            stats.type = data.payload.type;
                            stats.team = 'monster';
                        }
                    }
                } else if (data.type === NetworkEvents.CLIENT_EFFECT) {
                    const { name, x, y } = data.payload;
                    const pos = this.gridSystem.entities.get(this.state.myId);
                    
                    if (name === 'miss') {
                        this.renderSystem.triggerAttack(this.state.myId);
                        this.renderSystem.addEffect(x, y, 'slash');
                        if (pos) this.audioSystem.play('swing', pos.x, pos.y);
                    } else if (name === 'miss_slash') {
                        this.renderSystem.addEffect(x, y, 'slash');
                        if (pos) this.audioSystem.play('swing', pos.x, pos.y);
                    }
                } else if (data.type === NetworkEvents.SPAWN_PROJECTILE) {
                    this.audioSystem.play('attack', data.payload.x, data.payload.y);
                    if (data.payload.ownerId) {
                        this.renderSystem.triggerAttack(data.payload.ownerId);
                    }
                } else if (data.type === NetworkEvents.UPDATE_GOLD) {
                    if (data.payload.id === this.state.myId) {
                        this.playerData.gold = (this.playerData.gold || 0) + data.payload.amount;
                        this.database.updatePlayer({ gold: this.playerData.gold });
                        this.uiSystem.updateGoldUI();
                        this.uiSystem.showNotification(`+${data.payload.amount}g`);
                    }
                } else if (data.type === NetworkEvents.LOOT_SUCCESS) {
                    if (data.payload.id === this.state.myId) {
                        this.audioSystem.play('pickup', 0, 0);
                        this.uiSystem.renderInventory();
                        this.uiSystem.updateQuickSlotUI();
                    }
                } else if (data.type === NetworkEvents.UPDATE_INVENTORY) {
                    if (this.lootSystem.inventories) this.lootSystem.inventories.set(this.state.myId, data.payload.inventory);
                    if (this.lootSystem.equipment) this.lootSystem.equipment.set(this.state.myId, data.payload.equipment);
                    this.uiSystem.renderInventory();
                } else if (data.type === NetworkEvents.LOOT_OPENED) {
                    this.lootSystem.markOpened(data.payload.lootId);
                }
            }
        });

        this.peerClient.on('connected', ({ peerId, metadata }) => {
            const meta = metadata || {};
            if (this.state.isHost) {
                const spawn = this.gridSystem.getSpawnPoint(true);
                this.gridSystem.addEntity(peerId, spawn.x, spawn.y);
                this.combatSystem.registerEntity(peerId, 'player', true, meta.class || 'Fighter', meta.name || 'Unknown');
                const stats = this.combatSystem.getStats(peerId);
                if (stats) stats.gold = meta.gold || 0;

                // Starter Items for Client
                this.lootSystem.addItemToEntity(peerId, 'sword_basic', 1);
                this.lootSystem.addItemToEntity(peerId, 'armor_leather', 1);
                this.sendInventoryUpdate(peerId);

                // Send initial state right away
                const globalSnap = this.syncManager.prepareGlobalSnapshot(
                    this.gridSystem, this.combatSystem, 
                    this.state.projectiles, this.state.gameTime
                );
                const snapshot = this.syncManager.createClientSnapshot(
                    globalSnap, peerId, this.lootSystem // Pass lootSystem for Full Sync
                );
                this.peerClient.sendTo(peerId, {
                    type: NetworkEvents.INIT_WORLD,
                    payload: {
                        grid: this.gridSystem.grid,
                        snapshot: snapshot
                    }
                });
            } else {
                // Update room code display to ensure it shows the room we connected to
                const parts = peerId.split('-');
                const displayId = parts.length >= 2 ? parts[1] : peerId;
                document.getElementById('room-code-display').innerText = `Room: ${displayId}`;
            }
        });
    }

    startHost(id) {
        this.state.isHost = true;
        this.state.connected = true;
        this.lootSystem.clear();
        this.combatSystem.clear();
        this.gridSystem.initializeDungeon();
        this.gridSystem.populate(this.combatSystem, this.lootSystem, this.config);
        
        const spawn = this.gridSystem.getSpawnPoint(true);
        this.gridSystem.addEntity(id, spawn.x, spawn.y);
        this.combatSystem.registerEntity(id, 'player', true, this.playerData.class, this.playerData.name);
        const stats = this.combatSystem.getStats(id);
        if (stats) stats.gold = this.playerData.gold;
        
        // Starter Items for Host
        this.lootSystem.addItemToEntity(id, 'sword_basic', 1);
        this.lootSystem.addItemToEntity(id, 'armor_leather', 1);

        this.state.gameTime = this.config.global.escapeTimeSeconds || 600;
    }

    sendInventoryUpdate(targetId) {
        if (!this.state.isHost) return;
        const inventory = this.lootSystem.getInventory(targetId);
        const equipment = this.lootSystem.getEquipment(targetId);
        this.peerClient.sendTo(targetId, { 
            type: NetworkEvents.UPDATE_INVENTORY, 
            payload: { inventory, equipment } 
        });
    }

    calculateCooldownTicks(ms) {
        return Math.ceil(ms / this.ticker.timePerTick);
    }

    handleInput(intent) {
        if (intent.type === 'TOGGLE_MENU') {
            this.uiSystem.toggleSettingsMenu();
            return;
        }
        if (intent.type === 'TOGGLE_INVENTORY') {
            const modal = document.getElementById('inventory-modal');
            if (modal) {
                modal.classList.toggle('hidden');
                if (!modal.classList.contains('hidden')) this.uiSystem.renderInventory();
            }
            return;
        }

        if (this.ticker.tick >= this.state.nextInputTick) {
            this.executeAction(intent);
        } else {
            this.state.actionBuffer = intent;
        }
    }

    handleMouseClick(data) {
        if (!this.state.myId || !this.state.connected) return;
        
        this.uiSystem.hideContextMenu();

        if (data.button === 2) {
            this.uiSystem.showContextMenu(data);
            return;
        }

        if (data.button !== 0) return;

        const cam = this.renderSystem.camera;
        const ts = this.config.global.tileSize || 48;
        const scale = this.renderSystem.scale || 1;
        const gridX = Math.floor(((data.x / scale) + cam.x) / ts);
        const gridY = Math.floor(((data.y / scale) + cam.y) / ts);

        this.processClickLogic(gridX, gridY, data.shift);
    }

    processClickLogic(gridX, gridY, shift, isContinuous = false) {
        const intent = this.gridSystem.determineClickIntent(
            gridX, gridY, this.state.myId, 
            this.combatSystem, this.lootSystem, 
            isContinuous, shift
        );

        if (!intent) return;

        if (intent.type === 'CHASE') {
            this.state.autoPath = intent.path;
            this.state.chaseTargetId = intent.targetId;
        } else if (intent.type === 'ATTACK_TARGET') {
            this.state.autoPath = [];
            this.state.chaseTargetId = null;
            const projId = `proj_${Date.now()}_${this.state.myId}`;
            this.handleInput({ type: 'TARGET_ACTION', x: intent.x, y: intent.y, projId: projId });
        } else if (intent.type === 'MOVE_PATH') {
            this.state.autoPath = intent.path;
        } else if (intent.type === 'CLEAR_PATH') {
            this.state.autoPath = [];
        }
    }

    handleMouseMove(data) {
        this.uiSystem.updateTooltip(data);
    }

    executeAction(intent) {
        const cooldownMs = this.config.global.globalCooldownMs || 250;
        const cooldownTicks = this.calculateCooldownTicks(cooldownMs);
        this.state.nextInputTick = this.ticker.tick + cooldownTicks;
        this.state.actionBuffer = null;

        // Tag input with a tick for reconciliation
        const input = {
            tick: this.ticker.tick,
            intent: intent
        };

        if (this.state.isHost) {
            // Host executes immediately
            this.processPlayerInput(this.state.myId, input);
        } else {
            // Client predicts its own actions immediately for responsiveness
            this.processPlayerInput(this.state.myId, input);
            
            // Then sends to host for validation.
            this.state.inputBuffer.push(input);
            
            // Safety: Prevent buffer from growing indefinitely if connection hangs
            if (this.state.inputBuffer.length > 200) {
                this.state.inputBuffer.shift();
            }
            
            this.peerClient.send({ type: NetworkEvents.INPUT, payload: input });
        }
    }

    processPlayerInput(entityId, input, isReplay = false) {
        const { intent } = input;
        if (!intent || !intent.type) return;

        let stats = this.combatSystem.getStats(entityId);

        // On the host, mark the last input tick we've processed for this player.
        // This will be sent back in the next snapshot.
        if (this.state.isHost && stats) {
            stats.lastProcessedInputTick = input.tick;
        }

        if (!stats && entityId === this.state.myId && !this.state.isHost) {
            this.combatSystem.registerEntity(entityId, 'player', true, this.playerData.class, this.playerData.name);
            stats = this.combatSystem.getStats(entityId);
        }

        // Fix: Use input tick for replays to ensure accurate cooldown reconciliation
        const currentTick = isReplay ? input.tick : this.ticker.tick;
        
        const cooldownMs = this.combatSystem.calculateCooldown(entityId, this.config.global.globalCooldownMs || 250);
        let cooldownTicks = this.calculateCooldownTicks(cooldownMs);

        const pos = this.gridSystem.entities.get(entityId);
        
        if (intent.type === 'MOVE' && intent.shift) {
            if (pos) {
                pos.facing = intent.direction;
                
                const proj = this.combatSystem.createProjectile(entityId, pos.x, pos.y, intent.direction.x, intent.direction.y, this.lootSystem);

                if (proj) {
                    this.state.projectiles.push(proj);
                    if (!isReplay) this.peerClient.send({ type: NetworkEvents.SPAWN_PROJECTILE, payload: proj });
                    if (!isReplay) this.audioSystem.play('attack', pos.x, pos.y);
                } else {
                    const tx = pos.x + intent.direction.x;
                    const ty = pos.y + intent.direction.y;
                    const targetId = this.gridSystem.getEntityAt(tx, ty);
                    
                    if (targetId) {
                        this.performAttack(entityId, targetId, isReplay);
                    } else {
                        if (entityId === this.state.myId) {
                            if (!isReplay) {
                                this.renderSystem.triggerAttack(entityId);
                                this.renderSystem.addEffect(tx, ty, 'slash');
                            }
                        } else {
                            if (!isReplay) this.peerClient.sendTo(entityId, { type: NetworkEvents.CLIENT_EFFECT, payload: { name: 'miss', x: tx, y: ty }});
                        }
                        if (!isReplay) this.audioSystem.play('swing', pos.x, pos.y);
                    }
                }
            }
            return;
        }

        if (pos && intent.type === 'MOVE') {
            const cost = this.gridSystem.getMovementCost(pos.x + intent.direction.x, pos.y + intent.direction.y);
            cooldownTicks = Math.ceil(cooldownTicks * cost);
        }

        if (!stats) return;
        if (currentTick < stats.nextActionTick) {
            return;
        }
        stats.nextActionTick = currentTick + cooldownTicks;

        if (entityId === this.state.myId && this.state.interaction) {
            this.state.interaction = null;
        }

        if (intent.type === 'MOVE') {
            const startX = pos ? pos.x : 0;
            const startY = pos ? pos.y : 0;

            if (pos) {
                const tx = pos.x + intent.direction.x;
                const ty = pos.y + intent.direction.y;
                
                if (this.lootSystem.isCollidable(tx, ty)) {
                    pos.facing = { x: intent.direction.x, y: intent.direction.y };
                    
                    const items = this.lootSystem.getItemsAt(tx, ty);
                    const chest = items.find(l => l.type === 'chest' && !l.opened);
                    if (chest) {
                        if (entityId === this.state.myId && !this.state.isHost) {
                            if (!isReplay) this.peerClient.send({ type: NetworkEvents.INTERACT_LOOT, payload: { lootId: chest.id } });
                        } else {
                            if (!isReplay) this.processLootInteraction(entityId, chest);
                        }
                    }
                    return;
                }
            }

            const isMonster = stats && stats.team === 'monster';
            const result = this.gridSystem.resolveMoveIntent(entityId, intent.direction, this.lootSystem, isMonster);

            if (result.type === 'INTERACT_LOOT') {
                if (pos) pos.facing = result.facing;
                if (!isReplay) this.processLootInteraction(entityId, result.loot);
                return;
            } else if (result.type === 'MOVED') {
                if (!isReplay) this.renderSystem.triggerMove(entityId, { x: result.x, y: result.y });
                if (entityId === this.state.myId) {
                    if (!isReplay) this.audioSystem.play('step', pos.x, pos.y);
                    if (!isReplay) this.renderSystem.addEffect(startX, startY, 'dust');
                }
                if (this.gridSystem.grid[Math.round(result.y)][Math.round(result.x)] === 9) {
                    this.handleEscape(entityId);
                }
            } else if (result.type === 'BUMP_ENTITY') {
                if (!isReplay) this.renderSystem.triggerBump(entityId, result.direction);
                if (!this.combatSystem.isFriendly(entityId, result.targetId)) {
                    this.performAttack(entityId, result.targetId, isReplay);
                }
            } else if (result.type === 'BUMP_WALL') {
                if (!isReplay) this.renderSystem.triggerBump(entityId, result.direction);
                if (entityId === this.state.myId) {
                    if (!isReplay) this.audioSystem.play('bump', pos.x, pos.y);
                    this.state.autoPath = [];
                }
            }
        }
        
        if (intent.type === 'INTERACT') {
            if (pos) {
                const tx = pos.x + pos.facing.x;
                const ty = pos.y + pos.facing.y;
                const targetId = this.gridSystem.getEntityAt(tx, ty);
                if (targetId) {
                    this.performAttack(entityId, targetId, isReplay);
                    return;
                }

                if (stats && stats.team === 'monster') return;

                const items = this.lootSystem.getItemsAt(tx, ty);
                if (items.length > 0) {
                    if (entityId === this.state.myId) { if (!isReplay) this.handleInteractWithLoot(items[0]); }
                    else { if (!isReplay) this.processLootInteraction(entityId, items[0]); }
                    return;
                }

                if (!isReplay) {
                    this.renderSystem.triggerAttack(entityId);
                    this.renderSystem.addEffect(tx, ty, 'slash');
                }
                if (entityId !== this.state.myId) {
                     if (!isReplay) this.peerClient.sendTo(entityId, { type: NetworkEvents.CLIENT_EFFECT, payload: { name: 'miss', x: tx, y: ty }});
                }
                if (!isReplay) this.audioSystem.play('swing', pos.x, pos.y);
            }
        }

        if (intent.type === 'PICKUP') {
            const stats = this.combatSystem.getStats(entityId);
            if (stats && stats.team === 'monster') {
                return;
            }

                const target = this.lootSystem.getPickupTarget(entityId, this.gridSystem);
            if (!target) return;

            if (target.type === 'chest' && entityId === this.state.myId) {
                this.state.interaction = { type: 'chest', target: target.target, startTime: Date.now(), duration: 2000 };
                return;
            }

            if (target.type === 'items') {
                if (target.items.length > 1) {
                    if (entityId === this.state.myId && !isReplay) this.uiSystem.showGroundLoot(target.items);
                } else {
                    if (entityId === this.state.myId) { if (!isReplay) this.handleInteractWithLoot(target.items[0]); }
                    else { if (!isReplay) this.processLootInteraction(entityId, target.items[0]); }
                }
            }
        }

        if (intent.type === 'TARGET_ACTION') {
            const result = this.combatSystem.processTargetAction(entityId, intent.x, intent.y, this.gridSystem, this.lootSystem);
            
            if (result && result.type === 'PROJECTILE') {
                if (intent.projId) result.projectile.id = intent.projId;
                this.state.projectiles.push(result.projectile);
                if (!isReplay) this.peerClient.send({ type: NetworkEvents.SPAWN_PROJECTILE, payload: result.projectile });
                if (!isReplay) this.audioSystem.play('attack', pos.x, pos.y);
                if (!isReplay) this.renderSystem.triggerAttack(entityId);
            } else if (result && result.type === 'MELEE') {
                this.performAttack(entityId, result.targetId, isReplay);
            } else if (result && result.type === 'MISS') {
                if (entityId === this.state.myId) {
                    if (!isReplay) this.renderSystem.triggerAttack(entityId);
                    if (!isReplay) this.renderSystem.addEffect(result.x, result.y, 'slash');
                } else {
                    if (!isReplay) this.peerClient.sendTo(entityId, { type: NetworkEvents.CLIENT_EFFECT, payload: { name: 'miss', x: result.x, y: result.y }});
                }
                if (!isReplay) this.audioSystem.play('swing', pos.x, pos.y);
            }
        }

        if (intent.type === 'ATTACK') {
            const result = this.combatSystem.processAttackIntent(entityId, this.gridSystem);
            if (result && result.type === 'MELEE') {
                const attackerStats = this.combatSystem.getStats(entityId);
                const targetStats = this.combatSystem.getStats(result.targetId);
                if (attackerStats && targetStats && attackerStats.team === 'monster' && targetStats.team === 'monster') {
                    return;
                }
                this.performAttack(entityId, result.targetId, isReplay);
            } else if (result && result.type === 'MISS') {
                if (entityId === this.state.myId) {
                    if (!isReplay) this.renderSystem.addEffect(result.x, result.y, 'slash');
                } else {
                    if (!isReplay) this.peerClient.sendTo(entityId, { type: NetworkEvents.CLIENT_EFFECT, payload: { name: 'miss_slash', x: result.x, y: result.y }});
                }
                if (!isReplay) this.audioSystem.play('swing', pos.x, pos.y);
            }
        }

        if (intent.type === 'USE_ABILITY_SLOT') {
            const quickSlot = `quick${intent.slot + 1}`;
            const itemConfig = this.lootSystem.consumeItem(entityId, quickSlot);
            
            const result = this.combatSystem.applyConsumableEffect(entityId, itemConfig);
            if (result) {
                if (!isReplay) this.audioSystem.play('pickup', this.gridSystem.entities.get(entityId).x, this.gridSystem.entities.get(entityId).y);
                this.uiSystem.renderInventory();
                this.uiSystem.updateQuickSlotUI();
            }
        }

        if (intent.type === 'ABILITY') {
            const result = this.combatSystem.useAbility(entityId, currentTick, this.ticker.timePerTick);
            if (result) {
                if (result.effect === 'stealth') {
                    const pos = this.gridSystem.entities.get(entityId);
                    if (pos) pos.invisible = true;
                    setTimeout(() => { if(pos) pos.invisible = false; }, result.duration);
                }
                if (result.effect === 'heal') {
                    this.combatSystem.emit('damage', { targetId: entityId, amount: -result.value, sourceId: entityId, currentHp: this.combatSystem.getStats(entityId).hp });
                }
            }
        }

        if (intent.type === 'AUTO_EXPLORE') {
            if (entityId !== this.state.myId) return;
            const start = this.gridSystem.entities.get(entityId);
            if (!start) return;

            const target = this.gridSystem.findNearestUnexplored(start.x, start.y, this.renderSystem.explored);
            if (target) {
                const path = this.gridSystem.findPath(start.x, start.y, target.x, target.y);
                if (path) this.state.autoPath = path;
            }
        }
    }

    performAttack(attackerId, targetId, isReplay = false) {
        const result = this.combatSystem.resolveAttack(attackerId, targetId, this.gridSystem, this.lootSystem);
        if (!result) return;

        if (result.type === 'RANGED') {
            const proj = { 
                id: `proj_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                ...result.projectile 
            };
            this.state.projectiles.push(proj);
            if (!isReplay) this.peerClient.send({ type: NetworkEvents.SPAWN_PROJECTILE, payload: proj });
            if (!isReplay) this.audioSystem.play('attack', result.projectile.x, result.projectile.y);
            return;
        }

        if (result.type === 'MELEE') {
            if (!isReplay) this.renderSystem.triggerAttack(attackerId);
            if (!isReplay) this.renderSystem.addEffect(result.targetPos.x, result.targetPos.y, 'slash');
            
            if (!isReplay) this.audioSystem.play('attack', attackerId === this.state.myId ? result.attackerPos.x : result.targetPos.x, result.targetPos.y);

            if (this.state.isHost) {
                this.combatSystem.applyDamage(targetId, result.damage, attackerId, { isCrit: result.isCrit });
            }
        }
    }

    handleEscape(entityId) {
        console.log(`Processing escape for ${entityId}`);
        const stats = this.combatSystem.getStats(entityId);
        const name = stats ? (stats.name || 'Unknown') : 'Unknown';
        if (entityId === this.state.myId) {
            this.database.addRewards(100, 1).then(data => this.playerData = data);
            this.state.isEscaping = true;
            this.uiSystem.updateGoldUI();
        }
        
        this.gridSystem.removeEntity(entityId);
        this.combatSystem.stats.delete(entityId);

        if (this.state.isHost) {
            this.peerClient.send({ type: NetworkEvents.PLAYER_ESCAPED, payload: { id: entityId } });

            this.checkHumansEscaped();
            
            setTimeout(() => {
                if (!this.state.gameOver) {
                    this.respawnAsMonster(entityId);
                }
            }, 3000);
        }

        if (entityId === this.state.myId) {
            this.uiSystem.showNotification("ESCAPED! Respawning as Monster...");
        }
    }

    checkHumansEscaped() {
        if (!this.state.isHost || this.state.gameOver) return;

        if (this.combatSystem.getHumanCount() === 0) {
            this.state.gameOver = true;
            const msg = "No Humans Remain";
            this.peerClient.send({ type: NetworkEvents.HUMANS_ESCAPED, payload: { message: msg } });
            this.uiSystem.showHumansEscaped(msg);
        }
    }

    update(dt) {
        this.updateDebugUI();
        if (dt > 100) dt = 100;

        if (this.state.isHost) {
            this.state.gameTime -= (dt / 1000);
            
            if (!this.state.escapeOpen && this.state.gameTime <= 60) {
                this.state.escapeOpen = true;
                const pos = this.gridSystem.spawnEscapePortal();
                this.peerClient.send({ type: NetworkEvents.PORTAL_SPAWN, payload: { x: pos.x, y: pos.y } });
            }

            if (!this.state.gameOver && this.state.gameTime <= 0) {
                this.state.gameOver = true;
                this.peerClient.send({ type: NetworkEvents.HUMANS_ESCAPED, payload: { message: "Time Expired - Dungeon Collapsed" } });
                this.uiSystem.showHumansEscaped("Time Expired");
            }

            this.state.netTimer += dt;
            if (this.state.netTimer >= 50) {
                this.state.netTimer = 0; // Prevent packet bursting during lag spikes
                
                // 1. Prepare Global State Once (Heavy Lifting)
                const globalSnap = this.syncManager.prepareGlobalSnapshot(
                    this.gridSystem, this.combatSystem, 
                    this.state.projectiles, this.state.gameTime
                );

                // Host Loop: Send unique, culled snapshots to each client
                this.peerClient.connections.forEach(conn => {
                    if (conn.open) {
                        // 2. Filter for Client (Lightweight)
                        const snapshot = this.syncManager.createClientSnapshot(
                            globalSnap, conn.peer
                        );
                        conn.send({ type: NetworkEvents.SNAPSHOT, payload: snapshot });
                    }
                });
            }

            this.combatSystem.updateProjectiles(dt, this.state.projectiles, this.gridSystem);
            this.gridSystem.processLavaDamage(dt, this.combatSystem);
        }

        if (!this.state.isHost && this.state.connected) {
            const interpolatedState = this.syncManager.getInterpolatedState(Date.now());
            const latestState = this.syncManager.getLatestState();
            
            if (interpolatedState) {
                // First, update the state of all entities EXCEPT our own player.
                this.gridSystem.syncRemoteEntities(interpolatedState.entities, this.state.myId);
                
                // Only sync loot if the snapshot contained it (Full Sync)
                if (interpolatedState.loot) this.lootSystem.syncLoot(interpolatedState.loot);

                for (const [id, data] of interpolatedState.entities) {
                    if (id !== this.state.myId) {
                        this.combatSystem.syncRemoteStats(id, data);
                    }
                }
                
                this.state.projectiles = interpolatedState.projectiles;
                this.state.gameTime = interpolatedState.gameTime;
            }
            
            if (latestState && latestState.timestamp > this.state.lastReconciledTime) {
                // Reconcile our player's position based on the authoritative server state (latest)
                // and our pending inputs.
                this.reconcilePlayer(latestState);
                this.state.lastReconciledTime = latestState.timestamp;
            }
        }

        const timerEl = document.getElementById('game-timer');
        if (timerEl) {
            const minutes = Math.floor(this.state.gameTime / 60);
            const seconds = Math.floor(this.state.gameTime % 60);
            timerEl.innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            if (this.state.gameTime < 60) timerEl.style.color = '#ff4444';
            else timerEl.style.color = '#fff';
        }

        if (this.state.interaction) {
            if (Date.now() - this.state.interaction.startTime >= this.state.interaction.duration) {
                this.handleInteractWithLoot(this.state.interaction.target);
                this.state.interaction = null;
            }
        }

        if (this.state.myId) {
            const mouse = this.inputManager.getMouseState();
            
            if (mouse.left) {
                const now = Date.now();
                if (!this.state.lastMousePathTime || now - this.state.lastMousePathTime > 100) {
                    this.state.lastMousePathTime = now;
                    
                    const cam = this.renderSystem.camera;
                    const ts = this.config.global.tileSize || 48;
                    const scale = this.renderSystem.scale || 1;
                    const gridX = Math.floor(((mouse.x / scale) + cam.x) / ts);
                    const gridY = Math.floor(((mouse.y / scale) + cam.y) / ts);
                    
                    this.processClickLogic(gridX, gridY, mouse.shift, true);
                }
            }

            const moveIntent = this.inputManager.getMovementIntent();
            
            if (this.state.autoPath && this.state.autoPath.length > 0 && !moveIntent) {
                const next = this.state.autoPath[0];
                const pos = this.gridSystem.entities.get(this.state.myId);
                if (pos) {
                    const dx = next.x - pos.x;
                    const dy = next.y - pos.y;
                    if (dx === 0 && dy === 0) {
                        this.state.autoPath.shift();
                    } else {
                        this.handleInput({ type: 'MOVE', direction: { x: Math.sign(dx), y: Math.sign(dy) } });
                    }
                }
            } else if (this.state.chaseTargetId && !moveIntent) {
                const targetPos = this.gridSystem.entities.get(this.state.chaseTargetId);
                const myPos = this.gridSystem.entities.get(this.state.myId);
                
                if (targetPos && myPos) {
                    const dist = Math.max(Math.abs(targetPos.x - myPos.x), Math.abs(targetPos.y - myPos.y));
                    if (dist <= 1) {
                        this.handleInput({ 
                            type: 'TARGET_ACTION', 
                            x: targetPos.x, 
                            y: targetPos.y 
                        });
                    }
                }
                this.state.chaseTargetId = null;
            } else if (moveIntent) {
                this.state.autoPath = [];
                this.state.chaseTargetId = null;
            }

            if (moveIntent) {
                this.handleInput(moveIntent);
            } else {
                // Execute buffered action if cooldown is ready
                if (this.state.actionBuffer && this.ticker.tick >= this.state.nextInputTick) {
                    this.executeAction(this.state.actionBuffer);
                }
                
                if (this.state.actionBuffer && this.state.actionBuffer.type === 'MOVE') {
                    this.state.actionBuffer = null;
                }
            }


        }

        if (this.state.isHost) {
            this.aiSystem.update(this.ticker.tick, this.ticker.timePerTick, (attackerId, targetId) => this.performAttack(attackerId, targetId));
        }
    }

    createDebugUI() {
        const div = document.createElement('div');
        div.id = 'debug-overlay';
        Object.assign(div.style, {
            position: 'absolute', top: '10px', left: '10px',
            backgroundColor: 'rgba(0,0,0,0.7)', color: '#0f0',
            padding: '10px', fontFamily: 'monospace',
            pointerEvents: 'none', zIndex: '9999', fontSize: '12px'
        });
        document.body.appendChild(div);
    }

    updateDebugUI() {
        const now = Date.now();
        if (now - this.debugStats.lastUpdate > 1000) {
            const el = document.getElementById('debug-overlay');
            if (el) {
                el.innerHTML = `
                    <strong>NET DEBUG</strong><br>
                    In: ${(this.debugStats.bytesIn / 1024).toFixed(1)} KB/s (${this.debugStats.packetsIn})<br>
                    Out: ${(this.debugStats.bytesOut / 1024).toFixed(1)} KB/s (${this.debugStats.packetsOut})<br>
                    Snap Size: ${(this.debugStats.lastSnapshotSize / 1024).toFixed(2)} KB<br>
                    Entities: ${this.debugStats.lastSnapshotEntities}<br>
                    Projectiles: ${this.state.projectiles.length}
                `;
            }
            this.debugStats.bytesIn = 0;
            this.debugStats.bytesOut = 0;
            this.debugStats.packetsIn = 0;
            this.debugStats.packetsOut = 0;
            this.debugStats.lastUpdate = now;
        }
    }

    monitorNetwork(data, isIncoming) {
        try {
            // Optimization: Approximate size instead of JSON.stringify to avoid GC/CPU spikes
            const len = data.payload ? (data.type === 'SNAPSHOT' ? (data.payload.e ? data.payload.e.length * 50 : 100) : 100) : 50;
            
            if (isIncoming) {
                this.debugStats.bytesIn += len;
                this.debugStats.packetsIn++;
                if (data.type === 'SNAPSHOT') {
                    this.debugStats.lastSnapshotSize = len;
                    if (data.payload && data.payload.e) {
                        this.debugStats.lastSnapshotEntities = data.payload.e.length;
                    }
                }
            } else {
                this.debugStats.bytesOut += len;
                this.debugStats.packetsOut++;
            }
        } catch (e) {}
    }

    reconcilePlayer(serverState) {
        const serverPlayerState = serverState.entities.get(this.state.myId);
        if (!serverPlayerState) return;

        let localPlayer = this.gridSystem.entities.get(this.state.myId);
        if (!localPlayer) {
            // Player doesn't exist locally, create it with server state.
            this.gridSystem.addEntity(this.state.myId, serverPlayerState.x, serverPlayerState.y);
            localPlayer = this.gridSystem.entities.get(this.state.myId);
            // Immediately sync all visual properties.
            Object.assign(localPlayer, serverPlayerState);
            return; // No inputs to reconcile yet, so we're done.
        }

        // Fix: Update spatial map before overwriting position to ensure collision detection remains accurate
        if (Math.round(localPlayer.x) !== Math.round(serverPlayerState.x) || 
            Math.round(localPlayer.y) !== Math.round(serverPlayerState.y)) {
            this.gridSystem.updateSpatialMap(
                this.state.myId, 
                localPlayer.x, localPlayer.y, 
                serverPlayerState.x, serverPlayerState.y
            );
        }

        // 1. Snap to server state
        Object.assign(localPlayer, serverPlayerState);
        
        const stats = this.combatSystem.getStats(this.state.myId);
        if (stats) {
            stats.nextActionTick = serverPlayerState.nextActionTick;
            stats.hp = serverPlayerState.hp;
            stats.maxHp = serverPlayerState.maxHp;
            stats.type = serverPlayerState.type;
            stats.team = serverPlayerState.team;
            stats.invisible = serverPlayerState.invisible;
        }
        
        // 2. Remove processed inputs
        const lastProcessed = serverPlayerState.lastProcessedInputTick || 0;
        
        // Optimization: Efficiently remove old inputs
        if (this.state.inputBuffer.length > 0 && this.state.inputBuffer[0].tick <= lastProcessed) {
            const firstNewIndex = this.state.inputBuffer.findIndex(input => input.tick > lastProcessed);
            if (firstNewIndex === -1) this.state.inputBuffer = [];
            else this.state.inputBuffer = this.state.inputBuffer.slice(firstNewIndex);
        }

        // 3. Replay remaining inputs
        for (const input of this.state.inputBuffer) {
            this.processPlayerInput(this.state.myId, input, true);
        }
    }

    render(alpha) {
        if (!this.state.myId) return;
        
        const myPos = this.gridSystem.entities.get(this.state.myId);
        if (myPos) {
            this.audioSystem.updateListener(myPos.x, myPos.y);
        }

        this.renderSystem.render(
            this.gridSystem.grid,
            this.gridSystem.entities,
            this.lootSystem.worldLoot,
            this.state.projectiles,
            this.state.interaction,
            this.state.myId,
            this.state.isHost
        );
    }
}
