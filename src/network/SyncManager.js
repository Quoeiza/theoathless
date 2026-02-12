export default class SyncManager {
    constructor(config) {
        this.snapshotBuffer = [];
        // Delay interpolation to ensure we have a "next" frame to lerp to.
        // 100ms is a safe starting point for WAN.
        this.interpolationDelay = 100; 
        this.timeOffset = null; // Server Time - Client Time
    }

    serializeState(gridSystem, combatSystem, lootSystem, gameTime) {
        // Create a lightweight snapshot of the game state
        const entities = [];
        for (const [id, pos] of gridSystem.entities) {
            const stats = combatSystem.getStats(id);
            // Attach visual stats to the entity position data for rendering
            entities.push([id, { ...pos, hp: stats ? stats.hp : 0, maxHp: stats ? stats.maxHp : 100 }]);
        }

        return {
            t: Date.now(),
            // Convert Map to Array for JSON serialization
            entities: entities,
            loot: Array.from(lootSystem.worldLoot.entries()),
            gameTime: gameTime,
            // Add combat stats if needed for UI
        };
    }

    addSnapshot(snapshot) {
        // Initialize time offset on first snapshot to sync clocks
        if (this.timeOffset === null) {
            this.timeOffset = snapshot.t - Date.now();
            console.log("SyncManager: Time offset synchronized:", this.timeOffset);
        }

        this.snapshotBuffer.push(snapshot);
        // Keep buffer small
        if (this.snapshotBuffer.length > 20) {
            this.snapshotBuffer.shift();
        }
    }

    getInterpolatedState(clientNow) {
        // If we haven't synced time yet, we can't interpolate correctly
        if (this.timeOffset === null) return { entities: new Map(), loot: new Map(), gameTime: 0 };

        const renderTime = (clientNow + this.timeOffset) - this.interpolationDelay;

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

        let ratio = 0;
        const timeDiff = next.t - prev.t;
        if (timeDiff > 0.0001) { // Prevent division by extremely small numbers
            ratio = (renderTime - prev.t) / timeDiff;
        } else {
            ratio = 1; // Fallback to latest state if timestamps are identical
        }

        const interpolatedEntities = new Map();
        const lootMap = new Map(prev.loot || []); // Loot doesn't interpolate, just take previous

        // Interpolate positions
        const prevMap = new Map(prev.entities);
        next.entities.forEach(([id, nextPos]) => {
            const prevPos = prevMap.get(id) || nextPos;
            
            // Sanitize inputs
            const prevX = Number.isFinite(prevPos.x) ? prevPos.x : 0;
            const prevY = Number.isFinite(prevPos.y) ? prevPos.y : 0;
            const nextX = Number.isFinite(nextPos.x) ? nextPos.x : 0;
            const nextY = Number.isFinite(nextPos.y) ? nextPos.y : 0;

            const x = prevX + (nextX - prevX) * ratio;
            const y = prevY + (nextY - prevY) * ratio;
            
            interpolatedEntities.set(id, { 
                x, y, 
                facing: nextPos.facing,
                hp: nextPos.hp,
                maxHp: nextPos.maxHp
            });
        });

        return { entities: interpolatedEntities, loot: lootMap, gameTime: next.gameTime };
    }
}