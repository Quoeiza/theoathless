import AssetLoader from './utils/AssetLoader.js';
import GameLoop from './core/GameLoop.js';
import InputManager, { DIRECTIONS } from './core/InputManager.js';
import GridSystem from './systems/GridSystem.js';
import RenderSystem from './systems/RenderSystem.js';
import CombatSystem from './systems/CombatSystem.js';
import LootSystem from './systems/LootSystem.js';
import PeerClient from './network/PeerClient.js';
import SyncManager from './network/SyncManager.js';
import AudioSystem from './systems/AudioSystem.js';
import Database from './services/Database.js';

const AI_DIRS = [{x:0, y:1}, {x:0, y:-1}, {x:1, y:0}, {x:-1, y:0}];

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
            lavaTimer: 0,
            netTimer: 0,
            handshakeInterval: null,
            isExtracting: false,
            autoPath: [], // For Auto-Explore
            chaseTargetId: null
        };
        this.database = new Database();
        this.playerData = { name: 'Player', gold: 0, class: 'Fighter' };
    }

    async init() {
        // 1. Load Configuration
        this.injectCSS();
        const configs = await this.assetLoader.loadAll();
        this.config = configs;

        // TEST OVERRIDE: Replace all enemies with Skeleton
        this.config.enemies = {
            'skeleton': {
                name: 'Skeleton',
                hp: 30,
                maxHp: 30,
                damage: 5,
                xp: 10
            }
        };
        
        // 2. Load Player Data
        this.playerData = (await this.database.getPlayer()) || { name: 'Player', gold: 0, extractions: 0 };

        // 3. Show Lobby
        this.setupLobby();

        // 4. Initialize Systems (Pre-allocation)
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
        await this.renderSystem.setAssetLoader(this.assetLoader);
        this.renderSystem.setGridSystem(this.gridSystem);

        this.combatSystem = new CombatSystem(configs.enemies);
        this.renderSystem.setCombatSystem(this.combatSystem);
        this.lootSystem = new LootSystem(configs.items);
        this.inputManager = new InputManager(configs.global);
        this.peerClient = new PeerClient(configs.net);
        this.syncManager = new SyncManager(configs.global);
        this.audioSystem = new AudioSystem();
        this.audioSystem.setAssetLoader(this.assetLoader);
        
        // 5. Check for Auto-Join URL
        // Check URL params for ?join=HOST_ID
        const urlParams = new URLSearchParams(window.location.search);
        const hostId = urlParams.get('join');
        if (hostId) {
            document.getElementById('room-code-input').value = hostId;
        }
    }

    injectCSS() {
        const style = document.createElement('style');
        style.innerHTML = `
            @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Lato:wght@400;700&display=swap');
            :root { --steel-dark: #1a1a1a; --steel-mid: #333333; --steel-light: #555555; --rust: #8b4513; --rust-light: #cd853f; --parchment: #e6d2b5; --parchment-dark: #c2a886; --text-dark: #2b1d0e; --text-light: #e0e0e0; --gold: #ffd700; }
            body { font-family: 'Lato', sans-serif; color: var(--text-light); margin: 0; overflow: hidden; background: #050505; }
            h1, h2, h3, button, .header-font { font-family: 'Cinzel', serif; }
            #ui-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10; }
            #ui-layer > * { pointer-events: auto; }
            button { background: linear-gradient(180deg, var(--steel-light), var(--steel-mid)); border: 2px solid var(--steel-dark); border-bottom: 4px solid var(--steel-dark); color: var(--parchment); padding: 10px 20px; font-size: 16px; font-weight: bold; text-transform: uppercase; cursor: pointer; border-radius: 4px; transition: transform 0.1s, filter 0.1s; box-shadow: 0 4px 6px rgba(0,0,0,0.5); text-shadow: 1px 1px 0 #000; }
            button:hover { filter: brightness(1.2); }
            button:active { transform: translateY(2px); border-bottom-width: 2px; }
            input, select { background: rgba(0, 0, 0, 0.6); border: 1px solid var(--steel-light); color: var(--parchment); padding: 10px; font-family: 'Lato', sans-serif; border-radius: 2px; }
            #lobby-screen { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 15px; background-color: #111; z-index: 100; }
            #lobby-screen h1 { font-size: 4rem; color: var(--rust-light); text-shadow: 0 0 10px var(--rust), 2px 2px 0 #000; margin-bottom: 20px; }
            #player-stats { font-size: 1.2rem; color: var(--gold); margin-bottom: 20px; background: rgba(0,0,0,0.7); padding: 5px 15px; border-radius: 4px; border: 1px solid var(--rust); }
            #btn-inventory-toggle { position: absolute; bottom: 25px !important; right: 25px !important; top: auto !important; left: auto !important; width: 80px; height: 80px; border-radius: 50%; background: radial-gradient(circle at 30% 30%, var(--rust-light), var(--rust)); border: 3px solid #3e2723; box-shadow: 0 5px 15px rgba(0,0,0,0.6), inset 0 0 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 0; }
            #btn-inventory-toggle svg { width: 40px; height: 40px; color: #f4e4bc; filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.8)); }
            #btn-inventory-toggle:hover { transform: scale(1.1) rotate(-5deg); }
            #inventory-modal, #ground-loot-modal { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--parchment); border: 6px solid var(--steel-mid); border-radius: 8px; padding: 20px; color: var(--text-dark); box-shadow: 0 0 0 2px var(--rust), 0 20px 50px rgba(0,0,0,0.9); min-width: 300px; max-width: 90%; }
            #inventory-grid, #ground-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 15px 0; background: rgba(0,0,0,0.1); padding: 10px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.2); }
            .inv-slot, .equip-slot { width: 48px; height: 48px; background: rgba(0,0,0,0.15); border: 1px solid rgba(0,0,0,0.3); border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.1s; }
            .inv-slot:hover, .equip-slot:hover { background: rgba(0,0,0,0.25); border-color: var(--rust); }
            #game-timer { position: absolute; top: 20px; left: 50%; transform: translateX(-50%); font-size: 24px; font-family: 'Cinzel', serif; font-weight: bold; text-shadow: 2px 2px 0 #000; background: rgba(0,0,0,0.6); padding: 5px 15px; border: 1px solid var(--steel-light); border-radius: 4px; }
            #room-code-display { position: absolute; top: 20px; right: 20px; font-family: 'Cinzel', serif; color: var(--text-light); padding: 5px 10px; background: transparent !important; }
            #loot-notification { position: absolute; top: 100px; left: 50%; transform: translateX(-50%); font-family: 'Cinzel', serif; color: var(--gold); font-size: 20px; text-shadow: 1px 1px 0 #000; pointer-events: none; transition: opacity 0.5s; opacity: 0; z-index: 20; }
            #stats-bar { position: absolute; top: 20px; left: 20px; display: flex; flex-direction: column; gap: 5px; font-family: 'Cinzel', serif; text-shadow: 1px 1px 0 #000; }
            #quick-slots-hud { position: absolute; bottom: 25px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; }
            .quick-slot-hud-item { width: 56px; height: 56px; background: rgba(0,0,0,0.7); border: 2px solid var(--steel-light); border-radius: 4px; position: relative; display: flex; align-items: center; justify-content: center; }
            .key-label { position: absolute; top: -8px; left: -8px; background: var(--rust); color: white; font-size: 10px; padding: 2px 5px; border-radius: 3px; border: 1px solid #000; }
            .hidden { display: none !important; }
        `;
        document.head.appendChild(style);
    }

    respawnAsMonster(entityId) {
        const types = Object.keys(this.config.enemies);
        const type = types[Math.floor(Math.random() * types.length)];
        const spawn = this.gridSystem.getSpawnPoint(false);
        
        this.gridSystem.addEntity(entityId, spawn.x, spawn.y);
        this.combatSystem.registerEntity(entityId, type, true); // isPlayer=true, team=monster
        
        if (this.state.isHost) {
             this.peerClient.send({ type: 'RESPAWN_MONSTER', payload: { id: entityId, type } });
        }
    }

    setupLobby() {
        const uiLayer = document.getElementById('ui-layer');
        const lobby = document.createElement('div');
        lobby.id = 'lobby-screen';
        
        // Set background image for main menu
        lobby.style.backgroundImage = "url('./assets/images/ui/bg.jpg')";
        lobby.style.backgroundSize = "cover";
        lobby.style.backgroundPosition = "center";
        lobby.style.backgroundRepeat = "no-repeat";

        lobby.innerHTML = `
            <h1>Cold Coin</h1>
            <div id="player-stats">Gold: ${this.playerData.gold} | Extractions: ${this.playerData.extractions || 0}</div>
            <input type="text" id="player-name" placeholder="Enter Name" value="${this.playerData.name}" />
            <select id="class-select">
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
        this.inputManager.on('click', (data) => this.handleMouseClick(data));
        this.inputManager.on('mousemove', (data) => this.handleMouseMove(data));
        this.audioSystem.resume(); // Unlock audio context on user interaction

        this.gameLoop = new GameLoop(
            (dt) => this.update(dt),
            (alpha) => this.render(alpha),
            this.config.global.tickRate
        );
        this.gameLoop.start();

        // Namespace the ID to avoid collisions on public PeerJS server
        const myPeerId = isHost ? `coldcoin-${this.generateRoomCode()}` : undefined;
        this.peerClient.init(myPeerId);
        this.peerClient.on('ready', (id) => {
            if (isHost) {
                const displayId = id.replace('coldcoin-', ''); // Strip prefix for display
                this.startHost(id);
                document.getElementById('room-code-display').innerText = `Room: ${displayId}`;
            } else if (hostId) {
                document.getElementById('room-code-display').innerText = `Room: ${hostId}`;
                this.peerClient.connect(`coldcoin-${hostId}`, { name: this.playerData.name, class: this.playerData.class });
            }
        });
    }

    setupUI() {
        // Reveal HUD elements
        ['room-code-display'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('hidden');
        });

        // Move Stats Bar to Inventory Modal
        const statsBar = document.getElementById('stats-bar');
        const invModal = document.getElementById('inventory-modal');
        if (statsBar && invModal) {
            const grid = document.getElementById('inventory-grid');
            if (grid) invModal.insertBefore(statsBar, grid);
            else invModal.prepend(statsBar);
            
            statsBar.style.position = 'static';
            statsBar.style.flexDirection = 'row';
            statsBar.style.justifyContent = 'space-between';
            statsBar.style.marginBottom = '10px';
            statsBar.style.borderBottom = '1px solid #555';
            statsBar.style.paddingBottom = '5px';
            statsBar.style.width = '100%';
            statsBar.classList.remove('hidden');
        }

        const uiLayer = document.getElementById('ui-layer');
        if (uiLayer && !document.getElementById('game-timer')) {
            const timer = document.createElement('div');
            timer.id = 'game-timer';
            uiLayer.appendChild(timer);
        }

        // Ensure Inventory Button exists and has the right icon
        let btnToggle = document.getElementById('btn-inventory-toggle');
        if (!btnToggle) {
            btnToggle = document.createElement('button');
            btnToggle.id = 'btn-inventory-toggle';
        }
        // Ensure button is always on the main UI layer, not inside the modal
        uiLayer.appendChild(btnToggle);
        btnToggle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>`;

        // Inventory Toggles
        const modal = document.getElementById('inventory-modal');
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
        this.setupCanvasDrop();
        this.setupSlotDrop(document.getElementById('slot-weapon'), 'weapon');
        this.setupSlotDrop(document.getElementById('slot-armor'), 'armor');

        // Settings Modal
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) {
            document.getElementById('btn-resume').onclick = () => this.toggleSettingsMenu();
            document.getElementById('btn-settings').onclick = () => alert("Settings coming soon!");
            document.getElementById('btn-quit').onclick = () => location.reload();
        }

        this.createInteractionUI();
    }

    createInteractionUI() {
        const uiLayer = document.getElementById('ui-layer') || document.body;

        // Tooltip
        if (!document.getElementById('game-tooltip')) {
            const tooltip = document.createElement('div');
            tooltip.id = 'game-tooltip';
            Object.assign(tooltip.style, {
                position: 'absolute',
                padding: '8px',
                background: 'rgba(10, 10, 10, 0.9)',
                color: '#eee',
                border: '1px solid #444',
                borderRadius: '4px',
                pointerEvents: 'none',
                display: 'none',
                zIndex: '2000',
                fontSize: '12px',
                fontFamily: 'monospace',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 4px rgba(0,0,0,0.5)'
            });
            uiLayer.appendChild(tooltip);
        }

        // Context Menu
        if (!document.getElementById('game-context-menu')) {
            const menu = document.createElement('div');
            menu.id = 'game-context-menu';
            Object.assign(menu.style, {
                position: 'absolute',
                background: '#1a1a1a',
                border: '1px solid #555',
                minWidth: '140px',
                zIndex: '2001',
                display: 'none',
                flexDirection: 'column',
                boxShadow: '0 4px 6px rgba(0,0,0,0.5)'
            });
            uiLayer.appendChild(menu);

            // Close menu on global click
            window.addEventListener('click', () => {
                menu.style.display = 'none';
            });
        }
    }

    setupCanvasDrop() {
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
    }

    setupSlotDrop(element, slotName) {
        if (!element) return;
        element.addEventListener('dragover', (e) => e.preventDefault());
        element.addEventListener('drop', (e) => {
            e.preventDefault();
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            // Use passed slotName or dataset fallback
            const targetSlot = slotName || element.dataset.slot;
            if (data && data.itemId) {
                this.handleEquipItem(data.itemId, targetSlot);
            }
        });
    }

    handleDropItem(itemId, source) {
        // Logic to drop item on the floor
        // 1. Remove from inventory/equipment
        if (!this.state.isHost) {
            this.peerClient.send({ type: 'DROP_ITEM', payload: { itemId, source } });
            return;
        }

        let count = 1;
        if (source === 'inventory') {
            count = this.lootSystem.removeItemFromInventory(this.state.myId, itemId);
        } else {
            const item = this.lootSystem.removeEquipment(this.state.myId, source);
            if (item) count = item.count;
            else count = 0;
        }

        // 2. Spawn in world (Host authoritative, so send intent if client)
        const pos = this.gridSystem.entities.get(this.state.myId);
        if (pos) {
            if (this.state.isHost) {
                if (count > 0) this.lootSystem.spawnDrop(pos.x, pos.y, itemId, count);
            } else {
                console.warn("Client drop not fully implemented over network yet");
            }
        }
        this.renderInventory();
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
            
            // Bind drag events for new slots only
            this.setupSlotDrop(document.getElementById('slot-quick1'), 'quick1');
            this.setupSlotDrop(document.getElementById('slot-quick2'), 'quick2');
            this.setupSlotDrop(document.getElementById('slot-quick3'), 'quick3');
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
                    this.renderInventory(); // Update UI for item pickup
                } else if (this.state.isHost) {
                    // If host processing for client, send gold update
                    this.peerClient.send({ type: 'UPDATE_GOLD', payload: { id: entityId, amount: result.gold } });
                }
            }

            // Play sound for specific player
            if (entityId === this.state.myId) {
                this.audioSystem.play('pickup');
                this.updateQuickSlotUI();
                const goldText = result.gold > 0 ? ` + ${result.gold}g` : '';
                const itemName = this.getItemName(result.itemId);
                this.showNotification(`${itemName}${goldText}`);
                this.renderSystem.addFloatingText(this.gridSystem.entities.get(entityId).x, this.gridSystem.entities.get(entityId).y, `+${itemName}`, '#FFD700');
            } else {
                // Notify client
                this.peerClient.send({ type: 'LOOT_SUCCESS', payload: { id: entityId } });
                if (this.state.isHost) this.sendInventoryUpdate(entityId);
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
            // Do NOT update room-code-display here, as it shows the internal UUID for clients
        });

        this.peerClient.on('close', (id) => {
            if (this.state.isHost) {
                console.log(`Player ${id} disconnected`);
                this.gridSystem.removeEntity(id);
                this.combatSystem.stats.delete(id);
                this.checkGameOver();
            }
        });

        // Combat Events (Local & Networked)
        this.combatSystem.on('damage', ({ targetId, amount, currentHp, sourceId, options }) => {
            // Update UI if it's me
            if (targetId === this.state.myId) {
                const hpEl = document.getElementById('hp-val');
                if (hpEl) hpEl.innerText = Math.max(0, currentHp);
                this.renderSystem.triggerShake(5, 200); // Screen shake on damage
                this.audioSystem.play('hit', this.gridSystem.entities.get(targetId).x, this.gridSystem.entities.get(targetId).y);
            }

            // Floating Damage Text
            const pos = this.gridSystem.entities.get(targetId);
            if (pos) {
                const color = amount > 0 ? '#ff4444' : '#44ff44';
                let text = Math.abs(amount).toString();
                
                if (options && options.isCrit) {
                    text += "!";
                }

                this.renderSystem.addFloatingText(pos.x, pos.y, text, color);
                
                // Broadcast to clients
                if (this.state.isHost) {
                    this.peerClient.send({ type: 'FLOAT_TEXT', payload: { x: pos.x, y: pos.y, text, color } });
                }
            }

            // Visual Feedback (Flash, Recoil, Blood)
            this.renderSystem.triggerDamage(targetId, sourceId);

            // If Host, broadcast HP update to all clients
            if (this.state.isHost) {
                this.peerClient.send({ type: 'UPDATE_HP', payload: { id: targetId, hp: currentHp } });
            }
        });

        this.combatSystem.on('death', ({ entityId, killerId, stats }) => {
            console.log(`${entityId} killed by ${killerId}`);
            
            // Capture position before removal for loot drop
            const deathPos = this.gridSystem.entities.get(entityId);
            const deathX = deathPos ? deathPos.x : 0;
            const deathY = deathPos ? deathPos.y : 0;

            this.gridSystem.removeEntity(entityId);
            this.renderSystem.triggerDeath(entityId);
            this.audioSystem.play('death', deathX, deathY);
            
            if (this.state.isHost) {
                // Award Gold
                if (!stats.isPlayer && stats.team === 'monster' && killerId) {
                    const reward = Math.floor(Math.random() * 4) + 2; // 2-5 gold
                    if (killerId === this.state.myId) {
                        this.playerData.gold += reward;
                        this.updateGoldUI();
                        this.database.savePlayer({ gold: this.playerData.gold });
                        this.showNotification(`+${reward}g`);
                    } else {
                        this.peerClient.send({ type: 'UPDATE_GOLD', payload: { id: killerId, amount: reward } });
                    }
                }

                this.peerClient.send({ type: 'ENTITY_DEATH', payload: { id: entityId } });
                
                // 1. Spawn Loot
                // Drop all items in a bag at the location of death
                // Use captured death coordinates
                let dropX = deathX;
                let dropY = deathY;
                
                // Fallback if position was somehow invalid
                if (!deathPos && killerId) {
                    const kPos = this.gridSystem.entities.get(killerId);
                    if (kPos) { dropX = kPos.x; dropY = kPos.y; }
                }

                const items = this.lootSystem.getAllItems(entityId);
                this.lootSystem.createLootBag(dropX, dropY, items);
                
                // 2. Monster Mechanic: Respawn Player as Monster
                if (stats && stats.isPlayer) {
                    setTimeout(() => {
                        this.respawnAsMonster(entityId);
                    }, 3000);
                } else {
                    // Test Mode: Respawn AI Monster
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
                // Host Logic: Receive Inputs
                if (data.type === 'INPUT') {
                    this.processPlayerInput(sender, data.payload);
                }
                if (data.type === 'INTERACT_LOOT') {
                    const loot = this.lootSystem.worldLoot.get(data.payload.lootId);
                    if (loot) this.processLootInteraction(sender, loot);
                }
                if (data.type === 'HELLO') {
                    // Client is ready, send the world state
                    console.log(`Client ${sender} said HELLO. Sending World.`);
                    this.peerClient.sendTo(sender, {
                        type: 'INIT_WORLD',
                        payload: { grid: this.gridSystem.grid }
                    });
                }
                if (data.type === 'EQUIP_ITEM') {
                    this.handleEquipItem(data.payload.itemId, data.payload.slot); // Host executes locally for client
                    this.sendInventoryUpdate(sender);
                }
                if (data.type === 'DROP_ITEM') {
                    this.handleDropItem(data.payload.itemId, data.payload.source); // Host executes locally for client
                    this.sendInventoryUpdate(sender);
                }
            } else {
                // Client Logic: Receive State
                if (data.type === 'SNAPSHOT') {
                    this.syncManager.addSnapshot(data.payload);
                } else if (data.type === 'INIT_WORLD') {
                    console.log("Client: Received INIT_WORLD", data.payload);
                    this.gridSystem.setGrid(data.payload.grid);
                    
                    // Stop the handshake retry loop
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
                    this.showGameOver(data.payload.message);
                } else if (data.type === 'PLAYER_EXTRACTED') {
                    console.log(`Player ${data.payload.id} extracted!`);
                } else if (data.type === 'PORTAL_SPAWN') {
                    this.gridSystem.setTile(data.payload.x, data.payload.y, 9);
                    this.showNotification("The Extraction Portal has opened!");
                    this.audioSystem.play('pickup', data.payload.x, data.payload.y);
                } else if (data.type === 'RESPAWN_MONSTER') {
                    if (data.payload.id === this.state.myId) {
                        this.showNotification(`Respawned as ${data.payload.type}`);
                    }
                } else if (data.type === 'EFFECT') {
                    this.renderSystem.addEffect(data.payload.x, data.payload.y, data.payload.type);
                }

                if (data.type === 'FLOAT_TEXT') {
                    this.renderSystem.addFloatingText(data.payload.x, data.payload.y, data.payload.text, data.payload.color);
                }
                
                if (data.type === 'SPAWN_PROJECTILE') {
                    // We use this event primarily for Audio now.
                    // Visuals are handled via Snapshot Sync.
                    // this.state.projectiles.push(data.payload); 
                    // ^ Removed to prevent duplication with SyncManager
                    this.audioSystem.play('attack', data.payload.x, data.payload.y);
                }

                if (data.type === 'UPDATE_GOLD') {
                    if (data.payload.id === this.state.myId) {
                        this.playerData.gold += data.payload.amount;
                        this.updateGoldUI();
                        this.database.savePlayer({ gold: this.playerData.gold });
                        this.showNotification(`+${data.payload.amount}g`);
                    }
                }

                if (data.type === 'LOOT_SUCCESS') {
                    if (data.payload.id === this.state.myId) {
                        this.audioSystem.play('pickup', 0, 0); // Local
                        this.renderInventory();
                        this.updateQuickSlotUI();
                        // We don't have the item ID here easily without sending it in payload
                        // For now, just generic sound/update is okay, or we can update protocol later.
                        // The prompt asked for notification on looting from chest, which usually happens locally or via direct interaction response.
                    }
                }

                if (data.type === 'UPDATE_INVENTORY') {
                    // Direct injection into LootSystem (assuming Map structure based on other Systems)
                    if (this.lootSystem.inventories) this.lootSystem.inventories.set(this.state.myId, data.payload.inventory);
                    if (this.lootSystem.equipment) this.lootSystem.equipment.set(this.state.myId, data.payload.equipment);
                    this.renderInventory();
                }
            }
        });

        this.peerClient.on('connected', ({ peerId, metadata }) => {
            console.log(`Connected to ${peerId}`, metadata);
            if (this.state.isHost) {
                // Spawn them
                const spawn = this.gridSystem.getSpawnPoint(true);
                this.gridSystem.addEntity(peerId, spawn.x, spawn.y);
                this.combatSystem.registerEntity(peerId, 'player', true, metadata.class || 'Fighter', metadata.name || 'Unknown');
            } else {
                // Client: Start Handshake Retry Loop
                // Send HELLO every 500ms until INIT_WORLD is received
                console.log("Client: Connected. Starting Handshake...");
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
        
        // Spawn Host
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
            this.toggleSettingsMenu();
            return;
        }
        if (intent.type === 'TOGGLE_INVENTORY') {
            const modal = document.getElementById('inventory-modal');
            if (modal) {
                modal.classList.toggle('hidden');
                if (!modal.classList.contains('hidden')) this.renderInventory();
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
        
        // Close Context Menu on any canvas interaction
        const ctxMenu = document.getElementById('game-context-menu');
        if (ctxMenu) ctxMenu.style.display = 'none';

        if (data.button === 2) {
            this.handleContextMenu(data);
            return;
        }

        if (data.button !== 0) return; // Only Left Click for rest

        const cam = this.renderSystem.camera;
        const ts = this.config.global.tileSize || 48;
        const scale = this.renderSystem.scale || 1;
        const gridX = Math.floor(((data.x / scale) + cam.x) / ts);
        const gridY = Math.floor(((data.y / scale) + cam.y) / ts);

        this.processClickLogic(gridX, gridY, data.shift);
    }

    processClickLogic(gridX, gridY, shift, isContinuous = false) {
        const pos = this.gridSystem.entities.get(this.state.myId);
        if (!pos) return;

        let targetId = this.gridSystem.getEntityAt(gridX, gridY);
        const loot = this.lootSystem.getLootAt(gridX, gridY);

        // Smart Targeting (Continuous Hold Only)
        // Scans a radius around the cursor to lock onto enemies, making chasing easier.
        if (isContinuous) {
            const bestId = this.findBestTarget(gridX, gridY, 3); // 3 Tile Radius
            if (bestId) {
                targetId = bestId;
            }
        }

        // Determine if this is an Attack Command
        // Shift forces attack. Clicking a hostile entity implies attack.
        const isHostile = targetId && targetId !== this.state.myId;

        // Melee Chase Logic
        if (isHostile && !shift) {
            const equip = this.lootSystem.getEquipment(this.state.myId);
            const weaponId = equip.weapon;
            const config = weaponId ? this.lootSystem.getItemConfig(weaponId) : null;
            const isRanged = config && config.range > 1;

            if (!isRanged) {
                const dist = Math.max(Math.abs(gridX - pos.x), Math.abs(gridY - pos.y));
                if (dist > 1) {
                    // Move-to-Attack
                    const path = this.gridSystem.findPath(pos.x, pos.y, gridX, gridY);
                    if (path && path.length > 0) {
                        path.pop(); // Remove target tile
                        this.state.autoPath = path;
                        this.state.chaseTargetId = targetId;
                    }
                    return; 
                }
            }
        }

        // Determine if this is an Attack Command
        // Shift forces attack. Clicking a hostile entity implies attack.
        const isAttack = shift || isHostile;

        if (isAttack) {
            // Attack logic is handled via polling in update() to support holding
            this.state.autoPath = [];
            this.state.chaseTargetId = null;
            
            // Generate Attack Intent directly here
            // We need a projId for prediction consistency if ranged
            const projId = `proj_${Date.now()}_${this.state.myId}`;
            this.handleInput({ type: 'TARGET_ACTION', x: gridX, y: gridY, projId: projId });
            return; 
        }

        // Move / Interact Logic (No Shift, No Hostile)
        if (loot) {
            // Object: Pathfind + Interact
            const path = this.gridSystem.findPath(pos.x, pos.y, gridX, gridY);
            if (path && path.length > 0) {
                // Remove last node (the target itself) to stop adjacent
                path.pop(); 
                this.state.autoPath = path;
            }
        } else {
            // Terrain: Pathfind
            let path = this.gridSystem.findPath(pos.x, pos.y, gridX, gridY);
            
            // Fallback: Straight line attempt if pathfinding failed (e.g. target is wall)
            if (!path) {
                path = this.getStraightPath(pos.x, pos.y, gridX, gridY);
            }

            if (path) {
                this.state.autoPath = path;
            } else {
                // Invalid path (e.g. wall), stop moving
                this.state.autoPath = [];
            }
        }
    }

    findBestTarget(cursorX, cursorY, radius) {
        const myStats = this.combatSystem.getStats(this.state.myId);
        if (!myStats) return null;

        let bestId = null;
        let minDst = radius * radius; // Squared distance comparison

        for (const [id, pos] of this.gridSystem.entities) {
            if (id === this.state.myId) continue;

            const stats = this.combatSystem.getStats(id);
            if (!stats) continue;

            // Hostility Check
            let isHostile = false;
            if (myStats.team === 'monster') {
                // Monsters only attack players
                if (stats.team === 'player') isHostile = true;
            } else {
                // Players attack monsters and other players (PvP)
                if (stats.team === 'monster' || stats.team === 'player') isHostile = true;
            }
            
            if (!isHostile) continue;

            const dx = pos.x - cursorX;
            const dy = pos.y - cursorY;
            const dstSq = dx*dx + dy*dy;

            if (dstSq <= minDst) {
                minDst = dstSq;
                bestId = id;
            }
        }
        return bestId;
    }

    getStraightPath(x0, y0, x1, y1) {
        const path = [];
        let x = Math.round(x0);
        let y = Math.round(y0);
        const tx = Math.round(x1);
        const ty = Math.round(y1);

        const dx = Math.abs(tx - x);
        const dy = Math.abs(ty - y);
        const sx = (x < tx) ? 1 : -1;
        const sy = (y < ty) ? 1 : -1;
        let err = dx - dy;

        let iterations = 0;
        const maxIterations = 100; 

        while (true) {
            if (x === tx && y === ty) break;
            if (iterations++ > maxIterations) break;

            let e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x += sx; }
            if (e2 < dx) { err += dx; y += sy; }

            path.push({ x, y });
        }
        return path;
    }

    handleMouseMove(data) {
        // Throttle DOM updates to ~20fps to prevent layout thrashing
        const now = Date.now();
        if (this.lastTooltipUpdate && now - this.lastTooltipUpdate < 50) return;
        this.lastTooltipUpdate = now;

        const tooltip = document.getElementById('game-tooltip');
        if (!tooltip) return;

        const cam = this.renderSystem.camera;
        const ts = this.config.global.tileSize || 64;
        const scale = this.renderSystem.scale || 1;
        const gridX = Math.floor(((data.x / scale) + cam.x) / ts);
        const gridY = Math.floor(((data.y / scale) + cam.y) / ts);

        let content = [];

        // 1. Entity Data
        const entityId = this.gridSystem.getEntityAt(gridX, gridY);
        if (entityId) {
            const stats = this.combatSystem.getStats(entityId);
            if (stats) {
                const name = stats.name || stats.type;
                const hpPercent = stats.maxHp > 0 ? Math.floor((stats.hp / stats.maxHp) * 100) : 0;
                const color = stats.team === 'monster' ? '#ff5555' : (entityId === this.state.myId ? '#55ff55' : '#55aaff');
                content.push(`<div style="font-weight:bold; color:${color}">${name}</div>`);
                content.push(`<div>HP: ${Math.ceil(stats.hp)}/${stats.maxHp} (${hpPercent}%)</div>`);
            }
        }

        // 2. Loot Data
        const items = this.lootSystem.getItemsAt(gridX, gridY);
        if (items.length > 0) {
            if (content.length > 0) content.push('<div style="height:1px; background:#444; margin:4px 0;"></div>');
            items.forEach(item => {
                const config = this.lootSystem.getItemConfig(item.itemId);
                const name = config ? config.name : item.itemId;
                content.push(`<div style="color:#ffd700">📦 ${name} ${item.count > 1 ? `x${item.count}` : ''}</div>`);
            });
        }

        if (content.length > 0) {
            tooltip.innerHTML = content.join('');
            tooltip.style.display = 'block';
            // Offset slightly to not cover cursor
            tooltip.style.left = `${data.x + 16}px`;
            tooltip.style.top = `${data.y + 16}px`;
        } else {
            tooltip.style.display = 'none';
        }
    }

    handleContextMenu(data) {
        const menu = document.getElementById('game-context-menu');
        if (!menu) return;

        menu.innerHTML = '';
        const cam = this.renderSystem.camera;
        const ts = this.config.global.tileSize || 48;
        const scale = this.renderSystem.scale || 1;
        const gridX = Math.floor(((data.x / scale) + cam.x) / ts);
        const gridY = Math.floor(((data.y / scale) + cam.y) / ts);

        const actions = [];

        // Entity Actions
        const entityId = this.gridSystem.getEntityAt(gridX, gridY);
        if (entityId && entityId !== this.state.myId) {
            actions.push({
                label: '⚔️ Attack',
                action: () => this.handleInput({ type: 'TARGET_ACTION', x: gridX, y: gridY })
            });
        }

        // Movement (if walkable)
        if (this.gridSystem.isWalkable(gridX, gridY)) {
            actions.push({
                label: '👣 Move Here',
                action: () => {
                    const pos = this.gridSystem.entities.get(this.state.myId);
                    if (pos) {
                        const path = this.gridSystem.findPath(pos.x, pos.y, gridX, gridY);
                        if (path) this.state.autoPath = path;
                    }
                }
            });
        }

        if (actions.length === 0) return;

        actions.forEach(item => {
            const el = document.createElement('div');
            el.innerText = item.label;
            Object.assign(el.style, {
                padding: '10px 15px',
                cursor: 'pointer',
                color: '#eee',
                borderBottom: '1px solid #333',
                fontSize: '14px',
                fontFamily: 'sans-serif'
            });
            el.onmouseover = () => el.style.background = '#333';
            el.onmouseout = () => el.style.background = 'transparent';
            el.onclick = (e) => {
                e.stopPropagation(); // Prevent window click from firing immediately
                item.action();
                menu.style.display = 'none';
            };
            menu.appendChild(el);
        });

        menu.style.left = `${data.x}px`;
        menu.style.top = `${data.y}px`;
        menu.style.display = 'flex';
    }

    toggleSettingsMenu() {
        const modal = document.getElementById('settings-modal');
        if (modal) modal.classList.toggle('hidden');
    }

    executeAction(intent) {
        const cooldown = this.config.global.globalCooldownMs || 250;
        this.state.nextActionTime = Date.now() + cooldown;
        this.state.actionBuffer = null;

        // Client-Side Prediction: Move immediately
        if (!this.state.isHost && intent.type === 'MOVE') {
            // We process the input locally to update gridSystem immediately
            this.processPlayerInput(this.state.myId, intent);
        }

        if (this.state.isHost) {
            this.processPlayerInput(this.state.myId, intent);
        } else {
            this.peerClient.send({ type: 'INPUT', payload: intent });
        }
    }

    processPlayerInput(entityId, intent) {
        if (!intent || !intent.type) return; // Safeguard against malformed inputs

        // Host-side Cooldown Enforcement
        let stats = this.combatSystem.getStats(entityId);

        // Client-Side Prediction Fix: Ensure local stats exist for cooldown tracking
        if (!stats && entityId === this.state.myId && !this.state.isHost) {
            this.combatSystem.registerEntity(entityId, 'player', true, this.playerData.class, this.playerData.name);
            stats = this.combatSystem.getStats(entityId);
        }

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
        
        // Shift Modifier: Facing Update Only
        if (intent.type === 'MOVE' && intent.shift) {
            if (pos) {
                pos.facing = intent.direction;
                
                // Check for Ranged Weapon
                const equip = this.lootSystem.getEquipment(entityId);
                const weaponId = equip.weapon;
                const config = weaponId ? this.lootSystem.getItemConfig(weaponId) : null;

                if (config && config.range > 1) {
                    // Fire Projectile
                    const proj = { 
                        id: `proj_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        x: pos.x, 
                        y: pos.y, 
                        vx: intent.direction.x, 
                        vy: intent.direction.y, 
                        speed: 15, 
                        ownerId: entityId, 
                        damage: config.damage 
                    };
                    this.state.projectiles.push(proj);
                    this.peerClient.send({ type: 'SPAWN_PROJECTILE', payload: proj });
                    this.audioSystem.play('attack', pos.x, pos.y);
                } else {
                    // Melee
                    const tx = pos.x + intent.direction.x;
                    const ty = pos.y + intent.direction.y;
                    const targetId = this.gridSystem.getEntityAt(tx, ty);
                    
                    if (targetId) {
                        this.performAttack(entityId, targetId);
                    } else {
                        // Whiff
                        this.renderSystem.triggerAttack(entityId);
                        this.renderSystem.addEffect(tx, ty, 'slash');
                        this.peerClient.send({ type: 'EFFECT', payload: { x: tx, y: ty, type: 'slash' } });
                        this.audioSystem.play('swing', pos.x, pos.y);
                    }
                }
            }
            return; // Suppress position update
        }

        if (pos && intent.type === 'MOVE') {
            const cost = this.gridSystem.getMovementCost(pos.x + intent.direction.x, pos.y + intent.direction.y);
            cooldown *= cost;
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
            // Capture start position for effects (before mutation)
            const startX = pos ? pos.x : 0;
            const startY = pos ? pos.y : 0;

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
            
            // Wall Sliding Logic: If diagonal move hits wall, try cardinal components
            if (!result.success && result.collision === 'wall') {
                if (intent.direction.x !== 0 && intent.direction.y !== 0) {
                    // Try sliding along X
                    const resX = this.gridSystem.moveEntity(entityId, intent.direction.x, 0);
                    if (resX.success) {
                        // Mutate result to the successful slide
                        Object.assign(result, resX);
                    } else {
                        // Try sliding along Y
                        const resY = this.gridSystem.moveEntity(entityId, 0, intent.direction.y);
                        if (resY.success) {
                            Object.assign(result, resY);
                        }
                    }
                }
            }

            if (result.success) {
                if (entityId === this.state.myId) {
                    this.audioSystem.play('step', pos.x, pos.y);
                    this.renderSystem.addEffect(startX, startY, 'dust'); // Dust particle
                }
                
                // Check for Extraction
                // Round coordinates to ensure valid grid access (prevent float indexing)
                if (pos && this.gridSystem.grid[Math.round(pos.y)][Math.round(pos.x)] === 9) {
                    this.handleExtraction(entityId);
                }
            } else if (result.collision !== 'wall') {
                // Trigger Bump for entity collision too
                this.renderSystem.triggerBump(entityId, intent.direction);

                // Bump Attack
                // Check Friendly Fire for Monsters
                const attackerStats = this.combatSystem.getStats(entityId);
                const targetStats = this.combatSystem.getStats(result.collision);
                
                let friendlyFire = false;
                if (attackerStats && targetStats && attackerStats.team === 'monster' && targetStats.team === 'monster') {
                    friendlyFire = true;
                }

                if (!friendlyFire) {
                    this.performAttack(entityId, result.collision);
                }
            } else if (result.collision === 'wall') {
                // Trigger Bump for wall
                this.renderSystem.triggerBump(entityId, intent.direction);
                if (entityId === this.state.myId) {
                    this.audioSystem.play('bump', pos.x, pos.y);
                }
            }
        }
        
        if (intent.type === 'INTERACT') {
            // Context-Sensitive Interact (Space/Enter)
            if (pos) {
                const tx = pos.x + pos.facing.x;
                const ty = pos.y + pos.facing.y;
                // 1. Check for Entity (Monster/Player) -> Attack
                const targetId = this.gridSystem.getEntityAt(tx, ty);
                if (targetId) {
                    this.performAttack(entityId, targetId);
                    return;
                }

                // 2. Check for Loot/Chest -> Interact
                const items = this.lootSystem.getItemsAt(tx, ty);
                if (items.length > 0) {
                    if (entityId === this.state.myId) this.handleInteractWithLoot(items[0]);
                    else this.processLootInteraction(entityId, items[0]);
                    return;
                }

                // 3. Nothing -> Whiff Attack
                this.renderSystem.triggerAttack(entityId);
                this.renderSystem.addEffect(tx, ty, 'slash');
                this.peerClient.send({ type: 'EFFECT', payload: { x: tx, y: ty, type: 'slash' } });
                this.audioSystem.play('swing', pos.x, pos.y);
            }
        }

        if (intent.type === 'PICKUP') { // Legacy R key
            const stats = this.combatSystem.getStats(entityId);
            
            // Monster Restriction: Cannot pickup items
            if (stats && stats.team === 'monster') {
                return;
            }

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

        if (intent.type === 'TARGET_ACTION') {
            // Mouse-based Attack Logic (Moved from handleMouseClick)
            const gridX = intent.x;
            const gridY = intent.y;
            
            // 1. Get Weapon Config
            const equip = this.lootSystem.getEquipment(entityId);
            const weaponId = equip.weapon;
            const config = weaponId ? this.lootSystem.getItemConfig(weaponId) : null;
            const isRanged = config && config.range > 1;

            // 2. Calculate Vector & Facing
            const dx = gridX - pos.x;
            const dy = gridY - pos.y;
            
            // Avoid division by zero if clicking self
            if (dx !== 0 || dy !== 0) {
                const angle = Math.atan2(dy, dx);
                const octant = Math.round(8 * angle / (2 * Math.PI) + 8) % 8;
                const dirs = [
                    {x:1, y:0}, {x:1, y:1}, {x:0, y:1}, {x:-1, y:1},
                    {x:-1, y:0}, {x:-1, y:-1}, {x:0, y:-1}, {x:1, y:-1}
                ];
                pos.facing = dirs[octant];
            }

            if (isRanged) {
                // Ranged: Fire at specific coordinates
                const mag = Math.sqrt(dx*dx + dy*dy);
                const vx = mag === 0 ? pos.facing.x : dx/mag;
                const vy = mag === 0 ? pos.facing.y : dy/mag;

                // Use ID from intent if provided (prediction), else generate
                const projId = intent.projId || `proj_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

                const proj = { 
                    id: projId,
                    x: pos.x, 
                    y: pos.y, 
                    vx: vx, 
                    vy: vy, 
                    speed: 15, 
                    ownerId: entityId, 
                    damage: config ? config.damage : 5
                };
                this.state.projectiles.push(proj);
                this.peerClient.send({ type: 'SPAWN_PROJECTILE', payload: proj });
                this.audioSystem.play('attack', pos.x, pos.y);
                this.renderSystem.triggerAttack(entityId);
            } else {
                // Melee: Attack adjacent tile in facing direction
                const adjX = pos.x + pos.facing.x;
                const adjY = pos.y + pos.facing.y;
                const adjId = this.gridSystem.getEntityAt(adjX, adjY);

                if (adjId) {
                    this.performAttack(entityId, adjId);
                } else {
                    // Whiff
                    this.renderSystem.triggerAttack(entityId);
                    this.renderSystem.addEffect(adjX, adjY, 'slash');
                    this.peerClient.send({ type: 'EFFECT', payload: { x: adjX, y: adjY, type: 'slash' } });
                    this.audioSystem.play('swing', pos.x, pos.y);
                }
            }
        }

        // Legacy Attack Intent (if triggered by other means)
        if (intent.type === 'ATTACK') {
            const attacker = this.gridSystem.entities.get(entityId);
            if (attacker) {
                const targetX = attacker.x + attacker.facing.x;
                const targetY = attacker.y + attacker.facing.y;
                const targetId = this.gridSystem.getEntityAt(targetX, targetY);

                if (targetId) {
                    // Friendly Fire Check for Monsters
                    const attackerStats = this.combatSystem.getStats(entityId);
                    const targetStats = this.combatSystem.getStats(targetId);
                    if (attackerStats && targetStats && attackerStats.team === 'monster' && targetStats.team === 'monster') {
                        return; // Monsters cannot hurt monsters
                    }
                    this.performAttack(entityId, targetId);
                } else {
                    // Whiff (Attack air)
                    this.renderSystem.addEffect(targetX, targetY, 'slash');
                    this.peerClient.send({ type: 'EFFECT', payload: { x: targetX, y: targetY, type: 'slash' } });
                    this.audioSystem.play('swing', attacker.x, attacker.y);
                }
            }
        }

        if (intent.type === 'USE_ABILITY_SLOT') {
            // Map slots 0-2 to quick1-3
            const quickSlot = `quick${intent.slot + 1}`;
            const effect = this.lootSystem.consumeItem(entityId, quickSlot);
            if (effect) {
                if (effect.effect === 'heal') {
                    const stats = this.combatSystem.getStats(entityId);
                    if (stats) {
                        stats.hp = Math.min(stats.maxHp, stats.hp + effect.value);
                        // Emit damage event with negative amount to signal heal? Or just update HP.
                        // Emit negative amount to trigger green floating text
                        this.combatSystem.emit('damage', { targetId: entityId, amount: -effect.value, sourceId: entityId, currentHp: stats.hp });
                        this.audioSystem.play('pickup', this.gridSystem.entities.get(entityId).x, this.gridSystem.entities.get(entityId).y);
                        this.renderInventory();
                        this.updateQuickSlotUI();
                    }
                }
            }
        }

        if (intent.type === 'USE_ITEM') { // Legacy
            // ... existing logic merged above or kept for compatibility
        }

        // Legacy F key or mapped ability
        if (intent.type === 'ABILITY') {
            const result = this.combatSystem.useAbility(entityId);
            if (result) {
                // Sync visual effects if needed
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
            // Simple BFS to find nearest unexplored tile
            // We need access to RenderSystem.explored
            const start = this.gridSystem.entities.get(entityId);
            if (!start) return;

            // This is a heavy operation, usually done in a WebWorker or time-sliced.
            // For this implementation, we'll do a limited BFS.
            const target = this.findNearestUnexplored(start.x, start.y);
            if (target) {
                const path = this.gridSystem.findPath(start.x, start.y, target.x, target.y);
                if (path) this.state.autoPath = path;
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
                
                const proj = { 
                    id: `proj_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    x: attackerPos.x, 
                    y: attackerPos.y, 
                    vx: dx/mag, 
                    vy: dy/mag, 
                    speed: 15, 
                    ownerId: attackerId, 
                    damage: config.damage 
                };
                
                this.state.projectiles.push(proj);
                this.peerClient.send({ type: 'SPAWN_PROJECTILE', payload: proj });
                this.audioSystem.play('attack', attackerPos.x, attackerPos.y);
                return;
            }
        }

        // Trigger Visual Animation
        this.renderSystem.triggerAttack(attackerId);

        // Visual Feedback
        this.renderSystem.addEffect(targetPos.x, targetPos.y, 'slash');
        this.peerClient.send({ type: 'EFFECT', payload: { x: targetPos.x, y: targetPos.y, type: 'slash' } });
        
        // Audio
        this.audioSystem.play('attack', attackerId === this.state.myId ? this.gridSystem.entities.get(attackerId).x : targetPos.x, targetPos.y);

        const stats = this.combatSystem.getStats(attackerId);
        let damage = stats ? stats.damage : 5;
        // Crit Logic (15% Chance)
        const isCrit = Math.random() < 0.15;
        if (isCrit) damage = Math.floor(damage * 1.5);

        this.combatSystem.applyDamage(targetId, damage, attackerId, { isCrit });
    }

    handleExtraction(entityId) {
        console.log(`Processing extraction for ${entityId}`);
        // 1. Save Data
        const stats = this.combatSystem.getStats(entityId);
        const name = stats ? (stats.name || 'Unknown') : 'Unknown';
        if (entityId === this.state.myId) {
            this.playerData.gold += 100; // Flat reward for now
            this.state.isExtracting = true;
            this.playerData.extractions = (this.playerData.extractions || 0) + 1;
            this.database.savePlayer({ gold: this.playerData.gold, extractions: this.playerData.extractions });
            this.updateGoldUI();
        }
        
        // 2. Remove from World
        this.gridSystem.removeEntity(entityId);
        this.combatSystem.stats.delete(entityId);

        // 3. Notify
        if (this.state.isHost) {
            this.peerClient.send({ type: 'PLAYER_EXTRACTED', payload: { id: entityId } });

            this.checkGameOver();
            
            // Respawn as Monster
            setTimeout(() => {
                this.respawnAsMonster(entityId);
            }, 3000);
        }

        if (entityId === this.state.myId) {
            this.showNotification("EXTRACTED! Respawning as Monster...");
        }
    }

    checkGameOver() {
        if (!this.state.isHost) return;

        let survivorCount = 0;
        for (const [id, stats] of this.combatSystem.stats) {
            if (stats.isPlayer && stats.team === 'player') {
                survivorCount++;
            }
        }

        if (survivorCount === 0) {
            const msg = "All Survivors Eliminated";
            this.peerClient.send({ type: 'GAME_OVER', payload: { message: msg } });
            this.showGameOver(msg);
        }
    }

    findNearestUnexplored(startX, startY) {
        const visited = new Set();
        const queue = [{x: Math.round(startX), y: Math.round(startY)}];
        const explored = this.renderSystem.explored; // Set of "x,y"
        
        let loops = 0;
        while(queue.length > 0 && loops < 2000) { // Safety limit
            loops++;
            const curr = queue.shift();
            const key = `${curr.x},${curr.y}`;
            
            if (visited.has(key)) continue;
            visited.add(key);

            // If this tile is NOT explored, it's our target
            if (!explored.has(key) && this.gridSystem.isWalkable(curr.x, curr.y)) {
                return curr;
            }

            // Neighbors
            const dirs = [{x:0,y:1},{x:0,y:-1},{x:1,y:0},{x:-1,y:0}];
            for (const d of dirs) {
                const nx = curr.x + d.x;
                const ny = curr.y + d.y;
                if (nx >= 0 && nx < this.gridSystem.width && ny >= 0 && ny < this.gridSystem.height) {
                    queue.push({x: nx, y: ny});
                }
            }
        }
        return null;
    }

    updateAI(dt) {
        const now = Date.now();
        for (const [id, stats] of this.combatSystem.stats) {
            if (stats.isPlayer) continue;
            
            // AI Logic: 1 second cooldown
            if (now - (stats.lastActionTime || 0) < 1000) continue;

            const pos = this.gridSystem.entities.get(id);
            if (!pos) continue;

            // Optimization: AI Sleep
            // If the monster is too far from any player, skip logic.
            // This drastically reduces CPU usage on large maps with many monsters.
            const nearestPlayerId = this.findNearestPlayerId(pos.x, pos.y);
            if (!nearestPlayerId) continue;
            
            const nearestPlayer = this.gridSystem.entities.get(nearestPlayerId);
            const distToPlayer = Math.abs(nearestPlayer.x - pos.x) + Math.abs(nearestPlayer.y - pos.y);
            if (distToPlayer > 25) continue; // Sleep radius (approx 1.5 screens)

            // Check collision with chests for AI
            // Simple check: if target is blocked by chest, don't move there
            // This is handled implicitly if moveEntity checks collision, but moveEntity only checks walls/entities.
            // We need to check loot collision here or inject it into moveEntity.
            // For now, we check here before moving.
            // (Logic below handles movement)
            
            let targetPos = null;
            let shouldAttack = false;

            if (nearestPlayer) {
                // Check Line of Sight
                const hasLOS = this.gridSystem.hasLineOfSight(pos.x, pos.y, nearestPlayer.x, nearestPlayer.y);
                
                if (hasLOS) {
                    stats.aiState = 'CHASING';
                    stats.targetLastPos = { x: nearestPlayer.x, y: nearestPlayer.y };
                    stats.memoryTimer = 5000; // 5 Seconds Memory
                    targetPos = nearestPlayer;
                    shouldAttack = true;
                }
            } else if (stats.aiState === 'IDLE') {
                // Roaming Logic
                if (Math.random() < 0.02) { // 2% chance per tick to move
                    const dir = AI_DIRS[Math.floor(Math.random() * AI_DIRS.length)];
                    if (!this.lootSystem.isCollidable(pos.x + dir.x, pos.y + dir.y)) {
                        this.gridSystem.moveEntity(id, dir.x, dir.y);
                        stats.lastActionTime = now;
                    }
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
                    this.performAttack(id, nearestPlayerId);
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

    findNearestPlayerId(x, y) {
        let nearestId = null;
        let minDist = Infinity;
        
        for (const [id, stats] of this.combatSystem.stats) {
            if (stats.team === 'player') {
                const pos = this.gridSystem.entities.get(id);
                if (pos) {
                    const dist = Math.abs(pos.x - x) + Math.abs(pos.y - y);
                    if (dist < minDist) {
                        minDist = dist;
                        nearestId = id;
                    }
                }
            }
        }
        return nearestId;
    }

    showGameOver(msg) {
        const ui = document.getElementById('ui-layer');

        const screen = document.createElement('div');
        screen.id = 'game-over-screen';
        Object.assign(screen.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: '2000',
            color: 'white',
            fontFamily: 'sans-serif',
            pointerEvents: 'auto'
        });

        screen.innerHTML = `
            <h1 style="font-size: 4rem; margin-bottom: 1rem; text-shadow: 0 0 10px #ff0000;">GAME OVER</h1>
            <h2 style="font-size: 2rem; margin-bottom: 2rem; color: #ccc;">${msg}</h2>
            <button id="btn-return-lobby" style="padding: 15px 30px; font-size: 1.2rem; cursor: pointer; background: #444; color: white; border: 1px solid #666;">Return to Lobby</button>
        `;
        
        ui.appendChild(screen);
        
        document.getElementById('btn-return-lobby').onclick = () => location.reload();

        // Elevate other HUD elements to stay visible above overlay
        ['room-code-display', 'game-timer'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.style.zIndex = '2001';
                if (window.getComputedStyle(el).position === 'static') {
                    el.style.position = 'relative';
                }
            }
        });

        this.gameLoop.stop();
    }

    update(dt) {
        // Cap dt to prevent physics tunneling or spirals of death on lag spikes
        if (dt > 100) dt = 100;

        if (this.state.isHost) {
            // Timer Logic
            this.state.gameTime -= (dt / 1000);
            
            if (!this.state.extractionOpen && this.state.gameTime <= 60) {
                this.state.extractionOpen = true;
                const pos = this.gridSystem.spawnExtractionZone();
                this.peerClient.send({ type: 'PORTAL_SPAWN', payload: { x: pos.x, y: pos.y } });
            }

            if (this.state.gameTime <= 0) {
                this.peerClient.send({ type: 'GAME_OVER', payload: { message: "Time Expired - Dungeon Collapsed" } });
                this.showGameOver("Time Expired");
            }

            // Network Tick: Send Snapshot (10Hz)
            this.state.netTimer += dt;
            if (this.state.netTimer >= 100) {
                this.state.netTimer = 0;
                const snapshot = this.syncManager.serializeState(
                    this.gridSystem, this.combatSystem, this.lootSystem,
                    this.state.projectiles, this.state.gameTime
                );
                this.peerClient.send({ type: 'SNAPSHOT', payload: snapshot });
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

        // Client Reconciliation: Check for drift
        if (!this.state.isHost && this.state.connected) {
            // 1. Get Latest Server State
            const latestState = this.syncManager.getLatestState();
            
            if (latestState) {
                // 2. Sync Logic Layer (Collisions & Targeting)
                this.gridSystem.syncRemoteEntities(latestState.entities, this.state.myId);
                
                // Sync Loot for collision logic
                this.lootSystem.syncLoot(latestState.loot);
                
                for (const [id, data] of latestState.entities) {
                    if (id !== this.state.myId) {
                        this.combatSystem.syncRemoteStats(id, data);
                    }
                }

                // Sync Projectiles & Game Time
                this.state.projectiles = latestState.projectiles;
                this.state.gameTime = latestState.gameTime;

                // 3. Reconcile Self (Drift Correction)
                const serverPos = latestState.entities.get(this.state.myId);
                const localPos = this.gridSystem.entities.get(this.state.myId);
            
                if (serverPos) {
                // Prevent re-adding human entity if we are in the process of extracting locally
                // until the server confirms we are a monster.
                if (this.state.isExtracting && serverPos.team !== 'monster') {
                    return;
                }
                // If we are now a monster on server, clear extraction flag
                if (serverPos.team === 'monster') this.state.isExtracting = false;

                if (!localPos) {
                    // Respawned on server, add locally
                    // Round to integer to prevent float contamination from interpolation
                    this.gridSystem.addEntity(this.state.myId, Math.round(serverPos.x), Math.round(serverPos.y));
                } else {
                    const dist = Math.abs(serverPos.x - localPos.x) + Math.abs(serverPos.y - localPos.y);
                    // If drift is too large (e.g. rejected move or lag spike), snap to server
                    // Increased threshold to 5.0 to prevent snapping during rapid/diagonal movement
                    if (dist > 5.0) {
                        console.warn("Reconciling position. Dist:", dist);
                        this.gridSystem.addEntity(this.state.myId, Math.round(serverPos.x), Math.round(serverPos.y));
                    }
                }
                }
            }
        }

        // Common UI Updates (Timer)
        const timerEl = document.getElementById('game-timer');
        if (timerEl) {
            const minutes = Math.floor(this.state.gameTime / 60);
            const seconds = Math.floor(this.state.gameTime % 60);
            timerEl.innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            if (this.state.gameTime < 60) timerEl.style.color = '#ff4444';
            else timerEl.style.color = '#fff';
        }

        // Update Projectiles (Host Only Simulation)
        if (this.state.isHost) {
            const projSpeed = dt / 1000;
            
            for (let i = this.state.projectiles.length - 1; i >= 0; i--) {
                const p = this.state.projectiles[i];
                
                // Sub-step physics to prevent tunneling through walls at high speeds or low framerates
                const totalMove = p.speed * projSpeed;
                const steps = Math.ceil(totalMove / 0.5); // Ensure we don't move more than 0.5 tiles per check
                const stepMove = totalMove / steps;
                
                let hit = false;
                for (let s = 0; s < steps; s++) {
                    p.x += p.vx * stepMove;
                    p.y += p.vy * stepMove;

                    const gridX = Math.round(p.x);
                    const gridY = Math.round(p.y);

                    if (!this.gridSystem.isWalkable(gridX, gridY)) {
                        this.state.projectiles.splice(i, 1); // Hit Wall
                        hit = true;
                        break;
                    }

                    const hitId = this.gridSystem.getEntityAt(gridX, gridY);
                    if (hitId && hitId !== p.ownerId) {
                        this.combatSystem.applyDamage(hitId, p.damage, p.ownerId);
                        this.state.projectiles.splice(i, 1);
                        hit = true;
                        break;
                    }
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

        // Poll Input (Solves OS key repeat delay)
        if (this.state.myId) {
            const mouse = this.inputManager.getMouseState();
            
            // Continuous Movement/Action (Left Click Hold)
            if (mouse.left) {
                const now = Date.now();
                // Throttle pathfinding to every 100ms to prevent performance tanking
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
            
            // Auto-Explore / Path Following
            if (this.state.autoPath && this.state.autoPath.length > 0 && !moveIntent) {
                const next = this.state.autoPath[0];
                const pos = this.gridSystem.entities.get(this.state.myId);
                if (pos) {
                    const dx = next.x - pos.x;
                    const dy = next.y - pos.y;
                    // If we are at the node (or close enough), pop it
                    if (dx === 0 && dy === 0) {
                        this.state.autoPath.shift();
                    } else {
                        // Generate move intent
                        this.handleInput({ type: 'MOVE', direction: { x: Math.sign(dx), y: Math.sign(dy) } });
                    }
                }
            } else if (this.state.chaseTargetId && !moveIntent) {
                // Path finished, check if we can attack
                const targetPos = this.gridSystem.entities.get(this.state.chaseTargetId);
                const myPos = this.gridSystem.entities.get(this.state.myId);
                
                if (targetPos && myPos) {
                    const dist = Math.max(Math.abs(targetPos.x - myPos.x), Math.abs(targetPos.y - myPos.y));
                    if (dist <= 1) {
                        // Perform Attack
                        this.handleInput({ 
                            type: 'TARGET_ACTION', 
                            x: targetPos.x, 
                            y: targetPos.y 
                        });
                    }
                }
                this.state.chaseTargetId = null;
            } else if (moveIntent) {
                // Manual input cancels auto-path
                this.state.autoPath = [];
                this.state.chaseTargetId = null;
            }

            if (moveIntent) {
                this.handleInput(moveIntent);
            } else {
                // Clear move buffer if key released to prevent double-tap effect
                if (this.state.actionBuffer && this.state.actionBuffer.type === 'MOVE') {
                    this.state.actionBuffer = null;
                }
            }

            if (attackIntent) {
                this.handleInput(attackIntent);
            }
        }

        if (this.state.isHost) {
            this.updateAI(dt);
        }
    }

    render(alpha) {
        if (!this.state.myId) return;
        
        // Update Audio Listener
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

const game = new Game();
window.game = game;
window.onload = () => game.init();