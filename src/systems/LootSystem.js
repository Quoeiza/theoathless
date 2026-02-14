export default class LootSystem {
    constructor(itemsConfig) {
        this.itemsConfig = itemsConfig;
        this.worldLoot = new Map(); // ID -> { itemId, x, y }
        this.inventories = new Map(); // EntityID -> [items]
        this.equipment = new Map(); // EntityID -> { weapon: null, armor: null, quick1: null, quick2: null, quick3: null }
    }

    spawnLoot(x, y, itemId, count = 1, type = 'chest', gold = 0) {
        const id = `loot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.worldLoot.set(id, { id, itemId, count, x, y, opened: false, type, gold });
        return id;
    }

    spawnDrop(x, y, itemId, count = 1) {
        return this.spawnLoot(x, y, itemId, count, 'bag');
    }

    getAllItems(entityId) {
        const items = [];
        const inv = this.getInventory(entityId);
        if (inv) items.push(...inv);

        const equip = this.getEquipment(entityId);
        if (equip) {
            Object.values(equip).forEach(item => {
                if (item) items.push(item);
            });
        }
        return items;
    }

    createLootBag(x, y, items) {
        if (!items) return;
        items.forEach(item => this.spawnDrop(x, y, item.itemId, item.count));
    }

    getLootAt(x, y) {
        for (const loot of this.worldLoot.values()) {
            if (loot.x === x && loot.y === y) return loot;
        }
        return null;
    }

    getItemsAt(x, y) {
        const items = [];
        for (const loot of this.worldLoot.values()) {
            if (loot.x === x && loot.y === y) items.push(loot);
        }
        return items;
    }

    isCollidable(x, y) {
        for (const loot of this.worldLoot.values()) {
            if (loot.x === x && loot.y === y) {
                // Only closed chests are collidable
                if (loot.type === 'chest' && !loot.opened) return true;
            }
        }
        return false;
    }

    tryOpen(entityId, lootId) {
        const loot = this.worldLoot.get(lootId);
        if (!loot || loot.opened) return null;

        loot.opened = true;
        this.addItemToEntity(entityId, loot.itemId, loot.count || 1);
        return { itemId: loot.itemId, count: loot.count || 1, gold: loot.gold || 0 };
    }

    pickupBag(entityId, lootId) {
        const loot = this.worldLoot.get(lootId);
        if (!loot) return null;
        
        this.worldLoot.delete(lootId);
        this.addItemToEntity(entityId, loot.itemId, loot.count || 1);
        return { itemId: loot.itemId, count: loot.count || 1, gold: loot.gold || 0 };
    }

    addItemToEntity(entityId, itemId, count) {
        const config = this.getItemConfig(itemId);
        const isStackable = config && config.stackable;
        const maxStack = (config && config.maxStack) || 1;
        const equip = this.getEquipment(entityId);
        const inv = this.getInventory(entityId);

        let remaining = count;
        const type = this.getItemType(itemId);

        // 1. Try to stack/auto-equip in Quick Slots (if consumable)
        if (type === 'consumable') {
            for (let i = 1; i <= 3; i++) {
                const slot = `quick${i}`;
                if (equip[slot]) {
                    if (isStackable && equip[slot].itemId === itemId && equip[slot].count < maxStack) {
                        const space = maxStack - equip[slot].count;
                        const add = Math.min(space, remaining);
                        equip[slot].count += add;
                        remaining -= add;
                    }
                } else {
                    // Auto-equip to empty slot
                    const add = Math.min(maxStack, remaining);
                    equip[slot] = { itemId, count: add };
                    remaining -= add;
                }
                if (remaining <= 0) return;
            }
        }

        // 2. Auto-equip Weapon/Armor if slot is empty
        if ((type === 'weapon' || type === 'armor') && !equip[type]) {
            equip[type] = { itemId, count: 1 };
            remaining--;
            if (remaining <= 0) return;
        }

        // 3. Try to stack in Inventory
        if (isStackable) {
            for (const item of inv) {
                if (item.itemId === itemId && item.count < maxStack) {
                    const space = maxStack - item.count;
                    const add = Math.min(space, remaining);
                    item.count += add;
                    remaining -= add;
                    if (remaining <= 0) return;
                }
            }
        }

        // 4. Add new entry to Inventory
        if (remaining > 0) {
            inv.push({ itemId, count: remaining });
        }
    }

    getItemConfig(itemId) {
        if (this.itemsConfig.weapons[itemId]) return this.itemsConfig.weapons[itemId];
        if (this.itemsConfig.armor && this.itemsConfig.armor[itemId]) return this.itemsConfig.armor[itemId];
        if (this.itemsConfig.consumables[itemId]) return this.itemsConfig.consumables[itemId];
        return null;
    }

    getItemType(itemId) {
        if (this.itemsConfig.weapons[itemId]) return 'weapon';
        if (this.itemsConfig.armor && this.itemsConfig.armor[itemId]) return 'armor';
        if (this.itemsConfig.consumables[itemId]) return 'consumable';
        return 'misc';
    }

    getInventory(entityId) {
        if (!this.inventories.has(entityId)) this.inventories.set(entityId, []);
        return this.inventories.get(entityId);
    }

    getEquipment(entityId) {
        if (!this.equipment.has(entityId)) this.equipment.set(entityId, { weapon: null, armor: null, quick1: null, quick2: null, quick3: null });
        return this.equipment.get(entityId);
    }

    equipItem(entityId, itemId, slot) {
        const inv = this.getInventory(entityId);
        const equip = this.getEquipment(entityId);
        const itemIndex = inv.findIndex(i => i.itemId === itemId);

        if (itemIndex === -1) return false;

        // Validate Slot
        const type = this.getItemType(itemId);
        if (slot === 'weapon' && type !== 'weapon') return false;
        if (slot === 'armor' && type !== 'armor') return false;
        if (slot.startsWith('quick') && type !== 'consumable') return false;

        const itemToEquip = inv[itemIndex];

        // Swap if something is already equipped
        if (equip[slot]) {
            // If same item and stackable, try merge? For simplicity, just swap.
            inv.push(equip[slot]); 
        }

        equip[slot] = itemToEquip;
        inv.splice(itemIndex, 1);
        return true;
    }

    unequipItem(entityId, slot) {
        const equip = this.getEquipment(entityId);
        if (!equip[slot]) return false;

        const inv = this.getInventory(entityId);
        inv.push(equip[slot]);
        equip[slot] = null;
        return true;
    }

    removeItemFromInventory(entityId, itemId) {
        const inv = this.getInventory(entityId);
        const idx = inv.findIndex(i => i.itemId === itemId);
        if (idx > -1) {
            const item = inv[idx];
            // Remove whole stack for drop
            inv.splice(idx, 1);
            return item.count;
        }
        return 0;
    }

    consumeItem(entityId, slot) {
        const equip = this.getEquipment(entityId);
        const item = equip[slot];
        
        if (!item) return null;

        item.count--;
        if (item.count <= 0) {
            equip[slot] = null;
        }

        return this.getItemConfig(item.itemId);
    }

    getStatsModifier(entityId) {
        // Helper to calculate total stats from equipment (for CombatSystem later)
        return { damage: 0, defense: 0 }; 
    }

    syncLoot(remoteLootMap) {
        // Update local loot state to match server (crucial for collision logic)
        this.worldLoot = new Map(remoteLootMap);
    }
}