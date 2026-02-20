export default class SyncManager {
    constructor(config) {
        this.snapshotBuffer = [];
        // Delay interpolation to ensure we have a "next" frame to lerp to.
        // Increased to 250ms to handle variable network latency (PeerJS) and prevent stuttering.
        // If latency + tickRate > delay, you get stutter. 250ms is a safe buffer.
        this.interpolationDelay = 250;
        this.timeOffset = null; // Server Time - Client Time
        this.reusableEntities = new Map(); // Reuse to reduce GC
    }

    serializeState(gridSystem, combatSystem, lootSystem, projectiles, gameTime) {
        // Create a lightweight snapshot of the game state
        const entities = [];
        for (const [id, pos] of gridSystem.entities) {
            const stats = combatSystem.getStats(id);
            // Attach visual stats to the entity position data for rendering
            entities.push([id, { 
                x: pos.x, 
                y: pos.y, 
                facing: pos.facing,
                hp: stats ? stats.hp : 0, 
                maxHp: stats ? stats.maxHp : 100, 
                team: stats ? stats.team : 'player', 
                type: stats ? stats.type : 'player',
                invisible: pos.invisible
            }]);
        }

        return {
            t: Date.now(),
            entities: entities,
            loot: Array.from(lootSystem.worldLoot.entries()),
            projectiles: projectiles || [],
            gameTime: gameTime,
        };
    }

    addSnapshot(snapshot) {
        // Initialize time offset on first snapshot to sync clocks
        if (this.timeOffset === null || this.snapshotBuffer.length === 0) {
            this.timeOffset = snapshot.t - Date.now();
            console.log("SyncManager: Time offset synchronized:", this.timeOffset);
        }

        this.snapshotBuffer.push(snapshot);
        
        // Sort by time to handle out-of-order packets (UDP/WebRTC nature)
        this.snapshotBuffer.sort((a, b) => a.t - b.t);

        // Keep buffer size reasonable (approx 2-3 seconds of data)
        if (this.snapshotBuffer.length > 60) {
            this.snapshotBuffer.shift();
        }
    }

    getInterpolatedState(clientNow) {
        // If we haven't synced time yet, we can't interpolate correctly
        if (this.timeOffset === null) return { entities: new Map(), loot: new Map(), projectiles: [], gameTime: 0 };

        const renderTime = (clientNow + this.timeOffset) - this.interpolationDelay;

        // Find two snapshots surrounding renderTime
        let prev = null;
        let next = null;

        for (let i = 0; i < this.snapshotBuffer.length; i++) {
            if (this.snapshotBuffer[i].t > renderTime) {
                next = this.snapshotBuffer[i];
                prev = this.snapshotBuffer[i - 1];
                break;
            }
        }

        // Edge Case: We are ahead of the latest snapshot (Lag Spike / Buffer Underflow)
        // Fallback: Use the latest snapshot available to prevent flickering
        if (!next) {
            if (this.snapshotBuffer.length > 0) {
                const latest = this.snapshotBuffer[this.snapshotBuffer.length - 1];
                return this.convertSnapshotToState(latest);
            }
            // Keep returning empty if we truly have nothing, but usually we have at least one
            return { entities: new Map(), loot: new Map(), projectiles: [], gameTime: 0 };
        }

        // Edge Case: We are behind the oldest snapshot (Shouldn't happen with correct buffer management)
        if (!prev) {
            return this.convertSnapshotToState(next);
        }

        // Calculate Interpolation Ratio
        const timeDiff = next.t - prev.t;
        let ratio = 0;
        if (timeDiff > 0) {
            ratio = (renderTime - prev.t) / timeDiff;
        }
        
        // Clamp ratio for safety
        ratio = Math.max(0, Math.min(1, ratio));

        this.reusableEntities.clear();
        const interpolatedEntities = this.reusableEntities;
        const lootMap = new Map(next.loot || []); // Loot uses most recent state (no lerp needed)
        const interpolatedProjectiles = [];

        // Interpolate positions
        const nextEntitiesMap = new Map(next.entities);
        
        // Iterate over prev entities to interpolate towards next
        for (const [id, prevPos] of prev.entities) {
            if (nextEntitiesMap.has(id)) {
                const nextPos = nextEntitiesMap.get(id);
                
                // Sanitize inputs to prevent NaN propagation
                const prevX = Number.isFinite(prevPos.x) ? prevPos.x : 0;
                const prevY = Number.isFinite(prevPos.y) ? prevPos.y : 0;
                const nextX = Number.isFinite(nextPos.x) ? nextPos.x : 0;
                const nextY = Number.isFinite(nextPos.y) ? nextPos.y : 0;

                // Linear Interpolation
                const x = prevX + (nextX - prevX) * ratio;
                const y = prevY + (nextY - prevY) * ratio;

                interpolatedEntities.set(id, {
                    ...nextPos, // Inherit latest properties (HP, Status)
                    x,
                    y
                });
            }
        }
        
        // Handle new entities that appeared in 'next' (Spawns)
        for (const [id, nextPos] of next.entities) {
            if (!interpolatedEntities.has(id)) {
                interpolatedEntities.set(id, nextPos);
            }
        }

        // Interpolate Projectiles
        // We match projectiles by ID (assuming projectiles have IDs now)
        // If no ID, we can't interpolate, so we just take 'next'
        const prevProjs = prev.projectiles || [];
        const nextProjs = next.projectiles || [];
        
        nextProjs.forEach(np => {
            const pp = prevProjs.find(p => p.id === np.id);
            if (pp) {
                interpolatedProjectiles.push({
                    ...np,
                    x: pp.x + (np.x - pp.x) * ratio,
                    y: pp.y + (np.y - pp.y) * ratio
                });
            } else {
                // New projectile, just render at current pos
                interpolatedProjectiles.push(np);
            }
        });

        return { 
            entities: interpolatedEntities, 
            loot: lootMap, 
            projectiles: interpolatedProjectiles,
            gameTime: next.gameTime 
        };
    }

    getLatestState() {
        if (this.snapshotBuffer.length === 0) return null;
        return this.convertSnapshotToState(this.snapshotBuffer[this.snapshotBuffer.length - 1]);
    }

    convertSnapshotToState(snapshot) {
        return {
            entities: new Map(snapshot.entities),
            loot: new Map(snapshot.loot || []),
            projectiles: snapshot.projectiles || [],
            gameTime: snapshot.gameTime
        };
    }
}