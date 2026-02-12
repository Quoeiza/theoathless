export default class SyncManager {
    constructor(config) {
        this.snapshotBuffer = [];
        // Delay interpolation to ensure we have a "next" frame to lerp to.
        // 100ms is a safe starting point for WAN.
        this.interpolationDelay = 100; 
    }

    serializeState(gridSystem, combatSystem, lootSystem, gameTime) {
        // Create a lightweight snapshot of the game state
        return {
            t: Date.now(),
            // Convert Map to Array for JSON serialization
            entities: Array.from(gridSystem.entities.entries()),
            loot: Array.from(lootSystem.worldLoot.entries()),
            gameTime: gameTime,
            // Add combat stats if needed for UI
        };
    }

    addSnapshot(snapshot) {
        this.snapshotBuffer.push(snapshot);
        // Keep buffer small
        if (this.snapshotBuffer.length > 20) {
            this.snapshotBuffer.shift();
        }
    }

    getInterpolatedState(now) {
        const renderTime = now - this.interpolationDelay;

        // Find two snapshots surrounding renderTime
        let prev = null;
        let next = null;

        for (let i = this.snapshotBuffer.length - 1; i >= 0; i--) {
            if (this.snapshotBuffer[i].t <= renderTime) {
                prev = this.snapshotBuffer[i];
                next = this.snapshotBuffer[i + 1];
                break;
            }
        }

        // Fallback if no valid history
        if (!prev) return { entities: new Map(), loot: new Map(), gameTime: 0 }; 
        if (!next) return { entities: new Map(prev.entities), loot: new Map(prev.loot || []), gameTime: prev.gameTime };

        const ratio = (renderTime - prev.t) / (next.t - prev.t);
        const interpolatedEntities = new Map();
        const lootMap = new Map(prev.loot || []); // Loot doesn't interpolate, just take previous

        // Interpolate positions
        const prevMap = new Map(prev.entities);
        next.entities.forEach(([id, nextPos]) => {
            const prevPos = prevMap.get(id) || nextPos;
            const x = prevPos.x + (nextPos.x - prevPos.x) * ratio;
            const y = prevPos.y + (nextPos.y - prevPos.y) * ratio;
            interpolatedEntities.set(id, { x, y });
        });

        return { entities: interpolatedEntities, loot: lootMap, gameTime: next.gameTime };
    }
}