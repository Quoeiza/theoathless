

import { NetworkEvents } from './NetworkEvents.js';
import GridSystem from './GridSystem.js';
import CombatSystem from './CombatSystem.js';
import LootSystem from './LootSystem.js';
import AISystem from './AISystem.js';
import fs from 'fs';
import path from 'path';

const readJSON = (file) => JSON.parse(fs.readFileSync(path.resolve('scripts', file)));

const itemsConfig = readJSON('items.json');
const enemiesConfig = readJSON('enemies.json');
const globalConfig = readJSON('global.json');

/**
 * A fixed-step game loop implementation.
 * This class ensures that the game simulation (update logic) runs at a consistent
 * rate.
 */
class Ticker {
    /**
     * @param {function(number): void} updateFn - The function to call for each fixed-step update. It receives the fixed time step (delta time) as an argument.
     * @param {number} [tickRate=20] - The desired number of simulation updates per second.
     */
    constructor(updateFn, tickRate = 20) {
        this.updateFn = updateFn;
        
        /** @type {number} The desired number of simulation updates per second. */
        this.tickRate = tickRate;
        
        /** @type {number} The time in milliseconds per simulation tick. */
        this.timePerTick = 1000 / tickRate;
        if (!Number.isFinite(this.timePerTick) || this.timePerTick < 1) {
            this.timePerTick = 50; // Safety fallback (20 TPS)
        }

        /** @private @type {number} The timestamp of the last loop execution. */
        this.lastTime = 0;
        
        /** @private @type {number} Accumulates elapsed time to determine when to run the next update. */
        this.accumulator = 0;
        
        /** @private @type {boolean} Flag indicating if the loop is currently running. */
        this.isRunning = false;
        
        /** @private @type {?NodeJS.Timeout} The ID of the current timer. */
        this.timerId = null;

        /** @type {number} The current simulation tick count. */
        this.tick = 0;
    }

    /**
     * Starts the game loop.
     */
    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTime = Date.now();
        this.loop();
    }

    /**
     * Stops the game loop.
     */
    stop() {
        this.isRunning = false;
        if (this.timerId) {
            clearTimeout(this.timerId);
        }
        this.timerId = null;
    }

    /**
     * The main loop, driven by setTimeout.
     * @private
     */
    loop() {
        if (!this.isRunning) return;

        const now = Date.now();
        let deltaTime = now - this.lastTime;
        this.lastTime = now;

        // Cap deltaTime to prevent a "spiral of death" if the server is overloaded.
        if (deltaTime > 1000) {
            deltaTime = 1000;
        }
        
        this.accumulator += deltaTime;

        let updates = 0;
        try {
            // Perform a fixed number of updates based on the accumulated time.
            while (this.accumulator >= this.timePerTick) {
                this.tick++;
                this.updateFn(this.timePerTick); // Pass fixed delta time to the update function.
                this.accumulator -= this.timePerTick;
                
                // Safety break to prevent the game from getting stuck in an update spiral on slow devices.
                if (++updates > 10) { 
                    this.accumulator = 0; 
                    break;
                }
            }
        } catch (e) {
            console.error("Ticker Crash Recovered:", e);
        }
        
        // Schedule the next loop iteration.
        const timeToNextTick = Math.max(0, this.timePerTick - (Date.now() - now));
        this.timerId = setTimeout(() => this.loop(), timeToNextTick);
    }
}

export class Game {
    constructor() {
        this.config = {
            items: itemsConfig,
            enemies: enemiesConfig,
            global: globalConfig
        };

        this.ticker = new Ticker(this.update.bind(this), this.config.global.tickRate);
        
        this.gridSystem = new GridSystem(
            this.config.global.dungeonWidth, 
            this.config.global.dungeonHeight, 
            this.config.global.tileSize
        );
        this.combatSystem = new CombatSystem(this.config.enemies);
        this.lootSystem = new LootSystem(this.config.items);
        this.combatSystem.setLootSystem(this.lootSystem);
        this.aiSystem = new AISystem(this.gridSystem, this.combatSystem, this.lootSystem);

        this.worldState = {
            projectiles: [],
            gameTime: this.config.global.escapeTimeSeconds,
            escapeOpen: false,
            gameOver: false,
        };

        this.onPlayerRemoved = null;
        this.onWorldUpdate = null;
    }

    startGame() {
        this.lootSystem.clear();
        this.combatSystem.clear();
        this.gridSystem.initializeDungeon();
        this.gridSystem.populate(this.combatSystem, this.lootSystem, this.config);

        this.worldState.gameTime = this.config.global.escapeTimeSeconds;
        this.ticker.start();
    }


    update(dt) {
        if (dt > 100) dt = 100;

        this.worldState.gameTime -= (dt / 1000);
            
        if (!this.worldState.escapeOpen && this.worldState.gameTime <= 60) {
            this.worldState.escapeOpen = true;
            const pos = this.gridSystem.spawnEscapePortal();
            if (this.onWorldUpdate) {
                this.onWorldUpdate({ type: NetworkEvents.PORTAL_SPAWN, payload: { x: pos.x, y: pos.y } });
            }
        }

        if (!this.worldState.gameOver && this.worldState.gameTime <= 0) {
            this.worldState.gameOver = true;
            if (this.onWorldUpdate) {
                this.onWorldUpdate({ type: NetworkEvents.HUMANS_ESCAPED, payload: { message: "Time Expired - Dungeon Collapsed" } });
            }
        }

        this.combatSystem.updateProjectiles(dt, this.worldState.projectiles, this.gridSystem);
        this.gridSystem.processLavaDamage(dt, this.combatSystem);
        this.aiSystem.update(this.ticker.tick, this.ticker.timePerTick, (attackerId, targetId) => this.performAttack(attackerId, targetId));
    }


    stop() {
        this.ticker.stop();
    }

    
    /**
     * Retrieves the current, authoritative state of the game world.
     * This method is intended to be called by the network layer to get data
     * for broadcasting to clients.
     * @returns {object} A snapshot of the game state.
     */
    getAuthoritativeState() {
        // Serialize Entities (Map -> Array) and merge with Combat Stats
        const entities = [];
        for (const [id, pos] of this.gridSystem.entities) {
            const stats = this.combatSystem.getStats(id) || {};
            entities.push([id, { ...pos, ...stats }]);
        }

        // Construct the full state object
        const state = {
            ...this.worldState,
            grid: this.gridSystem.grid,
            entities: entities,
            loot: Array.from(this.lootSystem.worldLoot.entries())
        };

        return JSON.parse(JSON.stringify(state));
    }

    /**
     * Adds a new player to the game world.
     * @param {string} playerId - The unique identifier for the player.
     * @param {object} playerData - The initial data for the player (e.g., position).
     */
    addPlayer(playerId, playerData) {
        const spawn = this.gridSystem.getSpawnPoint(true);
        this.gridSystem.addEntity(playerId, spawn.x, spawn.y);
        this.combatSystem.registerEntity(playerId, 'player', true, playerData.class || 'Fighter', playerData.name || 'Unknown');
        const stats = this.combatSystem.getStats(playerId);
        if (stats) stats.gold = playerData.gold || 0;

        // Starter Items for Client
        this.lootSystem.addItemToEntity(playerId, 'sword_basic', 1);
        this.lootSystem.addItemToEntity(playerId, 'armor_leather', 1);
        
        console.log(`Player ${playerId} added.`);
    }

    /**
     * Removes a player from the game world.
     * @param {string} playerId - The unique identifier for the player.
     */
    removePlayer(playerId) {
        this.gridSystem.removeEntity(playerId);
        this.combatSystem.stats.delete(playerId);
        console.log(`Player ${playerId} removed.`);
        if (this.onPlayerRemoved) {
            this.onPlayerRemoved(playerId);
        }
    }

    /**
     * Processes an input command from a player.
     * @param {string} playerId - The ID of the player sending the input.
     * @param {object} input - The input data (e.g., { action: 'move', direction: 'up' }).
     */
    handlePlayerInput(playerId, input) {
        // This will be the new entry point for all player actions from the server.
        // It will replace the complex client-side `handleInput`, `executeAction`, `processPlayerInput` etc.
        const { intent } = input;
        if (!intent || !intent.type) return;

        let stats = this.combatSystem.getStats(playerId);
        if (!stats) return;

        if (this.ticker.tick < stats.nextActionTick) {
            return; // Cooldown not met
        }
        
        const cooldownMs = this.combatSystem.calculateCooldown(playerId, this.config.global.globalCooldownMs || 250);
        let cooldownTicks = Math.ceil(cooldownMs / this.ticker.timePerTick);
        stats.nextActionTick = this.ticker.tick + cooldownTicks;
        
        // Mark the last processed input tick on the player's state
        stats.lastProcessedInputTick = input.tick;

        if (intent.type === 'MOVE') {
            this.processMove(playerId, intent.direction);
        }
        // ... other intent types will be handled here
    }

    processMove(playerId, direction) {
        const result = this.gridSystem.resolveMoveIntent(playerId, direction, this.lootSystem, false);

        switch (result.type) {
            case 'MOVED':
                if (this.gridSystem.grid[Math.round(result.y)][Math.round(result.x)] === 9) {
                    this.handleEscape(playerId);
                }
                break;
            case 'BUMP_ENTITY':
                if (!this.combatSystem.isFriendly(playerId, result.targetId)) {
                    this.performAttack(playerId, result.targetId);
                }
                break;
            case 'INTERACT_LOOT':
                this.processLootInteraction(playerId, result.loot);
                break;
        }
    }
    
    performAttack(attackerId, targetId) {
        const result = this.combatSystem.resolveAttack(attackerId, targetId, this.gridSystem, this.lootSystem);
        if (!result) return;

        if (result.type === 'RANGED') {
            const proj = { 
                id: `proj_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                ...result.projectile 
            };
            this.worldState.projectiles.push(proj);
            if (this.onWorldUpdate) this.onWorldUpdate({ type: NetworkEvents.SPAWN_PROJECTILE, payload: proj });
            
        } else if (result.type === 'MELEE') {
            this.combatSystem.applyDamage(targetId, result.damage, attackerId, { isCrit: result.isCrit });
        }
    }

    processLootInteraction(entityId, loot) {
        const result = this.lootSystem.resolveInteraction(entityId, loot.id);
        // ... notify clients of the result
    }

    handleEscape(entityId) {
        console.log(`Processing escape for ${entityId}`);
        // ... logic from GameLoop
    }
}
