import { setupLobby } from './Lobby.js';
import { InventoryUI } from './InventoryUI.js';

export default class UISystem {
    constructor(game) {
        this.game = game;
        this.lastTooltipUpdate = 0;
        this.inventoryUI = new InventoryUI(this.game.lootSystem);
        this.inventoryUI.setCallbacks(
            (itemId, slot) => this.game.handleEquipItem(itemId, slot),
            (slot) => this.game.handleUnequipItem(slot)
        );
    }

    setupLobby() {
        const uiLayer = document.getElementById('ui-layer');
        setupLobby(
            uiLayer,
            this.game.playerData,
            (name, cls) => {
                this.game.playerData.name = name || 'Host';
                this.game.playerData.class = cls;
                this.game.database.savePlayer({ name: this.game.playerData.name });
                this.enableFullscreen();
                this.game.startGame(true);
            },
            (code, name, cls) => {
                if (!code) return alert("Enter a room code");
                this.game.playerData.name = name || 'Client';
                this.game.playerData.class = cls;
                this.game.database.savePlayer({ name: this.game.playerData.name });
                this.enableFullscreen();
                this.game.startGame(false, code);
            }
        );
    }

    setupUI() {
        ['room-code-display'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('hidden');
        });

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

        let btnToggle = document.getElementById('btn-inventory-toggle');
        if (!btnToggle) {
            btnToggle = document.createElement('button');
            btnToggle.id = 'btn-inventory-toggle';
        }
        uiLayer.appendChild(btnToggle);
        btnToggle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>`;

        let btnSettings = document.getElementById('btn-settings-toggle');
        if (!btnSettings) {
            btnSettings = document.createElement('button');
            btnSettings.id = 'btn-settings-toggle';
            btnSettings.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
        }
        uiLayer.appendChild(btnSettings);
        btnSettings.onclick = () => this.toggleSettingsMenu();

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

        this.inventoryUI.init();

        const btnGroundClose = document.getElementById('btn-ground-close');
        if (btnGroundClose) btnGroundClose.onclick = () => document.getElementById('ground-loot-modal').classList.add('hidden');

        if (!document.getElementById('loot-notification')) {
            const notif = document.createElement('div');
            notif.id = 'loot-notification';
            uiLayer.appendChild(notif);
        }

        if (!document.getElementById('quick-slots-hud')) {
            const hud = document.createElement('div');
            hud.id = 'quick-slots-hud';
            uiLayer.appendChild(hud);
        }

        this.setupCanvasDrop();

        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) {
            document.getElementById('btn-resume').onclick = () => this.toggleSettingsMenu();
            document.getElementById('btn-settings').onclick = () => alert("Settings coming soon!");
            document.getElementById('btn-quit').onclick = () => location.reload();
        }

        this.createInteractionUI();
    }

    createInteractionUI() {
        const uiLayer = document.body;

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
                fontFamily: '"Germania One", cursive',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 4px rgba(0,0,0,0.5)'
            });
            uiLayer.appendChild(tooltip);
        }

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

            window.addEventListener('click', () => {
                menu.style.display = 'none';
            });
        }
    }

    setupCanvasDrop() {
        const canvas = document.getElementById('game-canvas');
        canvas.addEventListener('dragover', (e) => e.preventDefault());
        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            if (data && data.itemId) {
                this.game.handleDropItem(data.itemId, data.source);
            }
        });
    }

    renderInventory() {
        this.inventoryUI.renderInventory(this.game.state.myId);
    }

    updateQuickSlotUI() {
        this.inventoryUI.updateQuickSlotUI(this.game.state.myId);
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
            const type = this.game.lootSystem.getItemType(loot.itemId);
            icon.style.backgroundColor = type === 'weapon' ? '#d65' : type === 'armor' ? '#56d' : '#5d5';
            icon.title = loot.itemId;
            
            cell.onclick = () => {
                this.game.handleInteractWithLoot(loot);
                modal.classList.add('hidden');
            };

            cell.appendChild(icon);
            grid.appendChild(cell);
        });
    }

    showNotification(text) {
        const el = document.getElementById('loot-notification');
        if (el) {
            el.innerText = text;
            el.style.opacity = '1';
            setTimeout(() => { el.style.opacity = '0'; }, 2000);
        }
    }

    updateGoldUI() {
        const el = document.getElementById('gold-val');
        if (el) el.innerText = this.game.playerData.gold;
    }

    updateTooltip(data) {
        const now = Date.now();
        if (this.lastTooltipUpdate && now - this.lastTooltipUpdate < 50) return;
        this.lastTooltipUpdate = now;

        const tooltip = document.getElementById('game-tooltip');
        if (!tooltip) return;

        const cam = this.game.renderSystem.camera;
        const ts = this.game.config.global.tileSize || 64;
        const scale = this.game.renderSystem.scale || 1;
        const gridX = Math.floor(((data.x / scale) + cam.x) / ts);
        const gridY = Math.floor(((data.y / scale) + cam.y) / ts);

        let content = [];

        const entityId = this.game.gridSystem.getEntityAt(gridX, gridY);
        if (entityId) {
            const stats = this.game.combatSystem.getStats(entityId);
            if (stats) {
                const name = stats.name || stats.type;
                const hpPercent = stats.maxHp > 0 ? Math.floor((stats.hp / stats.maxHp) * 100) : 0;
                const color = stats.team === 'monster' ? '#ff5555' : (entityId === this.game.state.myId ? '#55ff55' : '#55aaff');
                content.push(`<div style="font-weight:bold; color:${color}">${name}</div>`);
                content.push(`<div>HP: ${Math.ceil(stats.hp)}/${stats.maxHp} (${hpPercent}%)</div>`);
            }
        }

        const items = this.game.lootSystem.getItemsAt(gridX, gridY);
        if (items.length > 0) {
            if (content.length > 0) content.push('<div style="height:1px; background:#444; margin:4px 0;"></div>');
            items.forEach(item => {
                const config = this.game.lootSystem.getItemConfig(item.itemId);
                const name = config ? config.name : item.itemId;
                content.push(`<div style="color:#ffd700">📦 ${name} ${item.count > 1 ? `x${item.count}` : ''}</div>`);
            });
        }

        if (content.length > 0) {
            tooltip.innerHTML = content.join('');
            tooltip.style.display = 'block';
            tooltip.style.left = `${data.x + 16}px`;
            tooltip.style.top = `${data.y + 16}px`;
        } else {
            tooltip.style.display = 'none';
        }
    }

    showContextMenu(data) {
        const menu = document.getElementById('game-context-menu');
        if (!menu) return;

        menu.innerHTML = '';
        const cam = this.game.renderSystem.camera;
        const ts = this.game.config.global.tileSize || 48;
        const scale = this.game.renderSystem.scale || 1;
        const gridX = Math.floor(((data.x / scale) + cam.x) / ts);
        const gridY = Math.floor(((data.y / scale) + cam.y) / ts);

        const actions = [];

        const entityId = this.game.gridSystem.getEntityAt(gridX, gridY);
        if (entityId && entityId !== this.game.state.myId) {
            actions.push({
                label: '⚔️ Attack',
                action: () => this.game.handleInput({ type: 'TARGET_ACTION', x: gridX, y: gridY })
            });
        }

        if (this.game.gridSystem.isWalkable(gridX, gridY)) {
            actions.push({
                label: '👣 Move Here',
                action: () => {
                    const pos = this.game.gridSystem.entities.get(this.game.state.myId);
                    if (pos) {
                        const path = this.game.gridSystem.findPath(pos.x, pos.y, gridX, gridY);
                        if (path) this.game.state.autoPath = path;
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
                fontFamily: '"Germania One", cursive'
            });
            el.onmouseover = () => el.style.background = '#333';
            el.onmouseout = () => el.style.background = 'transparent';
            el.onclick = (e) => {
                e.stopPropagation();
                item.action();
                menu.style.display = 'none';
            };
            menu.appendChild(el);
        });

        menu.style.left = `${data.x}px`;
        menu.style.top = `${data.y}px`;
        menu.style.display = 'flex';
    }

    hideContextMenu() {
        const ctxMenu = document.getElementById('game-context-menu');
        if (ctxMenu) ctxMenu.style.display = 'none';
    }

    toggleSettingsMenu() {
        const modal = document.getElementById('settings-modal');
        if (modal) modal.classList.toggle('hidden');
    }

    showHumansEscaped(msg) {
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
            textAlign: 'center',
            color: 'white',
            fontFamily: '"Germania One", cursive',
            pointerEvents: 'auto'
        });

        screen.innerHTML = `
            <h1 style="font-size: 4rem; margin-bottom: 1rem; text-shadow: 0 0 10px #ff0000;">THE DUNGEON SLEEPS</h1>
            <h2 style="font-size: 2rem; margin-bottom: 2rem; color: #ccc;">${msg}</h2>
            <button id="btn-return-lobby" style="padding: 15px 30px; font-size: 1.2rem; cursor: pointer; background: #444; color: white; border: 1px solid #666;">Return to Lobby</button>
        `;
        
        ui.appendChild(screen);
        
        document.getElementById('btn-return-lobby').onclick = () => location.reload();

        ['room-code-display', 'game-timer'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.style.zIndex = '2001';
                if (window.getComputedStyle(el).position === 'static') {
                    el.style.position = 'relative';
                }
            }
        });

        this.game.ticker.stop();
    }

    enableFullscreen() {
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(e => console.log("Fullscreen request failed:", e));
        }
    }
}