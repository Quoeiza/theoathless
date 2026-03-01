export class InventoryUI {
    constructor(lootSystem) {
        this.lootSystem = lootSystem;
        this.handleEquipItem = null;
        this.handleUnequipItem = null;
    }

    init() {
        this._setupSlotDrop(document.getElementById('slot-weapon'), 'weapon');
        this._setupSlotDrop(document.getElementById('slot-armor'), 'armor');

        const grid = document.getElementById('inventory-grid');
        if (grid) {
            grid.addEventListener('dragover', (e) => e.preventDefault());
            grid.addEventListener('drop', (e) => {
                e.preventDefault();
                try {
                    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                    if (data && data.source && data.source !== 'inventory') {
                        if (this.handleUnequipItem) this.handleUnequipItem(data.source);
                    }
                } catch (err) {
                    console.warn("Invalid drop data", err);
                }
            });
        }
    }

    setCallbacks(handleEquipItem, handleUnequipItem) {
        this.handleEquipItem = handleEquipItem;
        this.handleUnequipItem = handleUnequipItem;
    }

    renderInventory(myId) {
        const grid = document.getElementById('inventory-grid');
        const inv = this.lootSystem.getInventory(myId);
        const equip = this.lootSystem.getEquipment(myId);

        if (!grid || !inv || !equip) {
            console.error("Inventory UI elements not found or data missing.");
            return;
        }

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
                // Simple colour coding based on type
                const type = this.lootSystem.getItemType(item.itemId);
                icon.style.backgroundColor = type === 'weapon' ? '#d65' : type === 'armor' ? '#56d' : '#5d5';
                
                // Tooltip Events
                const showTip = (e) => this.showTooltip(e, item);
                icon.addEventListener('mouseenter', showTip);
                icon.addEventListener('mousemove', showTip);
                icon.addEventListener('mouseleave', () => this.hideTooltip());
                icon.addEventListener('click', (e) => { e.stopPropagation(); showTip(e); });

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
                    this.hideTooltip();
                });
            }
            grid.appendChild(cell);
        }

        // Render Equip Slots
        const renderSlot = (slotName) => {
            const el = document.getElementById(`slot-${slotName}`);
            if (!el) return;
            el.innerHTML = '';
            const item = equip[slotName];
            if (item) {
                const icon = document.createElement('div');
                icon.className = 'item-icon';
                icon.style.backgroundColor = slotName.startsWith('quick') ? '#5d5' : (slotName === 'weapon' ? '#d65' : '#56d');
                
                // Tooltip Events
                const showTip = (e) => this.showTooltip(e, item);
                icon.addEventListener('mouseenter', showTip);
                icon.addEventListener('mousemove', showTip);
                icon.addEventListener('mouseleave', () => this.hideTooltip());
                icon.addEventListener('click', (e) => { e.stopPropagation(); showTip(e); });

                if (item.count > 1) {
                    const countEl = document.createElement('span');
                    countEl.className = 'item-count';
                    countEl.innerText = item.count;
                    icon.appendChild(countEl);
                }

                el.appendChild(icon);
                
                icon.draggable = true;
                icon.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', JSON.stringify({ itemId: item.itemId, source: slotName }));
                    this.hideTooltip();
                });
            } else {
                // Container is not draggable, only the icon inside
            }
        };

        renderSlot('weapon');
        renderSlot('armor');
        
        const slotsContainer = document.querySelector('.equipment-slots');
        if (slotsContainer && !document.getElementById('slot-quick1')) {
            const quickContainer = document.createElement('div');
            quickContainer.style.display = 'flex';
            quickContainer.style.gap = '5px';
            quickContainer.innerHTML = `
                <div class="slot-container"><div id="slot-quick1" class="equip-slot" data-slot="quick1"></div><span>1</span></div>
                <div class="slot-container"><div id="slot-quick2" class="equip-slot" data-slot="quick2"></div><span>2</span></div>
                <div class="slot-container"><div id="slot-quick3" class="equip-slot" data-slot="quick3"></div><span>3</span></div>
            `;
            slotsContainer.appendChild(quickContainer);
            
            this._setupSlotDrop(document.getElementById('slot-quick1'), 'quick1');
            this._setupSlotDrop(document.getElementById('slot-quick2'), 'quick2');
            this._setupSlotDrop(document.getElementById('slot-quick3'), 'quick3');
        }
        renderSlot('quick1');
        renderSlot('quick2');
        renderSlot('quick3');
    }

    updateQuickSlotUI(myId) {
        const hud = document.getElementById('quick-slots-hud');
        if (!hud) return;
        
        const equip = this.lootSystem.getEquipment(myId);
        if (!equip) return;
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

    _setupSlotDrop(element, slotName) {
        if (!element) return;
        element.addEventListener('dragover', (e) => e.preventDefault());
        element.addEventListener('drop', (e) => {
            e.preventDefault();
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            const targetSlot = slotName || element.dataset.slot;
            if (data && data.itemId && this.handleEquipItem) {
                this.handleEquipItem(data.itemId, targetSlot);
            }
        });
    }

    showTooltip(e, item) {
        const tooltip = document.getElementById('game-tooltip');
        if (!tooltip) return;
        
        const text = this._generateTooltip(item);
        tooltip.innerHTML = text.replace(/\n/g, '<br>');
        tooltip.style.display = 'block';
        
        // Positioning
        let x = e.clientX + 15;
        let y = e.clientY + 15;
        
        // Bounds check
        if (x + 220 > window.innerWidth) x = e.clientX - 225;
        if (y + 150 > window.innerHeight) y = e.clientY - 160;

        tooltip.style.left = x + 'px';
        tooltip.style.top = y + 'px';
    }

    hideTooltip() {
        const tooltip = document.getElementById('game-tooltip');
        if (tooltip) tooltip.style.display = 'none';
    }

    _generateTooltip(item) {
        const config = this.lootSystem.getItemConfig(item.itemId);
        if (!config) return item.itemId;

        const type = this.lootSystem.getItemType(item.itemId);
        const stats = item.stats || config.stats || config; // Fallback to config if no instance stats
        const bonuses = item.bonuses || {};
        let tooltip = `${config.name}`;

        const getSpeedLabel = (ms) => {
            if (ms <= 250) return `Very Fast (${ms}ms)`;
            if (ms <= 500) return `Fast (${ms}ms)`;
            if (ms <= 750) return `Normal (${ms}ms)`;
            if (ms <= 1000) return `Slow (${ms}ms)`;
            return `Very Slow (${ms}ms)`;
        };

        if (type === 'weapon') {
            const dmg = stats.damage || 0;
            const speed = stats.attackSpeed || 1000;
            
            // Calculate Bonus Damage for DPS
            let bonusDmg = 0;
            for (const key in bonuses) {
                if (key.includes('Damage')) bonusDmg += bonuses[key];
            }

            // DPS = (Avg Damage + Bonuses) * (1000 / Speed)
            // Prompt requested: "DPS is a calculation of the damage average plus bonuses multiplied by the Attack Speed"
            // Assuming standard DPS logic: Damage per Second.
            const dps = ((dmg + bonusDmg) * (1000 / speed)).toFixed(1);

            tooltip += `\nDPS: ${dps}`;
            tooltip += `\nDamage: ${dmg}`;
            tooltip += `\nAttack Speed: ${getSpeedLabel(speed)}`;
            tooltip += `\nDamage Type: ${stats.damageType || 'Physical'}`;
        } else if (type === 'armor') {
            const def = stats.defense || 0;
            const dr = stats.damageReduction || 0;
            const weight = stats.speedPenalty || 0;
            
            let weightLabel = 'Light';
            if (weight >= 250) weightLabel = 'Heavy';
            else if (weight >= 125) weightLabel = 'Medium';

            tooltip += `\nDamage Reduction: ${dr}%`;
            tooltip += `\nDefence: ${def}`;
            tooltip += `\nWeight: ${weightLabel}`;
            
            // Resistances
            const resists = [];
            for (const key in bonuses) {
                if (key.includes('Resist')) resists.push(`${key.replace('Resist', '')}: +${bonuses[key]}`);
            }
            if (resists.length > 0) tooltip += `\nResistances: ${resists.join(', ')}`;
        } else if (type === 'consumable') {
             if (config.effect) tooltip += `\nEffect: ${config.effect} (${config.value})`;
        }

        // General Bonuses
        for (const [k, v] of Object.entries(bonuses)) {
            if (!k.includes('Resist')) tooltip += `\nBonus: +${v} ${k}`;
        }

        return tooltip;
    }
}
