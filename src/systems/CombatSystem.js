import EventEmitter from '../core/EventEmitter.js';

export default class CombatSystem extends EventEmitter {
    constructor(enemiesConfig) {
        super();
        this.enemiesConfig = enemiesConfig;
        this.stats = new Map(); // EntityID -> { hp, maxHp, damage }
    }

    registerEntity(id, type, isPlayer = false) {
        let stats = { hp: 100, maxHp: 100, damage: 10, isPlayer, type, lastActionTime: 0 };
        
        if (!isPlayer && this.enemiesConfig[type]) {
            const cfg = this.enemiesConfig[type];
            stats = { hp: cfg.hp, maxHp: cfg.hp, damage: cfg.damage, isPlayer, type, lastActionTime: 0 };
        }

        this.stats.set(id, stats);
    }

    applyDamage(targetId, amount, sourceId) {
        const targetStats = this.stats.get(targetId);
        if (!targetStats) return;

        targetStats.hp -= amount;
        this.emit('damage', { targetId, amount, sourceId, currentHp: targetStats.hp });

        if (targetStats.hp <= 0) {
            this.handleDeath(targetId, sourceId);
        }
    }

    handleDeath(entityId, killerId) {
        this.stats.delete(entityId);
        this.emit('death', { entityId, killerId });
    }

    getStats(id) {
        return this.stats.get(id);
    }
}