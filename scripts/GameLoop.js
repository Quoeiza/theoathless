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

export default class GameLoop {
    constructor() {
        this.assetSystem = new AssetSystem();
        this.state = {
            myId: null,
            isHost: false,
            connected: false,
            gameTime: 0,
            extractionOpen: false,
            actionBuffer: null,
            nextActionTime: 0,
            projectiles: [],
            interaction: null,
            netTimer: 0,
            handshakeInterval: null,
            isExtracting: false,
            autoPath: [],
            chaseTargetId: null
        };
        this.database = new Database();
        this.playerData = { name: 'Player', gold: 0, class: 'Fighter' };
        
        // Delegate loop handling to core utility
        this.ticker = new Ticker(
            (dt) => this.update(dt), 
            (alpha) => this.render(alpha),
            20 // Tick rate (will be overwritten by config)
        );
    }

    async init() {
        // 1. Load Configuration
        const configs = await this.assetSystem.loadAll();
        this.config = configs;

        // Update loop tick rate from config
        if (this.config.global && this.config.global.tickRate) {
            this.ticker.tickRate = this.config.global.tickRate;
            this.ticker.timePerTick = 1000 / this.config.global.tickRate;
        }

        
        // 2. Load Player Data
        this.playerData = (await this.database.getPlayer()) || { name: 'Player', gold: 0, extractions: 0 };

        // 3. Initialize Systems
        const global = configs.global || {};
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

        this.combatSystem = new CombatSystem(configs.enemies);
        this.renderSystem.setCombatSystem(this.combatSystem);
        this.lootSystem = new LootSystem(configs.items);
        this.inputManager = new InputManager(configs.global);
        this.peerClient = new PeerClient(configs.net);
        this.syncManager = new SyncManager(configs.global);
        this.audioSystem = new AudioSystem();
        await this.audioSystem.setAssetLoader(this.assetSystem);
        this.uiSystem = new UISystem(this);
        this.aiSystem = new AISystem(this.gridSystem, this.combatSystem, this.lootSystem);

        // 4. Show Lobby
        this.uiSystem.setupLobby();

        // Play Lobby Music & Handle Autoplay Policy
        this.audioSystem.playMusic('theme');
        const resumeAudio = () => {
            this.audioSystem.resume();
            document.removeEventListener('click', resumeAudio);
            document.removeEventListener('keydown', resumeAudio);
        };
        document.addEventListener('click', resumeAudio);
        document.addEventListener('keydown', resumeAudio);
        
        // 5. Check for Auto-Join URL
        const urlParams = new URLSearchParams(window.location.search);
        const hostId = urlParams.get('join');
        if (hostId) {
            document.getElementById('room-code-input').value = hostId;
        }
    }

    respawnAsMonster(entityId) {
        const { type } = this.combatSystem.respawnPlayerAsMonster(entityId, this.gridSystem);
        
        if (this.state.isHost) {
             this.peerClient.send({ type: 'RESPAWN_MONSTER', payload: { id: entityId, type } });
        }
    }

    startGame(isHost, hostId = null) {
        document.getElementById('lobby-screen').classList.add('hidden');
        this.audioSystem.stopMusic();
        
        this.setupNetwork();
        this.uiSystem.setupUI();
        this.inputManager.on('intent', (intent) => this.handleInput(intent));
        this.inputManager.on('click', (data) => this.handleMouseClick(data));
        this.inputManager.on('mousemove', (data) => this.handleMouseMove(data));
        this.audioSystem.resume();

        this.ticker.start();

        const myPeerId = isHost ? `coldcoin-${this.peerClient.generateRoomId()}` : undefined;
        this.peerClient.init(myPeerId);
        this.peerClient.on('ready', (id) => {
            if (isHost) {
                const displayId = id.replace('coldcoin-', '');
                this.startHost(id);
                document.getElementById('room-code-display').innerText = `Room: ${displayId}`;
            } else if (hostId) {
                document.getElementById('room-code-display').innerText = `Room: ${hostId}`;
                this.peerClient.connect(`coldcoin-${hostId}`, { name: this.playerData.name, class: this.playerData.class });
            }
        });
    }

    handleDropItem(itemId, source) {
        if (!this.state.isHost) {
            this.peerClient.send({ type: 'DROP_ITEM', payload: { itemId, source } });
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
            this.peerClient.send({ type: 'EQUIP_ITEM', payload: { itemId, slot } });
            return;
        }
        const success = this.lootSystem.equipItem(this.state.myId, itemId, slot);
        if (success) {
            this.uiSystem.renderInventory();
            this.audioSystem.play('pickup');
        }
    }

    handleInteractWithLoot(loot) {
        if (this.state.isHost) {
            this.processLootInteraction(this.state.myId, loot);
        } else {
            this.peerClient.send({ type: 'INTERACT_LOOT', payload: { lootId: loot.id } });
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
                } else if (this.state.isHost) {
                    this.peerClient.send({ type: 'UPDATE_GOLD', payload: { id: entityId, amount: result.gold } });
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
                this.peerClient.send({ type: 'LOOT_SUCCESS', payload: { id: entityId } });
                if (this.state.isHost) this.sendInventoryUpdate(entityId);
            }
        }
    }

    setupNetwork() {
        this.peerClient.on('ready', (id) => {
            this.state.myId = id;
        });

        this.peerClient.on('close', (id) => {
            if (this.state.isHost) {
                console.log(`Player ${id} disconnected`);
                this.gridSystem.removeEntity(id);
                this.combatSystem.stats.delete(id);
                this.checkGameOver();
            }
        });

        this.combatSystem.on('damage', ({ targetId, amount, currentHp, sourceId, options }) => {
            if (targetId === this.state.myId) {
                const hpEl = document.getElementById('hp-val');
                if (hpEl) hpEl.innerText = Math.max(0, currentHp);
                this.renderSystem.triggerShake(5, 200);
                this.audioSystem.play('hit', this.gridSystem.entities.get(targetId).x, this.gridSystem.entities.get(targetId).y);
            }

            const pos = this.gridSystem.entities.get(targetId);
            if (pos) {
                const color = amount > 0 ? '#ff4444' : '#44ff44';
                let text = Math.abs(amount).toString();
                if (options && options.isCrit) text += "!";
                this.renderSystem.addFloatingText(pos.x, pos.y, text, color);
                
                if (this.state.isHost) {
                    this.peerClient.send({ type: 'FLOAT_TEXT', payload: { x: pos.x, y: pos.y, text, color } });
                }
            }

            this.renderSystem.triggerDamage(targetId, sourceId);

            if (this.state.isHost) {
                this.peerClient.send({ type: 'UPDATE_HP', payload: { id: targetId, hp: currentHp } });
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
                        this.peerClient.send({ type: 'UPDATE_GOLD', payload: { id: killerId, amount: reward } });
                    }
                }

                this.peerClient.send({ type: 'ENTITY_DEATH', payload: { id: entityId } });
                
                let dropX = deathX;
                let dropY = deathY;
                
                if (!deathPos && killerId) {
                    const kPos = this.gridSystem.entities.get(killerId);
                    if (kPos) { dropX = kPos.x; dropY = kPos.y; }
                }

                const items = this.lootSystem.getAllItems(entityId);
                this.lootSystem.createLootBag(dropX, dropY, items);
                
                if (stats && stats.isPlayer) {
                    setTimeout(() => {
                        this.respawnAsMonster(entityId);
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

                this.checkGameOver();
            }
        });

        this.peerClient.on('data', ({ sender, data }) => {
            if (this.state.isHost) {
                if (data.type === 'INPUT') {
                    this.processPlayerInput(sender, data.payload);
                }
                if (data.type === 'INTERACT_LOOT') {
                    const loot = this.lootSystem.worldLoot.get(data.payload.lootId);
                    if (loot) this.processLootInteraction(sender, loot);
                }
                if (data.type === 'HELLO') {
                    this.peerClient.sendTo(sender, {
                        type: 'INIT_WORLD',
                        payload: { grid: this.gridSystem.grid }
                    });
                }
                if (data.type === 'EQUIP_ITEM') {
                    this.handleEquipItem(data.payload.itemId, data.payload.slot);
                    this.sendInventoryUpdate(sender);
                }
                if (data.type === 'DROP_ITEM') {
                    this.handleDropItem(data.payload.itemId, data.payload.source);
                    this.sendInventoryUpdate(sender);
                }
            } else {
                if (data.type === 'SNAPSHOT') {
                    this.syncManager.addSnapshot(data.payload);
                } else if (data.type === 'INIT_WORLD') {
                    this.gridSystem.setGrid(data.payload.grid);
                    if (this.state.handshakeInterval) {
                        clearInterval(this.state.handshakeInterval);
                        this.state.handshakeInterval = null;
                    }
                    this.state.connected = true;
                } else if (data.type === 'UPDATE_HP') {
                    if (data.payload.id === this.state.myId) {
                        const hpEl = document.getElementById('hp-val');
                        if (hpEl) hpEl.innerText = Math.max(0, data.payload.hp);
                        this.audioSystem.play('hit');
                    }
                } else if (data.type === 'ENTITY_DEATH') {
                    this.gridSystem.removeEntity(data.payload.id);
                    this.renderSystem.triggerDeath(data.payload.id);
                    this.audioSystem.play('death');
                } else if (data.type === 'GAME_OVER') {
                    this.uiSystem.showGameOver(data.payload.message);
                } else if (data.type === 'PLAYER_EXTRACTED') {
                    console.log(`Player ${data.payload.id} extracted!`);
                } else if (data.type === 'PORTAL_SPAWN') {
                    this.gridSystem.setTile(data.payload.x, data.payload.y, 9);
                    this.uiSystem.showNotification("The Extraction Portal has opened!");
                    this.audioSystem.play('pickup', data.payload.x, data.payload.y);
                } else if (data.type === 'RESPAWN_MONSTER') {
                    if (data.payload.id === this.state.myId) {
                        this.uiSystem.showNotification(`Respawned as ${data.payload.type}`);
                    }
                } else if (data.type === 'EFFECT') {
                    this.renderSystem.addEffect(data.payload.x, data.payload.y, data.payload.type);
                }

                if (data.type === 'FLOAT_TEXT') {
                    this.renderSystem.addFloatingText(data.payload.x, data.payload.y, data.payload.text, data.payload.color);
                }
                
                if (data.type === 'SPAWN_PROJECTILE') {
                    this.audioSystem.play('attack', data.payload.x, data.payload.y);
                }

                if (data.type === 'UPDATE_GOLD') {
                    if (data.payload.id === this.state.myId) {
                        this.playerData.gold = (this.playerData.gold || 0) + data.payload.amount;
                        this.database.updatePlayer({ gold: this.playerData.gold });
                        this.uiSystem.updateGoldUI();
                        this.uiSystem.showNotification(`+${data.payload.amount}g`);
                    }
                }

                if (data.type === 'LOOT_SUCCESS') {
                    if (data.payload.id === this.state.myId) {
                        this.audioSystem.play('pickup', 0, 0);
                        this.uiSystem.renderInventory();
                        this.uiSystem.updateQuickSlotUI();
                    }
                }

                if (data.type === 'UPDATE_INVENTORY') {
                    if (this.lootSystem.inventories) this.lootSystem.inventories.set(this.state.myId, data.payload.inventory);
                    if (this.lootSystem.equipment) this.lootSystem.equipment.set(this.state.myId, data.payload.equipment);
                    this.uiSystem.renderInventory();
                }
            }
        });

        this.peerClient.on('connected', ({ peerId, metadata }) => {
            if (this.state.isHost) {
                const spawn = this.gridSystem.getSpawnPoint(true);
                this.gridSystem.addEntity(peerId, spawn.x, spawn.y);
                this.combatSystem.registerEntity(peerId, 'player', true, metadata.class || 'Fighter', metadata.name || 'Unknown');
            } else {
                this.state.handshakeInterval = setInterval(() => {
                    if (!this.state.connected) this.peerClient.send({ type: 'HELLO' });
                }, 500);
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
        this.state.gameTime = this.config.global.extractionTimeSeconds || 600;
    }

    sendInventoryUpdate(targetId) {
        if (!this.state.isHost) return;
        const inventory = this.lootSystem.getInventory(targetId);
        const equipment = this.lootSystem.getEquipment(targetId);
        this.peerClient.sendTo(targetId, { 
            type: 'UPDATE_INVENTORY', 
            payload: { inventory, equipment } 
        });
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

        const now = Date.now();
        if (now >= this.state.nextActionTime) {
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
        const cooldown = this.config.global.globalCooldownMs || 250;
        this.state.nextActionTime = Date.now() + cooldown;
        this.state.actionBuffer = null;

        if (!this.state.isHost && intent.type === 'MOVE') {
            this.processPlayerInput(this.state.myId, intent);
        }

        if (this.state.isHost) {
            this.processPlayerInput(this.state.myId, intent);
        } else {
            this.peerClient.send({ type: 'INPUT', payload: intent });
        }
    }

    processPlayerInput(entityId, intent) {
        if (!intent || !intent.type) return;

        let stats = this.combatSystem.getStats(entityId);

        if (!stats && entityId === this.state.myId && !this.state.isHost) {
            this.combatSystem.registerEntity(entityId, 'player', true, this.playerData.class, this.playerData.name);
            stats = this.combatSystem.getStats(entityId);
        }

        let now = Date.now();
        let cooldown = this.combatSystem.calculateCooldown(entityId, this.config.global.globalCooldownMs || 250);

        const pos = this.gridSystem.entities.get(entityId);
        
        if (intent.type === 'MOVE' && intent.shift) {
            if (pos) {
                pos.facing = intent.direction;
                
                const proj = this.combatSystem.createProjectile(entityId, pos.x, pos.y, intent.direction.x, intent.direction.y, this.lootSystem);

                if (proj) {
                    this.state.projectiles.push(proj);
                    this.peerClient.send({ type: 'SPAWN_PROJECTILE', payload: proj });
                    this.audioSystem.play('attack', pos.x, pos.y);
                } else {
                    const tx = pos.x + intent.direction.x;
                    const ty = pos.y + intent.direction.y;
                    const targetId = this.gridSystem.getEntityAt(tx, ty);
                    
                    if (targetId) {
                        this.performAttack(entityId, targetId);
                    } else {
                        this.renderSystem.triggerAttack(entityId);
                        this.renderSystem.addEffect(tx, ty, 'slash');
                        this.peerClient.send({ type: 'EFFECT', payload: { x: tx, y: ty, type: 'slash' } });
                        this.audioSystem.play('swing', pos.x, pos.y);
                    }
                }
            }
            return;
        }

        if (pos && intent.type === 'MOVE') {
            const cost = this.gridSystem.getMovementCost(pos.x + intent.direction.x, pos.y + intent.direction.y);
            cooldown *= cost;
        }

        if (!stats) return;
        if (now - stats.lastActionTime < cooldown) {
            return;
        }
        stats.lastActionTime = now;

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
                        this.processLootInteraction(entityId, chest);
                    }
                    return;
                }
            }

            const result = this.gridSystem.resolveMoveIntent(entityId, intent.direction, this.lootSystem);

            if (result.type === 'INTERACT_LOOT') {
                if (pos) pos.facing = result.facing;
                this.processLootInteraction(entityId, result.loot);
                return;
            } else if (result.type === 'MOVED') {
                if (entityId === this.state.myId) {
                    this.audioSystem.play('step', pos.x, pos.y);
                    this.renderSystem.addEffect(startX, startY, 'dust');
                }
                if (this.gridSystem.grid[Math.round(result.y)][Math.round(result.x)] === 9) {
                    this.handleExtraction(entityId);
                }
            } else if (result.type === 'BUMP_ENTITY') {
                this.renderSystem.triggerBump(entityId, result.direction);
                if (!this.combatSystem.isFriendly(entityId, result.targetId)) {
                    this.performAttack(entityId, result.targetId);
                }
            } else if (result.type === 'BUMP_WALL') {
                this.renderSystem.triggerBump(entityId, result.direction);
                if (entityId === this.state.myId) this.audioSystem.play('bump', pos.x, pos.y);
            }
        }
        
        if (intent.type === 'INTERACT') {
            if (pos) {
                const tx = pos.x + pos.facing.x;
                const ty = pos.y + pos.facing.y;
                const targetId = this.gridSystem.getEntityAt(tx, ty);
                if (targetId) {
                    this.performAttack(entityId, targetId);
                    return;
                }

                const items = this.lootSystem.getItemsAt(tx, ty);
                if (items.length > 0) {
                    if (entityId === this.state.myId) this.handleInteractWithLoot(items[0]);
                    else this.processLootInteraction(entityId, items[0]);
                    return;
                }

                this.renderSystem.triggerAttack(entityId);
                this.renderSystem.addEffect(tx, ty, 'slash');
                this.peerClient.send({ type: 'EFFECT', payload: { x: tx, y: ty, type: 'slash' } });
                this.audioSystem.play('swing', pos.x, pos.y);
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
                    if (entityId === this.state.myId) this.uiSystem.showGroundLoot(target.items);
                } else {
                    if (entityId === this.state.myId) this.handleInteractWithLoot(target.items[0]);
                    else this.processLootInteraction(entityId, target.items[0]); 
                }
            }
        }

        if (intent.type === 'TARGET_ACTION') {
            const result = this.combatSystem.processTargetAction(entityId, intent.x, intent.y, this.gridSystem, this.lootSystem);
            
            if (result && result.type === 'PROJECTILE') {
                if (intent.projId) result.projectile.id = intent.projId;
                this.state.projectiles.push(result.projectile);
                this.peerClient.send({ type: 'SPAWN_PROJECTILE', payload: result.projectile });
                this.audioSystem.play('attack', pos.x, pos.y);
                this.renderSystem.triggerAttack(entityId);
            } else if (result && result.type === 'MELEE') {
                this.performAttack(entityId, result.targetId);
            } else if (result && result.type === 'MISS') {
                this.renderSystem.triggerAttack(entityId);
                this.renderSystem.addEffect(result.x, result.y, 'slash');
                this.peerClient.send({ type: 'EFFECT', payload: { x: result.x, y: result.y, type: 'slash' } });
                this.audioSystem.play('swing', pos.x, pos.y);
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
                this.performAttack(entityId, result.targetId);
            } else if (result && result.type === 'MISS') {
                this.renderSystem.addEffect(result.x, result.y, 'slash');
                this.peerClient.send({ type: 'EFFECT', payload: { x: result.x, y: result.y, type: 'slash' } });
                this.audioSystem.play('swing', pos.x, pos.y);
            }
        }

        if (intent.type === 'USE_ABILITY_SLOT') {
            const quickSlot = `quick${intent.slot + 1}`;
            const itemConfig = this.lootSystem.consumeItem(entityId, quickSlot);
            
            const result = this.combatSystem.applyConsumableEffect(entityId, itemConfig);
            if (result) {
                this.audioSystem.play('pickup', this.gridSystem.entities.get(entityId).x, this.gridSystem.entities.get(entityId).y);
                this.uiSystem.renderInventory();
                this.uiSystem.updateQuickSlotUI();
            }
        }

        if (intent.type === 'ABILITY') {
            const result = this.combatSystem.useAbility(entityId);
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

    performAttack(attackerId, targetId) {
        const result = this.combatSystem.resolveAttack(attackerId, targetId, this.gridSystem, this.lootSystem);
        if (!result) return;

        if (result.type === 'RANGED') {
            const proj = { 
                id: `proj_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                ...result.projectile 
            };
            this.state.projectiles.push(proj);
            this.peerClient.send({ type: 'SPAWN_PROJECTILE', payload: proj });
            this.audioSystem.play('attack', result.projectile.x, result.projectile.y);
            return;
        }

        if (result.type === 'MELEE') {
            this.renderSystem.triggerAttack(attackerId);
            this.renderSystem.addEffect(result.targetPos.x, result.targetPos.y, 'slash');
            this.peerClient.send({ type: 'EFFECT', payload: { x: result.targetPos.x, y: result.targetPos.y, type: 'slash' } });
            
            this.audioSystem.play('attack', attackerId === this.state.myId ? result.attackerPos.x : result.targetPos.x, result.targetPos.y);

            this.combatSystem.applyDamage(targetId, result.damage, attackerId, { isCrit: result.isCrit });
        }
    }

    handleExtraction(entityId) {
        console.log(`Processing extraction for ${entityId}`);
        const stats = this.combatSystem.getStats(entityId);
        const name = stats ? (stats.name || 'Unknown') : 'Unknown';
        if (entityId === this.state.myId) {
            this.database.addRewards(100, 1).then(data => this.playerData = data);
            this.state.isExtracting = true;
            this.uiSystem.updateGoldUI();
        }
        
        this.gridSystem.removeEntity(entityId);
        this.combatSystem.stats.delete(entityId);

        if (this.state.isHost) {
            this.peerClient.send({ type: 'PLAYER_EXTRACTED', payload: { id: entityId } });

            this.checkGameOver();
            
            setTimeout(() => {
                this.respawnAsMonster(entityId);
            }, 3000);
        }

        if (entityId === this.state.myId) {
            this.uiSystem.showNotification("EXTRACTED! Respawning as Monster...");
        }
    }

    checkGameOver() {
        if (!this.state.isHost) return;

        if (this.combatSystem.getSurvivorCount() === 0) {
            const msg = "All Survivors Eliminated";
            this.peerClient.send({ type: 'GAME_OVER', payload: { message: msg } });
            this.uiSystem.showGameOver(msg);
        }
    }

    update(dt) {
        if (dt > 100) dt = 100;

        if (this.state.isHost) {
            this.state.gameTime -= (dt / 1000);
            
            if (!this.state.extractionOpen && this.state.gameTime <= 60) {
                this.state.extractionOpen = true;
                const pos = this.gridSystem.spawnExtractionZone();
                this.peerClient.send({ type: 'PORTAL_SPAWN', payload: { x: pos.x, y: pos.y } });
            }

            if (this.state.gameTime <= 0) {
                this.peerClient.send({ type: 'GAME_OVER', payload: { message: "Time Expired - Dungeon Collapsed" } });
                this.uiSystem.showGameOver("Time Expired");
            }

            this.state.netTimer += dt;
            if (this.state.netTimer >= 100) {
                this.state.netTimer = 0;
                const snapshot = this.syncManager.serializeState(
                    this.gridSystem, this.combatSystem, this.lootSystem,
                    this.state.projectiles, this.state.gameTime
                );
                this.peerClient.send({ type: 'SNAPSHOT', payload: snapshot });
            }

            this.combatSystem.updateProjectiles(dt, this.state.projectiles, this.gridSystem);
            this.gridSystem.processLavaDamage(dt, this.combatSystem);
        }

        if (!this.state.isHost && this.state.connected) {
            const latestState = this.syncManager.getLatestState();
            
            if (latestState) {
                this.gridSystem.syncRemoteEntities(latestState.entities, this.state.myId);
                
                this.lootSystem.syncLoot(latestState.loot);
                
                for (const [id, data] of latestState.entities) {
                    if (id !== this.state.myId) {
                        this.combatSystem.syncRemoteStats(id, data);
                    }
                }

                this.state.projectiles = latestState.projectiles;
                this.state.gameTime = latestState.gameTime;

                const serverPos = latestState.entities.get(this.state.myId);
                const localPos = this.gridSystem.entities.get(this.state.myId);
            
                if (serverPos) {
                if (this.state.isExtracting && serverPos.team !== 'monster') {
                    return;
                }
                if (serverPos.team === 'monster') this.state.isExtracting = false;

                if (!localPos) {
                    this.gridSystem.addEntity(this.state.myId, Math.round(serverPos.x), Math.round(serverPos.y));
                } else {
                    const dist = Math.abs(serverPos.x - localPos.x) + Math.abs(serverPos.y - localPos.y);
                    if (dist > 5.0) {
                        console.warn("Reconciling position. Dist:", dist);
                        this.gridSystem.addEntity(this.state.myId, Math.round(serverPos.x), Math.round(serverPos.y));
                    }
                }
                }
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
            const attackIntent = this.inputManager.getAttackIntent();
            
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
                if (this.state.actionBuffer && this.state.actionBuffer.type === 'MOVE') {
                    this.state.actionBuffer = null;
                }
            }

            if (attackIntent) {
                this.handleInput(attackIntent);
            }
        }

        if (this.state.isHost) {
            this.aiSystem.update(dt, (attackerId, targetId) => this.performAttack(attackerId, targetId));
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
            this.state.myId
        );
    }
}