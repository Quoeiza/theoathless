export default class LootSystem {
    constructor(itemsConfig) {
        this.itemsConfig = itemsConfig;
        this.worldLoot = new Map(); // ID -> { itemId, x, y }
        this.inventories = new Map(); // EntityID -> [items]
    }

    spawnLoot(x, y, itemId) {
        const id = `loot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.worldLoot.set(id, { id, itemId, x, y });
        return id;
    }

    pickup(entityId, x, y) {
        for (const [lootId, loot] of this.worldLoot) {
            if (loot.x === x && loot.y === y) {
                this.worldLoot.delete(lootId);
                
                if (!this.inventories.has(entityId)) {
                    this.inventories.set(entityId, []);
                }
                this.inventories.get(entityId).push(loot.itemId);
                
                return loot.itemId;
            }
        }
        return null;
    }
}