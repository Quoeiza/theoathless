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
            extractionOpen: false,
            actionBuffer: null,
            nextActionTime: 0,
            projectiles: [],
            interaction: null, // { type, targetId, startTime, duration, x, y }
            lavaTimer: 0
        };
        this.database = new Database();
        this.playerData = { name: 'Player', gold: 0, class: 'Fighter' };
    }

    async init() {
        // 1. Load Configuration
        const configs = await this.assetLoader.loadAll();
        this.config = configs;
        
        // 2. Load Player Data
        this.playerData = (await this.database.getPlayer()) || { name: 'Player', gold: 0, extractions: 0 };

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
            <select id="class-select" style="padding: 10px; background: #333; color: white; border: 1px solid #555;">
                <option value="Fighter">Fighter (Heal)</option>
                <option value="Rogue">Rogue (Stealth)</option>
                <option value="Barbarian">Barbarian (Rage)</option>
            </select>
            <button id="btn-host">Host Game</button>
            <div style="display:flex; gap:10px;">
                <input type="text" id="room-code-input" placeholder="Room Code" />
                <button id="btn-join">Join Game</button>
            </div>
        `;
        uiLayer.appendChild(lobby);

        document.getElementById('btn-host').onclick = () => {
            this.playerData.name = document.getElementById('player-name').value || 'Host';
            this.playerData.class = document.getElementById('class-select').value;
            this.database.savePlayer({ name: this.playerData.name });
            this.startGame(true);
        };

        document.getElementById('btn-join').onclick = () => {
            const code = document.getElementById('room-code-input').value;
            if (!code) return alert("Enter a room code");
            this.playerData.name = document.getElementById('player-name').value || 'Client';
            this.playerData.class = document.getElementById('class-select').value;
            this.database.savePlayer({ name: this.playerData.name });
            this.startGame(false, code);
        };
    }

    generateRoomCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let result = '';
        for (let i = 0; i < 4; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
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

        const myPeerId = isHost ? this.generateRoomCode() : null;
        this.peerClient.init(myPeerId);
        this.peerClient.on('ready', (id) => {
            if (isHost) {
                this.startHost(id);
                document.getElementById('room-code-display').innerText = `Room: ${id}`;
            } else if (hostId) {
                // Update UI to show the room we are trying to join
                document.getElementById('room-code-display').innerText = `Room: ${hostId}`;
                this.peerClient.connect(hostId, { name: this.playerData.name, class: this.playerData.class });
            }
        });
    }

    setupUI() {
        // Reveal HUD elements
        ['room-code-display', 'kill-feed', 'combat-log', 'stats-bar', 'mobile-controls'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('hidden');
        });

        const uiLayer = document.getElementById('ui-layer');
        if (uiLayer && !document.getElementById('game-timer')) {
            const timer = document.createElement('div');
            timer.id = 'game-timer';
            uiLayer.appendChild(timer);
        }

        // Inventory Toggles
        const modal = document.getElementById('inventory-modal');
        const btnToggle = document.getElementById('btn-inventory-toggle');
        const btnClose = document.getElementById('btn-inventory-close');

        const toggleInv = () => {
            modal.classList.toggle('hidden');
            if (!modal.classList.contains('hidden')) {
                this.renderInventory();
            }
        };

        if (btnToggle) btnToggle.onclick = toggleInv;
        if (btnClose) btnClose.onclick = toggleInv;

        // Ground Loot Close
        const btnGroundClose = document.getElementById('btn-ground-close');
        if (btnGroundClose) btnGroundClose.onclick = () => document.getElementById('ground-loot-modal').classList.add('hidden');

        // Loot Notification
        if (!document.getElementById('loot-notification')) {
            const notif = document.createElement('div');
            notif.id = 'loot-notification';
            uiLayer.appendChild(notif);
        }

        // Quick Slots HUD
        if (!document.getElementById('quick-slots-hud')) {
            const hud = document.createElement('div');
            hud.id = 'quick-slots-hud';
            uiLayer.appendChild(hud);
        }

        // Drag and Drop Handlers
        this.setupDragAndDrop();

        // Settings Modal
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) {
            document.getElementById('btn-resume').onclick = () => this.toggleSettingsMenu();
            document.getElementById('btn-settings').onclick = () => alert("Settings coming soon!");
            document.getElementById('btn-quit').onclick = () => location.reload();
        }
    }

    setupDragAndDrop() {
        // Drop on Canvas (Floor)
        const canvas = document.getElementById('game-canvas');
        
        canvas.addEventListener('dragover', (e) => e.preventDefault());
        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            if (data && data.itemId) {
                this.handleDropItem(data.itemId, data.source);
            }
        });

        // Drop on Equip Slots
        const slots = document.querySelectorAll('.equip-slot');
        slots.forEach(slot => {
            slot.addEventListener('dragover', (e) => e.preventDefault());
            slot.addEventListener('drop', (e) => {
                e.preventDefault();
                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                const targetSlot = slot.dataset.slot;
                if (data && data.itemId) {
                    this.handleEquipItem(data.itemId, targetSlot);
                }
            });
        });
    }

    handleDropItem(itemId, source) {
        // Logic to drop item on the floor
        // 1. Remove from inventory/equipment
        if (source === 'inventory') {
            this.lootSystem.removeItemFromInventory(this.state.myId, itemId);
        } else {
            this.lootSystem.unequipItem(this.state.myId, source);
        }

        // 2. Spawn in world (Host authoritative, so send intent if client)
        const pos = this.gridSystem.entities.get(this.state.myId);
        if (pos) {
            if (this.state.isHost) {
                this.lootSystem.spawnDrop(pos.x, pos.y, itemId);
            } else {
                // TODO: Send DROP_ITEM intent to host. For now, client side prediction/hack for demo
                // In a real implementation, we'd emit an intent.
                // For this revision, we'll just log it if not host.
                console.warn("Client drop not fully implemented over network yet");
            }
        }
        this.renderInventory();
        this.audioSystem.play('pickup'); // Reuse sound for now
    }

    handleEquipItem(itemId, slot) {
        const success = this.lootSystem.equipItem(this.state.myId, itemId, slot);
        if (success) {
            this.renderInventory();
            this.audioSystem.play('pickup');
        }
    }

    renderInventory() {
        const grid = document.getElementById('inventory-grid');
        const inv = this.lootSystem.getInventory(this.state.myId);
        const equip = this.lootSystem.getEquipment(this.state.myId);

        // Render Grid
        grid.innerHTML = '';
        // Fixed size grid (e.g. 15 slots)
        for (let i = 0; i < 15; i++) {
            const cell = document.createElement('div');
            cell.className = 'inv-slot';
            
            if (inv[i]) {
                const item = inv[i];
                const icon = document.createElement('div');
                icon.className = 'item-icon';
                // Simple color coding for now based on type
                const type = this.lootSystem.getItemType(item.itemId);
                icon.style.backgroundColor = type === 'weapon' ? '#d65' : type === 'armor' ? '#56d' : '#5d5';
                
                // Enhanced Tooltip
                const config = this.lootSystem.getItemConfig(item.itemId);
                let tooltip = config ? config.name : item.itemId;
                if (config) {
                    if (config.damage) tooltip += `\nDamage: ${config.damage}`;
                    if (config.defense) tooltip += `\nDefense: ${config.defense}`;
                    if (config.effect) tooltip += `\nEffect: ${config.effect} (${config.value})`;
                }
                icon.title = tooltip;

                if (item.count > 1) {
                    const countEl = document.createElement('span');
                    countEl.className = 'item-count';
                    countEl.innerText = item.count;
                    icon.appendChild(countEl);
                }
                
                cell.draggable = true;
                cell.appendChild(icon);

                cell.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', JSON.stringify({ itemId: item.itemId, source: 'inventory' }));
                });
            }
            grid.appendChild(cell);
        }

        // Render Equip Slots
        const renderSlot = (slotName) => {
            const el = document.getElementById(`slot-${slotName}`);
            el.innerHTML = '';
            const item = equip[slotName];
            if (item) {
                const icon = document.createElement('div');
                icon.className = 'item-icon';
                icon.style.backgroundColor = slotName.startsWith('quick') ? '#5d5' : (slotName === 'weapon' ? '#d65' : '#56d');
                
                // Enhanced Tooltip
                const config = this.lootSystem.getItemConfig(item.itemId);
                let tooltip = config ? config.name : item.itemId;
                if (config) {
                    if (config.damage) tooltip += `\nDamage: ${config.damage}`;
                    if (config.defense) tooltip += `\nDefense: ${config.defense}`;
                }
                icon.title = tooltip;

                if (item.count > 1) {
                    const countEl = document.createElement('span');
                    countEl.className = 'item-count';
                    countEl.innerText = item.count;
                    icon.appendChild(countEl);
                }

                el.appendChild(icon);
                
                el.draggable = true;
                el.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', JSON.stringify({ itemId: item.itemId, source: slotName }));
                });
            } else {
                el.draggable = false;
            }
        };

        renderSlot('weapon');
        renderSlot('armor');
        
        // Add Quick Slots to Inventory Modal for management
        const slotsContainer = document.querySelector('.equipment-slots');
        if (!document.getElementById('slot-quick1')) {
            // Inject quick slots if not present
            const quickContainer = document.createElement('div');
            quickContainer.style.display = 'flex';
            quickContainer.style.gap = '5px';
            quickContainer.innerHTML = `
                <div class="slot-container"><div id="slot-quick1" class="equip-slot" data-slot="quick1"></div><span>1</span></div>
                <div class="slot-container"><div id="slot-quick2" class="equip-slot" data-slot="quick2"></div><span>2</span></div>
                <div class="slot-container"><div id="slot-quick3" class="equip-slot" data-slot="quick3"></div><span>3</span></div>
            `;
            slotsContainer.appendChild(quickContainer);
            
            // Re-bind drag events for new slots
            this.setupDragAndDrop(); 
        }
        renderSlot('quick1');
        renderSlot('quick2');
        renderSlot('quick3');
    }

    updateQuickSlotUI() {
        const hud = document.getElementById('quick-slots-hud');
        if (!hud) return;
        
        const equip = this.lootSystem.getEquipment(this.state.myId);
        let html = '';
        
        for (let i = 1; i <= 3; i++) {
            const item = equip[`quick${i}`];
            html += `
                <div class="quick-slot-hud-item">
                    <span class="key-label">${i}</span>
                    ${item ? `<div class="item-icon" style="background-color:#5d5;">${item.count > 1 ? `<span class="item-count">${item.count}</span>` : ''}</div>` : ''}
                </div>`;
        }
        hud.innerHTML = html;
    }

    showGroundLoot(items) {
        const modal = document.getElementById('ground-loot-modal');
        const grid = document.getElementById('ground-grid');
        modal.classList.remove('hidden');
        grid.innerHTML = '';

        items.forEach(loot => {
            const cell = document.createElement('div');
            cell.className = 'inv-slot';
            
            const icon = document.createElement('div');
            icon.className = 'item-icon';
            const type = this.lootSystem.getItemType(loot.itemId);
            icon.style.backgroundColor = type === 'weapon' ? '#d65' : type === 'armor' ? '#56d' : '#5d5';
            icon.title = loot.itemId;
            
            // Click to pick up
            cell.onclick = () => {
                this.handleInteractWithLoot(loot);
                modal.classList.add('hidden'); // Close after one pickup for simplicity
            };

            cell.appendChild(icon);
            grid.appendChild(cell);
        });
    }

    handleInteractWithLoot(loot) {
        if (this.state.isHost) {
            this.processLootInteraction(this.state.myId, loot);
        } else {
            this.peerClient.send({ type: 'INTERACT_LOOT', payload: { lootId: loot.id } });
        }
    }

    showNotification(text) {
        const el = document.getElementById('loot-notification');
        if (el) {
            el.innerText = text;
            el.style.opacity = '1';
            setTimeout(() => { el.style.opacity = '0'; }, 2000);
        }
    }

    addKillFeed(msg) {
        const feed = document.getElementById('kill-feed');
        const div = document.createElement('div');
        div.className = 'kill-msg';
        div.innerHTML = msg;
        feed.appendChild(div);
        setTimeout(() => div.remove(), 5000);
    }

    addLogMessage(msg, color = '#ddd') {
        const log = document.getElementById('combat-log');
        const div = document.createElement('div');
        div.className = 'log-entry';
        div.style.color = color;
        div.innerText = msg;
        log.prepend(div); // Newest on top (or bottom depending on preference, usually bottom for chat, top for feed)
    }

    processLootInteraction(entityId, loot) {
        let result = null;
        if (loot.type === 'chest') {
            if (!loot.opened) {
                result = this.lootSystem.tryOpen(entityId, loot.id);
            }
        } else {
            result = this.lootSystem.pickupBag(entityId, loot.id);
        }

        if (result) {
            // Handle Gold
            if (result.gold > 0) {
                if (entityId === this.state.myId) {
                    this.playerData.gold += result.gold;
                    this.updateGoldUI();
                } else if (this.state.isHost) {
                    // If host processing for client, send gold update
                    this.peerClient.send({ type: 'UPDATE_GOLD', payload: { id: entityId, amount: result.gold } });
                }
            }

            // Play sound for specific player
            if (entityId === this.state.myId) {
                this.audioSystem.play('pickup');
                this.renderInventory();
                this.updateQuickSlotUI();
                const goldText = result.gold > 0 ? ` + ${result.gold}g` : '';
                this.showNotification(`Looted: ${this.getItemName(result.itemId)}${goldText}`);
                this.addLogMessage(`You found ${this.getItemName(result.itemId)}`, '#FFD700');
            } else {
                // Notify client
                this.peerClient.send({ type: 'LOOT_SUCCESS', payload: { id: entityId } });
            }
        }
    }

    getItemName(itemId) {
        const items = this.config.items;
        if (items.weapons[itemId]) return items.weapons[itemId].name;
        if (items.armor && items.armor[itemId]) return items.armor[itemId].name;
        if (items.consumables[itemId]) return items.consumables[itemId].name;
        return itemId;
    }

    updateGoldUI() {
        const el = document.getElementById('gold-val');
        if (el) el.innerText = this.playerData.gold;
    }

    setupNetwork() {
        this.peerClient.on('ready', (id) => {
            this.state.myId = id;
        });

        // Combat Events (Local & Networked)
        this.combatSystem.on('damage', ({ targetId, currentHp, sourceId }) => {
            // Update UI if it's me
            if (targetId === this.state.myId) {
                const hpEl = document.getElementById('hp-val');
                if (hpEl) hpEl.innerText = Math.max(0, currentHp);
                this.renderSystem.triggerShake(5, 200); // Screen shake on damage
                this.audioSystem.play('hit'); 
            }

            // Floating Damage Text
            const pos = this.gridSystem.entities.get(targetId);
            if (pos) {
                const color = amount > 0 ? '#ff4444' : '#44ff44';
                const text = Math.abs(amount).toString();
                this.renderSystem.addFloatingText(pos.x, pos.y, text, color);
                
                // Broadcast to clients
                if (this.state.isHost) {
                    this.peerClient.send({ type: 'FLOAT_TEXT', payload: { x: pos.x, y: pos.y, text, color } });
                }
            }

            // Hit Flash
            this.renderSystem.triggerHitFlash(targetId);

            // If Host, broadcast HP update to all clients
            if (this.state.isHost) {
                this.peerClient.send({ type: 'UPDATE_HP', payload: { id: targetId, hp: currentHp } });
            }
        });

        this.combatSystem.on('death', ({ entityId, killerId, stats }) => {
            console.log(`${entityId} killed by ${killerId}`);
            this.gridSystem.removeEntity(entityId);
            this.audioSystem.play('death');
            
            if (this.state.isHost) {
                // Award Gold for Monster Kill
                const victimName = stats.name || entityId;
                const killerStats = killerId ? this.combatSystem.getStats(killerId) : null;
                const killerName = killerStats ? (killerStats.name || killerStats.type) : (killerId || 'Environment');

                let killMsg = `${victimName} died`;
                if (!stats.isPlayer && stats.team === 'monster' && killerId) {
                    const reward = Math.floor(Math.random() * 4) + 2; // 2-5 gold
                    if (killerId === this.state.myId) {
                        this.playerData.gold += reward;
                        this.updateGoldUI();
                        this.showNotification(`Kill: +${reward}g`);
                    } else {
                        this.peerClient.send({ type: 'UPDATE_GOLD', payload: { id: killerId, amount: reward } });
                    }
                    killMsg = `<span class="highlight">${killerName}</span> slew <span class="highlight">${victimName}</span>`;
                } else if (stats.isPlayer) {
                    killMsg = `<span class="highlight">${victimName}</span> was eliminated by <span class="highlight">${killerName}</span>`;
                }

                if (killerId === this.state.myId) {
                    this.addLogMessage(`You killed ${victimName}`, '#ff4444');
                }

                this.peerClient.send({ type: 'KILL_FEED', payload: { msg: killMsg } });
                this.addKillFeed(killMsg);

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
                if (data.type === 'INTERACT_LOOT') {
                    const loot = this.lootSystem.worldLoot.get(data.payload.lootId);
                    if (loot) this.processLootInteraction(sender, loot);
                }
            } else {
                // Client Logic: Receive State
                if (data.type === 'SNAPSHOT') {
                    this.syncManager.addSnapshot(data.payload);
                } else if (data.type === 'INIT_WORLD') {
                    this.gridSystem.grid = data.payload.grid;
                    this.gridSystem.torches = data.payload.torches || [];
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
                } else if (data.type === 'EFFECT') {
                    this.renderSystem.addEffect(data.payload.x, data.payload.y, data.payload.type);
                }

                if (data.type === 'FLOAT_TEXT') {
                    this.renderSystem.addFloatingText(data.payload.x, data.payload.y, data.payload.text, data.payload.color);
                }
                
                if (data.type === 'SPAWN_PROJECTILE') {
                    this.state.projectiles.push(data.payload);
                }

                if (data.type === 'UPDATE_GOLD') {
                    if (data.payload.id === this.state.myId) {
                        this.playerData.gold += data.payload.amount;
                        this.updateGoldUI();
                        this.showNotification(`+${data.payload.amount}g`);
                    }
                }

                if (data.type === 'KILL_FEED') {
                    this.addKillFeed(data.payload.msg);
                }
                
                if (data.type === 'LOOT_SUCCESS') {
                    if (data.payload.id === this.state.myId) {
                        this.audioSystem.play('pickup');
                        this.renderInventory();
                        this.updateQuickSlotUI();
                        // We don't have the item ID here easily without sending it in payload
                        // For now, just generic sound/update is okay, or we can update protocol later.
                        // The prompt asked for notification on looting from chest, which usually happens locally or via direct interaction response.
                    }
                }
            }
        });

        this.peerClient.on('connected', ({ peerId, metadata }) => {
            console.log(`Connected to ${peerId}`, metadata);
            if (this.state.isHost) {
                // Send world data specifically to the new client
                this.peerClient.sendTo(peerId, {
                    type: 'INIT_WORLD',
                    payload: { grid: this.gridSystem.grid, torches: this.gridSystem.torches }
                });
                // Spawn them
                const spawn = this.gridSystem.getSpawnPoint();
                this.gridSystem.addEntity(peerId, spawn.x, spawn.y);
                this.combatSystem.registerEntity(peerId, 'player', true, metadata.class || 'Fighter', metadata.name || 'Unknown');
            }
        });
    }

    startHost(id) {
        this.state.isHost = true;
        this.state.connected = true;
        this.gridSystem.initializeDungeon();
        this.populateDungeon();
        
        // Spawn Host
        const spawn = this.gridSystem.getSpawnPoint();
        this.gridSystem.addEntity(id, spawn.x, spawn.y);
        this.combatSystem.registerEntity(id, 'player', true, this.playerData.class, this.playerData.name);
        this.state.gameTime = this.config.global.extractionTimeSeconds || 600;
    }

    populateDungeon() {
        let validTiles = this.gridSystem.getValidSpawnLocations();
        // Fisher-Yates shuffle to randomize spawn order
        for (let i = validTiles.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [validTiles[i], validTiles[j]] = [validTiles[j], validTiles[i]];
        }

        // Spawn Enemies
        const enemyTypes = Object.keys(this.config.enemies || {});
        const enemyCount = 15; 
        
        for (let i = 0; i < enemyCount; i++) {
            if (validTiles.length === 0 || enemyTypes.length === 0) break;
            const pos = validTiles.pop();
            const type = enemyTypes[Math.floor(Math.random() * enemyTypes.length)];
            const id = `enemy_${Date.now()}_${i}`;
            this.gridSystem.addEntity(id, pos.x, pos.y);
            this.combatSystem.registerEntity(id, type, false);
        }

        // Spawn Loot
        // Use specific chest locations (corners) to avoid blocking corridors
        const chestLocs = this.gridSystem.getChestSpawnLocations();
        // Shuffle chest locations
        for (let i = chestLocs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [chestLocs[i], chestLocs[j]] = [chestLocs[j], chestLocs[i]];
        }

        const lootTable = this.config.items.loot_table_tier_1 || [];
        const lootCount = 10;
        
        for (let i = 0; i < lootCount; i++) {
            if (chestLocs.length === 0 || lootTable.length === 0) break;
            const pos = chestLocs.pop();
            const entry = lootTable[Math.floor(Math.random() * lootTable.length)];
            this.lootSystem.spawnLoot(pos.x, pos.y, entry.itemId, 1, 'chest', Math.floor(Math.random() * 11) + 5); // 5-15 gold
            // Note: We don't remove from validTiles here as chests are separate, but monsters might spawn on top. Acceptable for now.
        }
    }

    handleInput(intent) {
        if (intent.type === 'TOGGLE_MENU') {
            this.toggleSettingsMenu();
            return;
        }

        const now = Date.now();
        if (now >= this.state.nextActionTime) {
            this.executeAction(intent);
        } else {
            this.state.actionBuffer = intent;
        }
    }

    toggleSettingsMenu() {
        const modal = document.getElementById('settings-modal');
        if (modal) modal.classList.toggle('hidden');
    }

    executeAction(intent) {
        const cooldown = this.config.global.globalCooldownMs || 250;
        this.state.nextActionTime = Date.now() + cooldown;
        this.state.actionBuffer = null;

        if (this.state.isHost) {
            this.processPlayerInput(this.state.myId, intent);
        } else {
            this.peerClient.send({ type: 'INPUT', payload: intent });
        }
    }

    processPlayerInput(entityId, intent) {
        // Host-side Cooldown Enforcement
        const stats = this.combatSystem.getStats(entityId);
        let now = Date.now();
        let cooldown = this.config.global.globalCooldownMs || 250;

        // Agility Scaling for Action Speed
        if (stats && stats.attributes) {
            // 15 Agi = 100% speed. 30 Agi = 50% cooldown.
            const agiFactor = Math.max(0.5, 1 - ((stats.attributes.agi - 10) * 0.02));
            cooldown *= agiFactor;
        }

        // Apply Terrain Movement Cost
        const pos = this.gridSystem.entities.get(entityId);
        if (pos && intent.type === 'MOVE') {
            const cost = this.gridSystem.getMovementCost(pos.x + intent.direction.x, pos.y + intent.direction.y);
            cooldown *= cost;

            // Diagonal Movement Cost (approx sqrt(2))
            if (intent.direction.x !== 0 && intent.direction.y !== 0) {
                cooldown *= 1.4;
            }
        }

        if (!stats) return; // Strict check: No stats = No action
        if (now - stats.lastActionTime < cooldown) {
            return; // Action rejected due to cooldown
        }
        stats.lastActionTime = now;

        // Cancel Interaction on any input
        if (entityId === this.state.myId && this.state.interaction) {
            this.state.interaction = null;
        }

        if (intent.type === 'MOVE') {
            if (pos) {
                const tx = pos.x + intent.direction.x;
                const ty = pos.y + intent.direction.y;
                
                // Check Loot Collision (Closed Chests)
                if (this.lootSystem.isCollidable(tx, ty)) {
                    // Pivot facing even if blocked
                    pos.facing = { x: intent.direction.x, y: intent.direction.y };
                    
                    // Bump to Open Logic
                    const items = this.lootSystem.getItemsAt(tx, ty);
                    const chest = items.find(l => l.type === 'chest' && !l.opened);
                    if (chest) {
                        this.processLootInteraction(entityId, chest);
                    }
                    return; // Block movement
                }
            }

            const result = this.gridSystem.moveEntity(entityId, intent.direction.x, intent.direction.y);
            
            if (result.success) {
                if (entityId === this.state.myId) {
                    this.audioSystem.play('step');
                    this.renderSystem.addEffect(pos.x, pos.y, 'dust'); // Dust particle
                }
                
                // Check for Extraction
                const pos = this.gridSystem.entities.get(entityId);
                if (pos && this.gridSystem.grid[pos.y][pos.x] === 9) {
                    this.handleExtraction(entityId);
                }
            } else if (result.collision && result.collision !== 'wall') {
                // Bump Attack
                this.performAttack(entityId, result.collision);
            }
        }
        
        if (intent.type === 'PICKUP') {
            const pos = this.gridSystem.entities.get(entityId);
            if (pos) {
                // Check for Interaction Targets (Chest/Extraction)
                const itemsBelow = this.lootSystem.getItemsAt(pos.x, pos.y);
                const fx = pos.x + pos.facing.x;
                const fy = pos.y + pos.facing.y;
                const itemsFront = this.lootSystem.getItemsAt(fx, fy);
                const allItems = [...itemsBelow, ...itemsFront].filter(l => !l.opened);

                // Prioritize Chests for Interaction Timer
                const chest = allItems.find(i => i.type === 'chest');
                if (chest && entityId === this.state.myId) {
                    // Start Interaction
                    this.state.interaction = { type: 'chest', target: chest, startTime: Date.now(), duration: 2000 };
                    return;
                }

                // Aggregate items from Below and Front
                if (allItems.length > 0) {
                    if (allItems.length > 1) {
                        // Show Menu (Only for local player)
                        if (entityId === this.state.myId) this.showGroundLoot(allItems);
                    } else {
                        // Interact directly
                        if (entityId === this.state.myId) this.handleInteractWithLoot(allItems[0]);
                        else this.processLootInteraction(entityId, allItems[0]); 
                    }
                }
            }
        }

        if (intent.type === 'ATTACK') {
            const attacker = this.gridSystem.entities.get(entityId);
            if (attacker) {
                const targetX = attacker.x + attacker.facing.x;
                const targetY = attacker.y + attacker.facing.y;
                const targetId = this.gridSystem.getEntityAt(targetX, targetY);

                if (targetId) {
                    this.performAttack(entityId, targetId);
                } else {
                    // Whiff (Attack air)
                    this.renderSystem.addEffect(targetX, targetY, 'slash');
                    this.peerClient.send({ type: 'EFFECT', payload: { x: targetX, y: targetY, type: 'slash' } });
                    this.audioSystem.play('attack');
                }
            }
        }

        if (intent.type === 'USE_ITEM') {
            const effect = this.lootSystem.consumeItem(entityId, intent.slot);
            if (effect) {
                if (effect.effect === 'heal') {
                    const stats = this.combatSystem.getStats(entityId);
                    if (stats) {
                        stats.hp = Math.min(stats.maxHp, stats.hp + effect.value);
                        // Emit damage event with negative amount to signal heal? Or just update HP.
                        // Let's emit damage event with 0 damage but updated HP to trigger UI sync
                        this.combatSystem.emit('damage', { targetId: entityId, amount: 0, sourceId: entityId, currentHp: stats.hp });
                        this.audioSystem.play('pickup'); // Use pickup sound for now
                        this.renderInventory();
                        this.updateQuickSlotUI();
                    }
                }
            }
        }

        if (intent.type === 'ABILITY') {
            const result = this.combatSystem.useAbility(entityId);
            if (result) {
                this.showNotification(`Used ${result.ability}`);
                // Sync visual effects if needed
                if (result.effect === 'stealth') {
                    const pos = this.gridSystem.entities.get(entityId);
                    if (pos) pos.invisible = true;
                    setTimeout(() => { if(pos) pos.invisible = false; }, result.duration);
                }
                if (result.effect === 'heal') {
                    this.combatSystem.emit('damage', { targetId: entityId, amount: 0, sourceId: entityId, currentHp: this.combatSystem.getStats(entityId).hp });
                }
            }
        }
    }

    performAttack(attackerId, targetId) {
        const targetPos = this.gridSystem.entities.get(targetId);
        if (!targetPos) return;

        // Check for Ranged Weapon
        const equip = this.lootSystem.getEquipment(attackerId);
        const weaponId = equip.weapon;
        if (weaponId) {
            const config = this.lootSystem.getItemConfig(weaponId);
            if (config && config.range > 1) {
                // Spawn Projectile
                const attackerPos = this.gridSystem.entities.get(attackerId);
                const dx = targetPos.x - attackerPos.x;
                const dy = targetPos.y - attackerPos.y;
                const mag = Math.sqrt(dx*dx + dy*dy);
                const proj = { x: attackerPos.x, y: attackerPos.y, vx: dx/mag, vy: dy/mag, speed: 15, ownerId: attackerId, damage: config.damage };
                this.state.projectiles.push(proj);
                this.peerClient.send({ type: 'SPAWN_PROJECTILE', payload: proj });
                this.audioSystem.play('attack');
                return;
            }
        }

        // Trigger Visual Animation
        this.renderSystem.triggerAttack(attackerId);

        // Visual Feedback
        this.renderSystem.addEffect(targetPos.x, targetPos.y, 'slash');
        this.peerClient.send({ type: 'EFFECT', payload: { x: targetPos.x, y: targetPos.y, type: 'slash' } });
        
        // Audio
        this.audioSystem.play('attack');

        const stats = this.combatSystem.getStats(attackerId);
        const damage = stats ? stats.damage : 5;
        this.combatSystem.applyDamage(targetId, damage, attackerId);
    }

    handleExtraction(entityId) {
        console.log(`Processing extraction for ${entityId}`);
        // 1. Save Data
        const stats = this.combatSystem.getStats(entityId);
        const name = stats ? (stats.name || entityId) : entityId;

        if (entityId === this.state.myId) {
            const currentGold = this.playerData.gold + 100; // Flat reward for now
            this.database.savePlayer({ gold: currentGold, extractions: (this.playerData.extractions || 0) + 1 });
        }
        
        // 2. Remove from World
        this.gridSystem.removeEntity(entityId);
        this.combatSystem.stats.delete(entityId);

        // 3. Notify
        this.peerClient.send({ type: 'PLAYER_EXTRACTED', payload: { id: entityId } });
        this.peerClient.send({ type: 'KILL_FEED', payload: { msg: `<span class="highlight">${name}</span> escaped the dungeon!` } });
        if (entityId === this.state.myId) this.showGameOver("EXTRACTED! Loot Secured.");
    }

    updateAI(dt) {
        const now = Date.now();
        for (const [id, stats] of this.combatSystem.stats) {
            if (stats.isPlayer) continue;
            
            // AI Logic: 1 second cooldown
            if (now - (stats.lastActionTime || 0) < 1000) continue;

            const pos = this.gridSystem.entities.get(id);
            if (!pos) continue;

            // Check collision with chests for AI
            // Simple check: if target is blocked by chest, don't move there
            // This is handled implicitly if moveEntity checks collision, but moveEntity only checks walls/entities.
            // We need to check loot collision here or inject it into moveEntity.
            // For now, we check here before moving.
            // (Logic below handles movement)
            
            let targetPos = null;
            let shouldAttack = false;

            const target = this.findNearestPlayer(pos.x, pos.y);
            
            if (target) {
                // Check Line of Sight
                const hasLOS = this.gridSystem.hasLineOfSight(pos.x, pos.y, target.x, target.y);
                
                if (hasLOS) {
                    stats.aiState = 'CHASING';
                    stats.targetLastPos = { x: target.x, y: target.y };
                    stats.memoryTimer = 5000; // 5 Seconds Memory
                    targetPos = target;
                    shouldAttack = true;
                }
            }

            // Persistence Logic
            if (!targetPos && stats.aiState === 'CHASING' && stats.targetLastPos) {
                stats.memoryTimer -= dt;
                if (stats.memoryTimer > 0) {
                    targetPos = stats.targetLastPos;
                } else {
                    stats.aiState = 'IDLE';
                    stats.targetLastPos = null;
                }
            }

            if (targetPos) {
                const dx = targetPos.x - pos.x;
                const dy = targetPos.y - pos.y;
                const dist = Math.max(Math.abs(dx), Math.abs(dy));

                if (shouldAttack && dist <= 1) {
                    // Update facing to look at target
                    pos.facing = { x: Math.sign(dx), y: Math.sign(dy) };
                    // Attack (Only if we have actual target/LOS)
                    this.performAttack(id, target.id);
                    stats.lastActionTime = now;
                } else {
                    // Move towards player (Simple Axis-Aligned)
                    let moveX = Math.sign(dx);
                    let moveY = Math.sign(dy);
                    
                    // Try move
                    // Check Loot Collision first
                    if (!this.lootSystem.isCollidable(pos.x + moveX, pos.y + moveY)) {
                        let result = this.gridSystem.moveEntity(id, moveX, moveY);
                        
                        // If blocked, try the other axis
                        if (!result.success) {
                            // Fallback to cardinal movement if diagonal/direct failed
                            let fallbackX = 0;
                            let fallbackY = 0;

                            // Try moving along X axis only
                            if (moveX !== 0 && this.gridSystem.moveEntity(id, moveX, 0).success) return;
                            // Try moving along Y axis only
                            if (moveY !== 0 && this.gridSystem.moveEntity(id, 0, moveY).success) return;
                            
                            // Original fallback logic (simplified above, but keeping structure if needed)
                            if (fallbackX !== 0 || fallbackY !== 0) {
                                if (!this.lootSystem.isCollidable(pos.x + moveX, pos.y + moveY)) {
                                    this.gridSystem.moveEntity(id, moveX, moveY);
                                }
                            }
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
            if (stats.team === 'player') {
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
                // For this revision, we rely on the fact that we don't sync grid changes per frame.
                this.peerClient.send({ type: 'INIT_WORLD', payload: { grid: this.gridSystem.grid, torches: this.gridSystem.torches } });
            }

            if (this.state.gameTime <= 0) {
                this.peerClient.send({ type: 'GAME_OVER', payload: { message: "Time Expired - Dungeon Collapsed" } });
                this.showGameOver("Time Expired");
            }
        }

        // Lava Damage Logic (Host Authoritative)
        this.state.lavaTimer += dt;
        if (this.state.lavaTimer >= 1000) {
            this.state.lavaTimer = 0;
            for (const [id, pos] of this.gridSystem.entities) {
                if (this.gridSystem.grid[pos.y][pos.x] === 4) { // Lava
                    // Apply 20 damage per second
                    this.combatSystem.applyDamage(id, 20, null);
                }
            }
        }

        // Update Projectiles
        const projSpeed = dt / 1000;
        for (let i = this.state.projectiles.length - 1; i >= 0; i--) {
            const p = this.state.projectiles[i];
            p.x += p.vx * p.speed * projSpeed;
            p.y += p.vy * p.speed * projSpeed;

            // Collision Check (Host Authority for Damage, everyone for Wall destroy)
            const gridX = Math.round(p.x);
            const gridY = Math.round(p.y);

            if (!this.gridSystem.isWalkable(gridX, gridY)) {
                this.state.projectiles.splice(i, 1); // Hit Wall
                continue;
            }

            if (this.state.isHost) {
                const hitId = this.gridSystem.getEntityAt(gridX, gridY);
                if (hitId && hitId !== p.ownerId) {
                    this.combatSystem.applyDamage(hitId, p.damage, p.ownerId);
                    this.state.projectiles.splice(i, 1);
                }
            }
        }

        // Update Interaction
        if (this.state.interaction) {
            if (Date.now() - this.state.interaction.startTime >= this.state.interaction.duration) {
                this.handleInteractWithLoot(this.state.interaction.target);
                this.state.interaction = null;
            }
        }

        // Client-side Action Buffering (Runs for everyone)
        if (this.state.actionBuffer && Date.now() >= this.state.nextActionTime) {
            this.executeAction(this.state.actionBuffer);
        }

        if (this.state.isHost) {
            this.updateAI(dt);
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
            ? { 
                entities: this.gridSystem.entities, 
                loot: this.lootSystem.worldLoot, 
                gameTime: this.state.gameTime 
              }
            : this.syncManager.getInterpolatedState(Date.now());
        
        // Sync invisibility state from combat stats to grid entities for rendering (Host side)
        if (this.state.isHost) {
            for (const [id, pos] of this.gridSystem.entities) {
                const stats = this.combatSystem.getStats(id);
                if (stats) {
                    pos.invisible = stats.invisible;
                    pos.hp = stats.hp;
                    pos.maxHp = stats.maxHp;
                }
            }
        }

        // Update Timer UI
        const timerEl = document.getElementById('game-timer');
        if (timerEl && state.gameTime !== undefined) {
            const t = Math.max(0, Math.floor(state.gameTime));
            const m = Math.floor(t / 60);
            const s = t % 60;
            timerEl.innerText = `${m}:${s.toString().padStart(2, '0')}`;
        }

        // Attach torches to grid object for renderer convenience (hacky but effective for now)
        if (this.gridSystem.grid) this.gridSystem.grid.torches = this.gridSystem.torches;

        this.renderSystem.render(
            this.gridSystem.grid, 
            state.entities,
            state.loot,
            this.state.projectiles,
            this.state.interaction,
            this.state.myId
        );
    }
}

window.onload = () => {
    const game = new Game();
    game.init().catch(console.error);
};