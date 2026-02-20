import EventEmitter from './EventEmitter.js';

export default class CombatSystem extends EventEmitter {
    constructor(enemiesConfig) {
        super();
        this.enemiesConfig = enemiesConfig;
        this.stats = new Map(); // EntityID -> { hp, maxHp, damage }
        this.cooldowns = new Map(); // EntityID -> timestamp
        this.lootSystem = null;
        
        this.classes = {
            'Fighter': { str: 15, agi: 15, will: 15, ability: 'Second Wind', cooldown: 15000 },
            'Rogue': { str: 10, agi: 25, will: 10, ability: 'Hide', cooldown: 20000 },
            'Barbarian': { str: 25, agi: 10, will: 10, ability: 'Rage', cooldown: 25000 }
        };
    }

    setLootSystem(lootSystem) {
        this.lootSystem = lootSystem;
    }

    clear() {
        this.stats.clear();
        this.cooldowns.clear();
    }

    registerEntity(id, type, isPlayer = false, playerClass = 'Fighter', name = null) {
        let stats = { 
            hp: 100, 
            maxHp: 100, 
            damage: 10, 
            isPlayer, 
            type, 
            lastActionTime: 0,
            team: 'player',
            aiState: 'IDLE',
            targetLastPos: null,
            memoryTimer: 0,
            class: playerClass,
            invisible: false,
            damageBuff: 0,
            name: name || type,
            attributes: { str: 10, agi: 10, will: 10 }
        };
        
        if (this.enemiesConfig[type]) {
            const cfg = this.enemiesConfig[type];
            stats = { 
                hp: cfg.hp, maxHp: cfg.hp, damage: cfg.damage, isPlayer, type, lastActionTime: 0, team: 'monster', aiState: 'IDLE', targetLastPos: null, memoryTimer: 0, invisible: false, name: cfg.name || type, attributes: { str: 10, agi: 10, will: 10 },
                attackSpeed: cfg.attackSpeed || 4,
                moveSpeed: cfg.moveSpeed || 4
            };
        } else if (isPlayer && this.classes[playerClass]) {
            // Apply Class Stats
            const c = this.classes[playerClass];
            stats.attributes = { str: c.str, agi: c.agi, will: c.will };
            
            // Derive Stats
            // HP = Base 80 + Str * 2
            stats.maxHp = 80 + (c.str * 2);
            stats.hp = stats.maxHp;
            
            // Base Damage Modifier (handled in damage calc)
            // Action Speed (handled in main loop via Agi)
        }

        this.stats.set(id, stats);
    }

    useAbility(id) {
        const stats = this.stats.get(id);
        if (!stats || !stats.isPlayer) return null;

        const now = Date.now();
        const lastUse = this.cooldowns.get(id) || 0;
        const classDef = this.classes[stats.class];
        
        if (!classDef) return null;
        if (now - lastUse < classDef.cooldown) return null; // On Cooldown

        this.cooldowns.set(id, now);
        
        // Execute Ability
        let result = { type: 'ABILITY', ability: classDef.ability, id };
        
        switch (stats.class) {
            case 'Fighter': // Second Wind
                const heal = 40;
                stats.hp = Math.min(stats.maxHp, stats.hp + heal);
                result.effect = 'heal';
                result.value = heal;
                break;
            case 'Rogue': // Hide
                stats.invisible = true;
                result.effect = 'stealth';
                result.duration = 5000;
                setTimeout(() => { 
                    if (this.stats.has(id)) this.stats.get(id).invisible = false; 
                }, 5000);
                break;
            case 'Barbarian': // Rage
                stats.damageBuff = 10;
                result.effect = 'buff';
                setTimeout(() => { 
                    if (this.stats.has(id)) this.stats.get(id).damageBuff = 0; 
                }, 8000);
                break;
        }
        
        return result;
    }

    applyDamage(targetId, amount, sourceId, options = {}) {
        const targetStats = this.stats.get(targetId);
        const sourceStats = this.stats.get(sourceId);
        if (!targetStats) return;

        // Apply Buffs
        let finalDamage = amount;
        if (sourceStats && sourceStats.damageBuff) {
            finalDamage += sourceStats.damageBuff;
        }
        
        // Attribute Scaling (Strength)
        if (sourceStats && sourceStats.attributes) {
            finalDamage += Math.floor((sourceStats.attributes.str - 10) * 0.5);
        }

        // Apply Defense
        if (this.lootSystem) {
            const mods = this.lootSystem.getStatsModifier(targetId);
            if (mods.defense > 0) {
                finalDamage = Math.max(1, finalDamage - mods.defense);
            }
        }

        // Break Stealth on damage taken
        if (targetStats.invisible) targetStats.invisible = false;
        // Break Stealth on attack (handled in main logic usually, but good to flag here)
        if (sourceStats && sourceStats.invisible) sourceStats.invisible = false;

        targetStats.hp -= finalDamage;
        this.emit('damage', { targetId, amount: finalDamage, sourceId, currentHp: targetStats.hp, options });

        if (targetStats.hp <= 0) {
            this.handleDeath(targetId, sourceId);
        }
    }

    handleDeath(entityId, killerId) {
        const stats = this.stats.get(entityId);
        this.stats.delete(entityId);
        this.emit('death', { entityId, killerId, stats });
    }

    getStats(id) {
        return this.stats.get(id);
    }

    syncRemoteStats(id, data) {
        // Populate local cache with server data for targeting checks
        let stats = this.stats.get(id);
        if (!stats) {
            stats = { 
                hp: data.hp, 
                maxHp: data.maxHp, 
                team: data.team, 
                type: data.type,
                isPlayer: data.type === 'player',
                invisible: data.invisible
            };
            this.stats.set(id, stats);
        } else {
            stats.hp = data.hp;
            stats.maxHp = data.maxHp;
            stats.team = data.team;
            stats.invisible = data.invisible;
        }
    }

    findBestTarget(gridSystem, myId, cursorX, cursorY, radius) {
        const myStats = this.stats.get(myId);
        if (!myStats) return null;

        let bestId = null;
        let minDst = radius * radius;

        for (const [id, pos] of gridSystem.entities) {
            if (id === myId) continue;

            const stats = this.stats.get(id);
            if (!stats) continue;

            let isHostile = false;
            if (myStats.team === 'monster') {
                if (stats.team === 'player') isHostile = true;
            } else {
                if (stats.team === 'monster' || stats.team === 'player') isHostile = true;
            }
            
            if (!isHostile) continue;

            const dx = pos.x - cursorX;
            const dy = pos.y - cursorY;
            const dstSq = dx*dx + dy*dy;

            if (dstSq <= minDst) {
                minDst = dstSq;
                bestId = id;
            }
        }
        return bestId;
    }

    getHumanCount() {
        let count = 0;
        for (const stats of this.stats.values()) {
            if (stats.isPlayer && stats.team === 'player') count++;
        }
        return count;
    }

    getRandomMonsterType() {
        const types = Object.keys(this.enemiesConfig);
        return types[Math.floor(Math.random() * types.length)];
    }

    resolveAttack(attackerId, targetId, gridSystem, lootSystem) {
        const attackerPos = gridSystem.entities.get(attackerId);
        const targetPos = gridSystem.entities.get(targetId);
        if (!attackerPos || !targetPos) return null;

        const attackerStats = this.getStats(attackerId);
        const targetStats = this.getStats(targetId);
        if (attackerStats && targetStats && attackerStats.team === 'monster' && targetStats.team === 'monster') {
            return null;
        }

        const equip = lootSystem.getEquipment(attackerId);
        const weapon = equip.weapon;
        let config = null;
        if (weapon) config = lootSystem.getItemConfig(weapon.itemId);

        if (config && config.range > 1) {
            const dx = targetPos.x - attackerPos.x;
            const dy = targetPos.y - attackerPos.y;
            const mag = Math.sqrt(dx*dx + dy*dy);
            
            return {
                type: 'RANGED',
                projectile: {
                    x: attackerPos.x,
                    y: attackerPos.y,
                    vx: dx/mag,
                    vy: dy/mag,
                    speed: 15,
                    ownerId: attackerId,
                    damage: config.damage
                }
            };
        }

        let damage = 5;
        if (attackerStats && attackerStats.team === 'monster') {
            damage = attackerStats.damage;
        } else if (config && config.damage) {
            damage = config.damage;
        }
        const isCrit = Math.random() < 0.15;
        if (isCrit) damage = Math.floor(damage * 1.5);

        return {
            type: 'MELEE',
            damage,
            isCrit,
            attackerPos,
            targetPos
        };
    }

    respawnPlayerAsMonster(entityId, gridSystem) {
        const type = this.getRandomMonsterType();
        const spawn = gridSystem.getSpawnPoint(false);
        
        gridSystem.addEntity(entityId, spawn.x, spawn.y);
        this.registerEntity(entityId, type, true);
        
        return { type, x: spawn.x, y: spawn.y };
    }

    createProjectile(ownerId, x, y, dx, dy, lootSystem) {
        const equip = lootSystem.getEquipment(ownerId);
        const weapon = equip.weapon;
        let config = null;
        if (weapon) config = lootSystem.getItemConfig(weapon.itemId);

        if (config && config.range > 1) {
            const mag = Math.sqrt(dx*dx + dy*dy);
            const vx = mag === 0 ? 0 : dx/mag;
            const vy = mag === 0 ? 0 : dy/mag;
            
            if (vx === 0 && vy === 0) return null;

            return {
                id: `proj_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                x, y, vx, vy,
                speed: 15,
                ownerId,
                damage: config.damage
            };
        }
        return null;
    }

    updateProjectiles(dt, projectiles, gridSystem) {
        const projSpeed = dt / 1000;
        
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            
            const totalMove = p.speed * projSpeed;
            const steps = Math.ceil(totalMove / 0.5);
            const stepMove = totalMove / steps;
            
            let hit = false;
            for (let s = 0; s < steps; s++) {
                p.x += p.vx * stepMove;
                p.y += p.vy * stepMove;

                const gridX = Math.round(p.x);
                const gridY = Math.round(p.y);

                if (!gridSystem.isWalkable(gridX, gridY)) {
                    projectiles[i] = projectiles[projectiles.length - 1];
                    projectiles.pop();
                    hit = true;
                    break;
                }

                const hitId = gridSystem.getEntityAt(gridX, gridY);
                if (hitId && hitId !== p.ownerId) {
                    this.applyDamage(hitId, p.damage, p.ownerId);
                    projectiles[i] = projectiles[projectiles.length - 1];
                    projectiles.pop();
                    hit = true;
                    break;
                }
            }
        }
    }

    applyConsumableEffect(entityId, effect) {
        if (!effect) return null;
        
        if (effect.effect === 'heal') {
            const stats = this.getStats(entityId);
            if (stats) {
                stats.hp = Math.min(stats.maxHp, stats.hp + effect.value);
                this.emit('damage', { targetId: entityId, amount: -effect.value, sourceId: entityId, currentHp: stats.hp });
                return { type: 'heal', value: effect.value };
            }
        }
        return null;
    }

    calculateCooldown(entityId, baseCooldown) {
        const stats = this.getStats(entityId);
        if (!stats) return baseCooldown;
        
        let cooldown = baseCooldown;
        if (stats.attributes) {
            const agiFactor = Math.max(0.5, 1 - ((stats.attributes.agi - 10) * 0.02));
            cooldown *= agiFactor;
        }
        return cooldown;
    }

    isFriendly(id1, id2) {
        const s1 = this.getStats(id1);
        const s2 = this.getStats(id2);
        // Monsters cannot hurt other monsters. Players can hurt everyone (PvP).
        return (s1 && s2 && s1.team === 'monster' && s2.team === 'monster');
    }

    processTargetAction(entityId, gridX, gridY, gridSystem, lootSystem) {
        const pos = gridSystem.entities.get(entityId);
        if (!pos) return null;

        const dx = gridX - pos.x;
        const dy = gridY - pos.y;
        
        if (dx !== 0 || dy !== 0) {
            pos.facing = gridSystem.getFacingFromVector(dx, dy);
        }

        const proj = this.createProjectile(entityId, pos.x, pos.y, dx, dy, lootSystem);
        if (proj) {
            return { type: 'PROJECTILE', projectile: proj };
        }

        const adjX = pos.x + pos.facing.x;
        const adjY = pos.y + pos.facing.y;
        const adjId = gridSystem.getEntityAt(adjX, adjY);

        return adjId 
            ? { type: 'MELEE', targetId: adjId } 
            : { type: 'MISS', x: adjX, y: adjY };
    }

    processAttackIntent(entityId, gridSystem) {
        const attacker = gridSystem.entities.get(entityId);
        if (!attacker) return null;

        const targetX = attacker.x + attacker.facing.x;
        const targetY = attacker.y + attacker.facing.y;
        const targetId = gridSystem.getEntityAt(targetX, targetY);

        return targetId 
            ? { type: 'MELEE', targetId } 
            : { type: 'MISS', x: targetX, y: targetY };
    }
}