export default class AISystem {
    constructor(gridSystem, combatSystem, lootSystem) {
        this.gridSystem = gridSystem;
        this.combatSystem = combatSystem;
        this.lootSystem = lootSystem;
        this.aiDirs = [{x:0, y:1}, {x:0, y:-1}, {x:1, y:0}, {x:-1, y:0}];
    }

    update(dt, attackCallback) {
        const now = Date.now();
        for (const [id, stats] of this.combatSystem.stats) {
            if (stats.isPlayer) continue;
            
            // AI Logic: 1 second cooldown
            if (now - (stats.lastActionTime || 0) < 1000) continue;

            const pos = this.gridSystem.entities.get(id);
            if (!pos) continue;

            // Optimization: AI Sleep
            // If the monster is too far from any player, skip logic.
            const nearestPlayerId = this.findNearestPlayerId(pos.x, pos.y);
            if (!nearestPlayerId) continue;
            
            const nearestPlayer = this.gridSystem.entities.get(nearestPlayerId);
            const distToPlayer = Math.abs(nearestPlayer.x - pos.x) + Math.abs(nearestPlayer.y - pos.y);
            if (distToPlayer > 25) continue; // Sleep radius (approx 1.5 screens)

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
            }

            if (!targetPos && stats.aiState === 'IDLE') {
                // Roaming Logic
                if (Math.random() < 0.02) { // 2% chance per tick to move
                    const dir = this.aiDirs[Math.floor(Math.random() * this.aiDirs.length)];
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
                    if (attackCallback) attackCallback(id, nearestPlayerId);
                    stats.lastActionTime = now;
                } else {
                    // Move towards player (Simple Axis-Aligned)
                    let moveX = Math.sign(dx);
                    let moveY = Math.sign(dy);
                    
                    // Try move
                    // Check Loot Collision first
                    if (!this.lootSystem.isCollidable(pos.x + moveX, pos.y + moveY)) {
                        this.gridSystem.moveEntity(id, moveX, moveY);
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
}