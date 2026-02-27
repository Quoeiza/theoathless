export default class AISystem {
    constructor(gridSystem, combatSystem, lootSystem) {
        this.gridSystem = gridSystem;
        this.combatSystem = combatSystem;
        this.lootSystem = lootSystem;
        this.aiDirs = [{x:0, y:1}, {x:0, y:-1}, {x:1, y:0}, {x:-1, y:0}];
    }

    update(currentTick, timePerTick, attackCallback) {
        for (const [id, stats] of this.combatSystem.stats) {
            if (stats.isPlayer) continue;
            
            if (currentTick < stats.nextActionTick) continue;

            const pos = this.gridSystem.entities.get(id);
            if (!pos) continue;

            let targetPos = null;
            let shouldAttack = false;
            let nearestPlayer = null;
            let nearestPlayerId = null;

            // Throttling: Only scan for targets periodically
            if (currentTick >= (stats.nextScanTick || 0)) {
                stats.nextScanTick = currentTick + 5; // Scan every 10 ticks (0.5s)
                
                // Optimization: AI Sleep
                // If the monster is too far from any player, skip logic.
                nearestPlayerId = this.findNearestPlayerId(pos.x, pos.y);
                if (nearestPlayerId) {
                    nearestPlayer = this.gridSystem.entities.get(nearestPlayerId);
                    const distToPlayer = Math.abs(nearestPlayer.x - pos.x) + Math.abs(nearestPlayer.y - pos.y);
                    
                    if (distToPlayer <= 25) { // Sleep radius (approx 1.5 screens)
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
                }
            }

            if (!targetPos && stats.aiState === 'IDLE') {
                // Roaming Logic
                if (Math.random() < 0.02) { // 2% chance per tick to move
                    const dir = this.aiDirs[Math.floor(Math.random() * this.aiDirs.length)];
                    if (!this.lootSystem.isCollidable(pos.x + dir.x, pos.y + dir.y)) {
                        this.gridSystem.moveEntity(id, dir.x, dir.y);
                        const cooldownMs = stats.moveSpeed || 1000;
                        stats.nextActionTick = currentTick + Math.ceil(cooldownMs / timePerTick);
                    }
                }
            }

            // Persistence Logic
            if (!targetPos && stats.aiState === 'CHASING' && stats.targetLastPos) {
                stats.memoryTimer -= timePerTick;
                if (stats.memoryTimer > 0) {
                    targetPos = stats.targetLastPos;
                } else {
                    stats.aiState = 'IDLE';
                    stats.targetLastPos = null;
                }
            }

            // If we are chasing, we use the cached target position
            if (stats.aiState === 'CHASING' && stats.targetLastPos && !targetPos) {
                targetPos = stats.targetLastPos;
            }

            if (targetPos) {
                const dx = targetPos.x - pos.x;
                const dy = targetPos.y - pos.y;
                const dist = Math.max(Math.abs(dx), Math.abs(dy));

                if (shouldAttack && dist <= 1) {
                    // Update facing to look at target
                    pos.facing = { x: Math.sign(dx), y: Math.sign(dy) };
                    // Attack (Only if we have actual target/LOS) - nearestPlayerId might be null if we didn't scan this tick, but that's rare in melee range
                    if (attackCallback && nearestPlayerId) attackCallback(id, nearestPlayerId);
                    const cooldownMs = (stats.attackSpeed || 4) * 250;
                    stats.nextActionTick = currentTick + Math.ceil(cooldownMs / timePerTick);
                } else {
                    // Move towards player (Simple Axis-Aligned)
                    let moveX = Math.sign(dx);
                    let moveY = Math.sign(dy);
                    
                    // Try move
                    // Check Loot Collision first
                    if (!this.lootSystem.isCollidable(pos.x + moveX, pos.y + moveY)) {
                        this.gridSystem.moveEntity(id, moveX, moveY);
                    }
                    const cooldownMs = stats.moveSpeed || 1000;
                    stats.nextActionTick = currentTick + Math.ceil(cooldownMs / timePerTick);
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