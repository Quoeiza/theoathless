import EventEmitter from '../core/EventEmitter.js';

export default class CombatSystem extends EventEmitter {
    constructor(enemiesConfig) {
        super();
        this.enemiesConfig = enemiesConfig;
        this.stats = new Map(); // EntityID -> { hp, maxHp, damage }
        this.cooldowns = new Map(); // EntityID -> timestamp
        
        this.classes = {
            'Fighter': { str: 15, agi: 15, will: 15, ability: 'Second Wind', cooldown: 15000 },
            'Rogue': { str: 10, agi: 25, will: 10, ability: 'Hide', cooldown: 20000 },
            'Barbarian': { str: 25, agi: 10, will: 10, ability: 'Rage', cooldown: 25000 }
        };
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
            stats = { hp: cfg.hp, maxHp: cfg.hp, damage: cfg.damage, isPlayer, type, lastActionTime: 0, team: 'monster', aiState: 'IDLE', targetLastPos: null, memoryTimer: 0, invisible: false, name: cfg.name || type, attributes: { str: 10, agi: 10, will: 10 } };
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

    getSurvivorCount() {
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
        const weaponId = equip.weapon;
        let config = null;
        if (weaponId) config = lootSystem.getItemConfig(weaponId);

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

        let damage = attackerStats ? attackerStats.damage : 5;
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
}