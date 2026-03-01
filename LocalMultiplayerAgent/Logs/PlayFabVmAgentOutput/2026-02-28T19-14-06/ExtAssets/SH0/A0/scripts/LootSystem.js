export default class LootSystem {
    constructor(itemsConfig) {
        this.itemsConfig = itemsConfig;
        this.itemMap = new Map();

        // Index items for fast lookup and inject ID/Type
        const processCategory = (category, type) => {
            if (!category) return;
            for (const [key, item] of Object.entries(category)) {
                this.itemMap.set(key, { ...item, id: key, type });
            }
        };

        processCategory(itemsConfig.weapons, 'weapon');
        processCategory(itemsConfig.armor, 'armor');
        processCategory(itemsConfig.consumables, 'consumable');

        this.worldLoot = new Map(); // ID -> { itemId, x, y }
        this.inventories = new Map(); // EntityID -> [items]
        this.equipment = new Map(); // EntityID -> { weapon: null, armor: null, quick1: null, quick2: null, quick3: null }
        this.lootSpatial = new Map(); // "x,y" -> Set<lootId>
    }

    clear() {
        this.worldLoot.clear();
        this.inventories.clear();
        this.equipment.clear();
        this.lootSpatial.clear();
    }

    _getSpatialKey(x, y) {
        // Use bitwise integer key for performance (x | y << 16)
        // Safe for coordinates up to 65535
        return (Math.round(x) & 0xFFFF) | (Math.round(y) << 16);
    }

    _addToSpatial(loot) {
        const key = this._getSpatialKey(loot.x, loot.y);
        if (!this.lootSpatial.has(key)) this.lootSpatial.set(key, new Set());
        this.lootSpatial.get(key).add(loot.id);
    }

    _removeFromSpatial(loot) {
        const key = this._getSpatialKey(loot.x, loot.y);
        if (this.lootSpatial.has(key)) {
            const set = this.lootSpatial.get(key);
            set.delete(loot.id);
            if (set.size === 0) this.lootSpatial.delete(key);
        }
    }

    spawnLoot(x, y, itemId, count = 1, type = 'chest', gold = 0) {
        const id = `loot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const itemData = this.generateItem(itemId);
        const loot = { id, itemId, count, x, y, opened: false, type, gold, stats: itemData.stats, bonuses: itemData.bonuses };
        this.worldLoot.set(id, loot);
        this._addToSpatial(loot);
        return id;
    }

    generateItem(itemId) {
        const config = this.getItemConfig(itemId);
        if (!config) return { itemId };

        const result = { itemId, stats: {}, bonuses: {} };
        
        // Generate Base Stats
        if (config.stats) {
            for (const [key, val] of Object.entries(config.stats)) {
                if (typeof val === 'object' && val.min !== undefined && val.max !== undefined) {
                    result.stats[key] = Math.floor(Math.random() * (val.max - val.min + 1)) + val.min;
                } else {
                    result.stats[key] = val;
                }
            }
        }

        // Generate Bonuses
        if (config.possibleBonuses) {
            for (const bonus of config.possibleBonuses) {
                if (Math.random() < bonus.chance) {
                    const val = Math.floor(Math.random() * (bonus.max - bonus.min + 1)) + bonus.min;
                    result.bonuses[bonus.stat] = val;
                }
            }
        }

        return result;
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

    createLootBag(x, y, items, gold = 0) {
        if ((!items || items.length === 0) && gold <= 0) return;
        
        if (items && items.length > 0) {
            items.forEach((item, index) => {
                const itemGold = (index === 0) ? gold : 0;
                this.spawnLoot(x, y, item.itemId, item.count, 'bag', itemGold);
            });
        } else if (gold > 0) {
            this.spawnLoot(x, y, 'gold', 1, 'bag', gold);
        }
    }

    getLootAt(x, y) {
        const key = this._getSpatialKey(x, y);
        const ids = this.lootSpatial.get(key);
        if (!ids) return null;
        for (const id of ids) {
            return this.worldLoot.get(id);
        }
        return null;
    }

    getItemsAt(x, y) {
        const key = this._getSpatialKey(x, y);
        const ids = this.lootSpatial.get(key);
        if (!ids) return [];
        const items = [];
        for (const id of ids) {
            const loot = this.worldLoot.get(id);
            if (loot) items.push(loot);
        }
        return items;
    }

    isCollidable(x, y) {
        const key = this._getSpatialKey(x, y);
        const ids = this.lootSpatial.get(key);
        if (!ids) return false;

        for (const id of ids) {
            const loot = this.worldLoot.get(id);
            if (loot && loot.type === 'chest' && !loot.opened) return true;
        }
        return false;
    }

    tryOpen(entityId, lootId) {
        const loot = this.worldLoot.get(lootId);
        if (!loot || loot.opened) return null;

        loot.opened = true;
        this.addItemToEntity(entityId, loot.itemId, loot.count || 1, loot);
        return { itemId: loot.itemId, count: loot.count || 1, gold: loot.gold || 0 };
    }

    markOpened(lootId) {
        const loot = this.worldLoot.get(lootId);
        if (loot) loot.opened = true;
    }

    pickupBag(entityId, lootId) {
        const loot = this.worldLoot.get(lootId);
        if (!loot) return null;
        
        this._removeFromSpatial(loot);
        this.worldLoot.delete(lootId);
        this.addItemToEntity(entityId, loot.itemId, loot.count || 1, loot);
        return { itemId: loot.itemId, count: loot.count || 1, gold: loot.gold || 0 };
    }

    addItemToEntity(entityId, itemId, count, sourceLoot = null) {
        const config = this.getItemConfig(itemId);
        const isStackable = config && config.stackable;
        const maxStack = (config && config.maxStack) || 1;
        const equip = this.getEquipment(entityId);
        const inv = this.getInventory(entityId);

        let remaining = count;
        const type = this.getItemType(itemId);

        // Prepare item object (preserve stats if they exist on source)
        const newItem = { itemId, count: 1 };
        if (sourceLoot && sourceLoot.stats) newItem.stats = sourceLoot.stats;
        if (sourceLoot && sourceLoot.bonuses) newItem.bonuses = sourceLoot.bonuses;
        if (!newItem.stats && !isStackable) Object.assign(newItem, this.generateItem(itemId));

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
            equip[type] = newItem;
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
            newItem.count = remaining;
            inv.push(newItem);
        }
    }

    getItemConfig(itemId) {
        return this.itemMap.get(itemId) || null;
    }

    getName(itemId) {
        const config = this.getItemConfig(itemId);
        return config ? config.name : itemId;
    }

    getItemType(itemId) {
        const item = this.itemMap.get(itemId);
        return item ? item.type : 'misc';
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
        const equip = this.getEquipment(entityId);
        let damage = 0;
        let defense = 0;

        if (equip.weapon) {
            if (equip.weapon.stats && equip.weapon.stats.damage) {
                damage += equip.weapon.stats.damage;
            } else {
                const item = this.getItemConfig(equip.weapon.itemId);
                if (item && item.damage) damage += item.damage;
            }
        }
        if (equip.armor) {
            if (equip.armor.stats && equip.armor.stats.defense) defense += equip.armor.stats.defense;
            else { const item = this.getItemConfig(equip.armor.itemId); if (item) defense += (item.defense || 0); }
        }
        return { damage, defense };
    }

    syncLoot(remoteLootMap) {
        // Update local loot state to match server (crucial for collision logic)
        this.worldLoot = new Map(remoteLootMap);
        this.lootSpatial.clear();
        for (const loot of this.worldLoot.values()) {
            this._addToSpatial(loot);
        }
    }

    resolveInteraction(entityId, lootId) {
        const loot = this.worldLoot.get(lootId);
        if (!loot) return null;

        let result = null;
        if (loot.type === 'chest') {
            if (!loot.opened) {
                result = this.tryOpen(entityId, lootId);
            }
        } else {
            result = this.pickupBag(entityId, lootId);
        }
        return result;
    }

    performDrop(entityId, itemId, source, gridSystem) {
        let count = 0;
        if (source === 'inventory') {
            count = this.removeItemFromInventory(entityId, itemId);
        } else {
            const equip = this.getEquipment(entityId);
            if (equip && equip[source] && equip[source].itemId === itemId) {
                count = equip[source].count;
                equip[source] = null;
            }
        }

        if (count > 0) {
            const pos = gridSystem.entities.get(entityId);
            if (pos) {
                this.spawnDrop(pos.x, pos.y, itemId, count);
                return true;
            }
        }
        return false;
    }

    findNearbyLoot(x, y, facing) {
        const itemsBelow = this.getItemsAt(x, y);
        const fx = x + facing.x;
        const fy = y + facing.y;
        const itemsFront = this.getItemsAt(fx, fy);
        return [...itemsBelow, ...itemsFront].filter(l => !l.opened);
    }

    getPickupTarget(entityId, gridSystem) {
        const pos = gridSystem.entities.get(entityId);
        if (!pos) return null;
        
        const allItems = this.findNearbyLoot(pos.x, pos.y, pos.facing);
        const chest = allItems.find(i => i.type === 'chest');
        
        if (chest) return { type: 'chest', target: chest };
        if (allItems.length > 0) return { type: 'items', items: allItems };
        return null;
    }
}