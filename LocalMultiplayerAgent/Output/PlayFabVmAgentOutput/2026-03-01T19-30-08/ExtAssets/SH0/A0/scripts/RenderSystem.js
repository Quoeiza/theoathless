import { TileMapSystem, dungeonTilesetConfig } from './TileMapSystem.js';

const noise = (x, y) => {
    return Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
};

export default class RenderSystem {
    constructor(canvasId, width, height, tileSize) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.ctx.imageSmoothingEnabled = false;
        this.tileSize = tileSize || 48; // Match tile manager config
        this.targetHeight = 720; // Lock vertical resolution to 720p (15 tiles)
        this.maxAspectRatio = 16 / 9;
        this.scale = 1;
        this.lightRadius = 250;
        this.lightFalloff = 0.5; // Controls the gradient curve (0.0 - 1.0)
        this.bufferMargin = 50; // Margin for shake/overscan

        // Lighting Layer
        this.lightCanvas = document.createElement('canvas');
        this.lightCtx = this.lightCanvas.getContext('2d');
        // Dimensions set in resize()

        // Shadow Layer (Offscreen)
        this.shadowCanvas = document.createElement('canvas');
        this.shadowCtx = this.shadowCanvas.getContext('2d');
        // Dimensions set in resize()

        window.addEventListener('resize', () => this.resize());
        this.resize(); // Initialize sizes

        // TileMap System for sprite-based rendering
        this.tileMapSystem = new TileMapSystem(dungeonTilesetConfig);

        // Camera
        this.camera = { x: 0, y: 0, isReady: false };
        
        // Visual Effects
        this.effects = []; // { x, y, type, startTime, duration }
        this.floatingTexts = []; // { x, y, text, color, startTime, duration }
        this.visualEntities = new Map(); // id -> { x, y, targetX, targetY, startX, startY, moveStartTime, attackStart, flashStart, bumpStart, bumpDir }
        this.shake = { intensity: 0, duration: 0, startTime: 0 };
        this.assetLoader = null;

        this.torchState = {
            hue: 0,
            targetHue: 0,
            lastShift: 0,
            nextShiftDelay: 0
        };

        // Performance Caching
        this.staticCacheBottom = document.createElement('canvas');
        this.staticCtxBottom = this.staticCacheBottom.getContext('2d');
        this.staticCacheWalls = document.createElement('canvas');
        this.staticCtxWalls = this.staticCacheWalls.getContext('2d');
        this.staticCacheTop = document.createElement('canvas');
        this.staticCtxTop = this.staticCacheTop.getContext('2d');
        this.lastGridRevision = -1;
        this.shadowCasters = []; // Reuse array to reduce GC
        this.shadowMaskers = []; // Reuse array to reduce GC
        this.shadowPoints = []; // Reuse array for hull calculation
        this.hullBuffer = [];   // Reuse array for hull results
        this.hullLower = [];    // Reuse buffer for hull calc
        this.hullUpper = [];    // Reuse buffer for hull calc
        this.shadowCorners = [ {x:0,y:0}, {x:0,y:0}, {x:0,y:0}, {x:0,y:0} ]; // Reuse corner objects
        this.shadowPointPool = []; // Pool for projected points

        this.bloodParticles = [];
        this.particlePool = [];

        // Shadow Segment Pooling to reduce GC
        this.segmentPool = [];
        this.segmentPoolIndex = 0;

        // Render List Pooling
        this.renderList = [];
        this.renderPool = []; // Pool for render items
        this.renderPoolIndex = 0;
        this.meshVisited = new Set(); // Reuse Set for meshing to reduce GC
        this.cachedShadowCasters = [];
        this.shadowCasterRevision = -1;
        this.explored = new Set(); // Track explored tiles for Auto-Explore
        this.settings = { shadows: true, particles: true, dynamicLights: true };
        this.enemiesConfig = {};
    }

    applySettings(settings) {
        this.settings = settings;
    }

    setAssetLoader(loader) {
        this.assetLoader = loader;

        // After setting the loader, immediately start loading the tilemap assets
        const p1 = this.tileMapSystem.loadAssets(loader).catch(err => {
            console.error("Failed to load tilemap assets:", err);
        });

        return p1;
    }

    setGridSystem(gridSystem) {
        this.gridSystem = gridSystem;
    }

    setCombatSystem(combatSystem) {
        this.combatSystem = combatSystem;
    }

    setEnemiesConfig(config) {
        this.enemiesConfig = config || {};
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        // Calculate scale to lock vertical height
        this.scale = this.canvas.height / this.targetHeight;
        
        // Size lighting buffers to Game Resolution
        const gameW = this.canvas.width / this.scale;
        const gameH = this.canvas.height / this.scale;
        this.lightCanvas.width = gameW + (this.bufferMargin * 2);
        this.lightCanvas.height = gameH + (this.bufferMargin * 2);
        this.shadowCanvas.width = gameW + (this.bufferMargin * 2);
        this.shadowCanvas.height = gameH + (this.bufferMargin * 2);
        this.ctx.imageSmoothingEnabled = false;
        this.lightCtx.imageSmoothingEnabled = false;
        this.shadowCtx.imageSmoothingEnabled = false;
    }

    clear() {
        this.ctx.fillStyle = '#050505';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    updateStaticCache(grid) {
        if (!grid || !grid.length) return;
        const h = grid.length;
        const w = grid[0].length;
        const ts = this.tileSize;

        // Resize caches if dimensions changed
        if (this.staticCacheBottom.width !== w * ts || this.staticCacheBottom.height !== h * ts) {
            this.staticCacheBottom.width = w * ts;
            this.staticCacheBottom.height = h * ts;
            this.staticCacheWalls.width = w * ts;
            this.staticCacheWalls.height = h * ts;
            this.staticCacheTop.width = w * ts;
            this.staticCacheTop.height = h * ts;
        }

        const ctxB = this.staticCtxBottom;
        const ctxW = this.staticCtxWalls;
        const ctxT = this.staticCtxTop;

        // Clear
        ctxB.clearRect(0, 0, w * ts, h * ts);
        ctxW.clearRect(0, 0, w * ts, h * ts);
        ctxT.clearRect(0, 0, w * ts, h * ts);

        // Render entire map to cache
        const viewBounds = { startCol: 0, endCol: w - 1, startRow: 0, endRow: h - 1 };

        // 1. Bottom Layer: Floors and Walls
        this.tileMapSystem.drawFloor(ctxB, grid, viewBounds);
        
        this.tileMapSystem.drawWalls(ctxW, grid, viewBounds);

        // 2. Top Layer: Roofs
        this.tileMapSystem.drawRoof(ctxT, grid, viewBounds);
    }

    drawFloor(grid, width, height) {
        if (!grid || !grid.length) return;

        const ts = this.tileSize;
        const camX = Math.floor(this.camera.x);
        const camY = Math.floor(this.camera.y);
        
        // Define view bounds for culling
        const startCol = Math.floor(camX / ts);
        const endCol = startCol + (this.canvas.width / this.scale / ts) + 2;
        const startRow = Math.floor(camY / ts);
        const endRow = startRow + (this.canvas.height / this.scale / ts) + 2;
        const viewBounds = { startCol, endCol, startRow, endRow };

        // --- Pass 1: Draw Cached Static Floor ---
        this.ctx.save();
        this.ctx.translate(-camX, -camY);
        this.ctx.drawImage(this.staticCacheBottom, 0, 0);

        // --- Pass 1.5: Draw Animated Liquids (Water) ---
        this.tileMapSystem.drawLiquids(this.ctx, grid, viewBounds, Date.now());
        this.ctx.restore();

        // --- Pass 2: Draw procedural floor tiles ---
        for (let y = startRow; y <= endRow; y++) {
            for (let x = startCol; x <= endCol; x++) {
                if (y < 0 || y >= height || x < 0 || x >= width) continue;

                const tile = grid[y][x];
                // Mark as explored if visible
                this.explored.add(`${x},${y}`);

                // Only draw DYNAMIC tiles here. Static ones (Mud) are cached.
                // 2=Water, 4=Lava, 9=Escape
                if (tile === 4 || tile === 9) {
                    const screenX = (x * ts) - camX;
                    const screenY = (y * ts) - camY;
                    const n = noise(x, y);

                    // Re-add procedural rendering for special tiles
                    if (tile === 4) { // Lava
                        const glse = Math.sin(Date.now() / 300);
                        this.ctx.fillStyle = `rgb(${200 + pulse * 50}, 50, 0)`;
                        this.ctx.fillRect(screenX, screenY, ts, ts);
                        this.ctx.fillStyle = '#ffeb3b';
                        if (n > 0.7) this.ctx.fillRect(screenX + n*(ts * 0.625), screenY + n*(ts * 0.625), ts * 0.125, ts * 0.125);
                    } else if (tile === 9) { // Escape Portal
                        const pulse = (Math.sin(Date.now() / 200) + 1) / 2;
                        const centerX = screenX + (ts * 0.5);
                        const centerY = screenY + (ts * 0.5);
                        const grad = this.ctx.createRadialGradient(centerX, centerY, ts * 0.1, centerX, centerY, ts * 0.45);
                        grad.addColorStop(0, '#e0ffff');
                        grad.addColorStop(0.5, '#00ffff');
                        grad.addColorStop(1, `rgba(0, 100, 255, ${0.2 + pulse * 0.3})`);
                        this.ctx.fillStyle = grad;
                        this.ctx.beginPath();
                        this.ctx.arc(centerX, centerY, ts * 0.45, 0, Math.PI * 2);
                        this.ctx.fill();
                    }
                }
            }
        }

        // --- Pass 3: Draw Cached Static Walls ---
        this.ctx.save();
        this.ctx.translate(-camX, -camY);
        this.ctx.drawImage(this.staticCacheWalls, 0, 0);
        this.ctx.restore();
    }

    drawWalls(grid, width, height) {
        if (!grid || !grid.length) return;

        const ts = this.tileSize;
        const camX = Math.floor(this.camera.x);
        const camY = Math.floor(this.camera.y);
        
        // Define view bounds for culling
        const startCol = Math.floor(camX / ts);
        const endCol = startCol + (this.canvas.width / this.scale / ts) + 2;
        const startRow = Math.floor(camY / ts);
        const endRow = startRow + (this.canvas.height / this.scale / ts) + 2;
        const viewBounds = { startCol, endCol, startRow, endRow };

        // Base walls are already drawn in staticCacheBottom in drawFloor

        // --- Pass 2: Draw procedural wall tiles ---
        for (let y = startRow; y <= endRow; y++) {
            for (let x = startCol; x <= endCol; x++) {
                if (y < 0 || y >= height || x < 0 || x >= width) continue;

                const tile = grid[y][x];
                if (tile !== 0 && tile !== 1) {
                    const screenX = (x * ts) - camX;
                    const screenY = (y * ts) - camY;

                    if (tile === 5) { // Wall Torch
                        this.ctx.fillStyle = '#8B4513';
                        this.ctx.fillRect(screenX + (ts * 0.375), screenY + (ts * 0.3125), ts * 0.25, ts * 0.3125);
                        const flicker = Math.random() * (ts * 0.125);
                        this.ctx.fillStyle = `rgba(255, ${100 + flicker * 20}, 0, 0.8)`;
                        this.ctx.beginPath();
                        this.ctx.arc(screenX + (ts * 0.5), screenY + (ts * 0.25), (ts * 0.125) + flicker/2, 0, Math.PI*2);
                        this.ctx.fill();
                    }
                }
            }
        }
    }

    drawRoof(grid, width, height) {
        const camX = Math.floor(this.camera.x);
        const camY = Math.floor(this.camera.y);
        this.ctx.save();
        this.ctx.translate(-camX, -camY);
        this.ctx.drawImage(this.staticCacheTop, 0, 0);
        this.ctx.restore();
    }

    triggerShake(intensity, duration) {
        this.shake.intensity = intensity;
        this.shake.duration = duration;
        this.shake.startTime = Date.now();
    }

    triggerDamage(targetId, sourceId) {
        const visual = this.visualEntities.get(targetId);
        if (!visual) return;

        visual.flashStart = Date.now();
        visual.flashColor = '#ff0000';

        // Calculate Recoil Vector
        let dx = 0, dy = 0;
        if (sourceId && this.gridSystem) {
            const sourcePos = this.gridSystem.entities.get(sourceId);
            if (sourcePos) {
                dx = visual.x - sourcePos.x;
                dy = visual.y - sourcePos.y;
            }
        }
        // Fallback random recoil if no source or stacked
        if (dx === 0 && dy === 0) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; }

        const len = Math.sqrt(dx*dx + dy*dy) || 1;
        const ndx = dx / len;
        const ndy = dy / len;

        visual.recoilX = ndx * 0.25; 
        visual.recoilY = ndy * 0.25;
        visual.recoilStart = Date.now();

        // Spawn Blood Particles
        for (let i = 0; i < 15; i++) {
            this.spawnParticle(visual.x, visual.y, ndx, ndy, '#800');
        }
    }

    triggerHitFlash(id) { // Legacy support
        const visual = this.visualEntities.get(id);
        if (visual) visual.flashStart = Date.now();
        if (visual) visual.flashColor = '#ffffff';
    }

    triggerAttack(id) {
        const visual = this.visualEntities.get(id);
        if (visual) {
            visual.attackStart = Date.now();
        }
    }

    triggerMove(id, newPos) {
        let visual = this.visualEntities.get(id);
        if (!visual) return; // Don't trigger moves for entities we're not tracking

        // Start new movement interpolation from current visual spot
        visual.startX = visual.x;
        visual.startY = visual.y;
        visual.targetX = newPos.x;
        visual.targetY = newPos.y;
        visual.moveStartTime = Date.now();
    }

    triggerBump(id, dir) {
        const visual = this.visualEntities.get(id);
        if (visual) {
            visual.bumpStart = Date.now();
            visual.bumpDir = dir;
        }
    }

    triggerDeath(id) {
        const visual = this.visualEntities.get(id);
        if (visual) {
            visual.isDying = true;
            visual.deathStart = Date.now();
        }
    }

    spawnParticle(x, y, dirX, dirY, color = '#800', speedOverride = null, sizeOverride = null) {
        if (!this.settings.particles) return;
        const p = this.particlePool.pop() || { x:0, y:0, vx:0, vy:0, life:0, maxLife:0 };
        p.x = x + (Math.random() - 0.5) * 0.2;
        p.y = y + (Math.random() - 0.5) * 0.2;
        
        const speed = speedOverride !== null ? speedOverride : (0.05 + Math.random() * 0.15);
        const spread = 0.8; // High spread
        
        // Mix directional velocity with random spread
        p.vx = dirX * speed + (Math.random() - 0.5) * spread * speed;
        p.vy = dirY * speed + (Math.random() - 0.5) * spread * speed;
        
        p.life = 1.0;
        p.maxLife = 1.0;
        p.size = sizeOverride !== null ? sizeOverride : (0.02 + Math.random() * 0.03);
        p.color = color;
        this.bloodParticles.push(p);
    }

    getShadowPoint() {
        if (this.shadowPointPool.length > 0) {
            return this.shadowPointPool.pop();
        }
        return { x: 0, y: 0 };
    }

    drawEntities(entities, localPlayerId, drawMode = 'ALL', ctx = this.ctx, isHost = false) {
        const now = Date.now();
        const localPlayer = entities.get(localPlayerId);
        
        // Calculate View Bounds for Culling
        const camX = this.camera.x;
        const camY = this.camera.y;
        const viewW = this.canvas.width / this.scale;
        const viewH = this.canvas.height / this.scale;
        const margin = this.tileSize * 2; // Allow some overhang for sprites/shadows

        // 2. Update Visual State & Prepare Render List
        this.renderList.length = 0;
        const renderList = this.renderList;
        this.renderPoolIndex = 0;

        // Create a combined list of all entities we might need to render:
        // - All current visual entities
        // - Any new authoritative entities that don't have a visual yet
        const idsToProcess = new Set(this.visualEntities.keys());
        entities.forEach((_, id) => idsToProcess.add(id));

        for (const id of idsToProcess) {
            let visual = this.visualEntities.get(id);
            const pos = entities.get(id); // Authoritative state from GridSystem

            if (pos) {
                // --- ENTITY IS ALIVE ---
                if (drawMode === 'REMOTE' && id === localPlayerId) continue;
                if (drawMode === 'LOCAL' && id !== localPlayerId) continue;

                if (!visual) {
                    visual = { 
                        x: pos.x, y: pos.y, 
                        targetX: pos.x, targetY: pos.y,
                        startX: pos.x, startY: pos.y,
                        moveStartTime: 0,
                        attackStart: 0, flashStart: 0,
                        bumpStart: 0, bumpDir: null,
                        lastFacingX: -1, // Default Left
                        opacity: (id === localPlayerId) ? 1 : 0, // Start visible for self, fade in for others
                        idlePhase: Math.random() * Math.PI * 2,
                        recoilX: 0, recoilY: 0, recoilStart: 0,
                        isDying: false, deathStart: 0,
                        flashColor: '#ffffff'
                    };
                    this.visualEntities.set(id, visual);
                }

                // Resurrection Check: If entity was dying but is now alive (respawned)
                if (visual.isDying && pos.hp > 0) {
                    visual.isDying = false;
                    visual.opacity = 0;
                    visual.x = pos.x;
                    visual.y = pos.y;
                    visual.startX = pos.x;
                    visual.startY = pos.y;
                    visual.targetX = pos.x;
                    visual.targetY = pos.y;
                }

                // Detect authoritative position change (e.g. from network update)
                let effectiveTargetX = pos.x;
                let effectiveTargetY = pos.y;
                const isLocal = (id === localPlayerId);

                // Force discrete targeting for remote entities to smooth out network jitter
                // SyncManager provides interpolated floats, but we want to animate grid-to-grid.
                if (!isHost && !isLocal) {
                    effectiveTargetX = Math.round(pos.x);
                    effectiveTargetY = Math.round(pos.y);
                }

                if (effectiveTargetX !== visual.targetX || effectiveTargetY !== visual.targetY) {
                    visual.startX = visual.x;
                    visual.startY = visual.y;
                    visual.targetX = effectiveTargetX;
                    visual.targetY = effectiveTargetY;
                    visual.moveStartTime = now;
                }

                // Interpolation Logic
                if (!visual.isDying) {
                    // Always use discrete animation logic for grid entities
                    const moveDuration = 250; 
                    visual.moveT = Math.min(1, (now - visual.moveStartTime) / moveDuration);
                    visual.animT = visual.moveT;
                    
                    visual.x = visual.startX + (visual.targetX - visual.startX) * visual.moveT;
                    visual.y = visual.startY + (visual.targetY - visual.startY) * visual.moveT;
                } else {
                    visual.moveT = 1; // Animation is finished if dying
                    visual.animT = 0;
                }

                // Cache static data needed for rendering after death
                let type = pos.type;
                if (!type && this.combatSystem) {
                    const stats = this.combatSystem.getStats(id);
                    if (stats) type = stats.type;
                }
                visual.type = type; // Cache it

                // Optimization: View Frustum Culling
                const screenX = (visual.x * this.tileSize) - camX;
                const screenY = (visual.y * this.tileSize) - camY;
                if (screenX < -margin || screenX > viewW + margin || screenY < -margin || screenY > viewH + margin) {
                    continue;
                }

                // Line of Sight Check & Fading
                let hasLOS = true;
                if (localPlayer && id !== localPlayerId && this.gridSystem) {
                    hasLOS = this.gridSystem.hasLineOfSight(localPlayer.x, localPlayer.y, pos.x, pos.y);
                }
                const targetOpacity = hasLOS ? 1.0 : 0.0;
                visual.opacity += (targetOpacity - visual.opacity) * 0.1;
                if (Math.abs(targetOpacity - visual.opacity) < 0.01) visual.opacity = targetOpacity;

                if (visual.opacity > 0.01) {
                    // Optimization: Object Pooling for Render List
                    let item = this.renderPool[this.renderPoolIndex++];
                    if (!item) {
                        item = { id: null, pos: null, visual: null, screenX: 0, screenY: 0 };
                        this.renderPool.push(item);
                    }
                    item.id = id;
                    item.pos = pos;
                    item.visual = visual;
                    renderList.push(item);
                }
            } else if (visual && visual.isDying && (now - visual.deathStart <= 1000)) {
                // --- ENTITY IS DEAD, BUT ANIMATION IS PLAYING ---
                // Create a fake `pos` object for the render loop, using cached visual data.
                const fakePos = { 
                    type: visual.type, 
                    facing: { x: visual.lastFacingX, y: 0 }, 
                    hp: 0, maxHp: 1, // Ensures no health bar is drawn
                    invisible: false 
                };
                
                let item = this.renderPool[this.renderPoolIndex++];
                if (!item) {
                    item = { id: null, pos: null, visual: null, screenX: 0, screenY: 0 };
                    this.renderPool.push(item);
                }
                item.id = id;
                item.pos = fakePos;
                item.visual = visual;
                renderList.push(item);
            } else {
                // --- ENTITY IS GONE AND NOT ANIMATING ---
                this.visualEntities.delete(id);
            }
        }

        // 3. Depth Sort (Y-sort)
        renderList.sort((a, b) => {
            if (a.visual.y !== b.visual.y) return a.visual.y - b.visual.y;
            return a.id < b.id ? -1 : 1; // Stable sort fallback (faster than localeCompare)
        });

        // 4. Render
        for (const item of renderList) {
            const { id, pos, visual } = item;
            // Hop Animation (Based on interpolation progress 't' for a smooth arc)
            const hopOffset = -Math.sin(visual.animT * Math.PI) * (this.tileSize * 0.125);
            
            // Idle Animation (Breathing & Swaying)
            let scaleY = 1;
            let scaleX = 1;
            let rotation = 0;
            if (!visual.isDying) {
                // Subtle breathing: Slower speed, slight chest expansion (X), reduced vertical bob (Y)
                const breath = Math.sin(now * 0.003 + visual.idlePhase);
                scaleY = 1 + (breath * 0.012); 
                scaleX = 1 + (breath * 0.006);
            }

            // Recoil Offset
            let recoilOffX = 0;
            let recoilOffY = 0;
            if (now - visual.recoilStart < 200) {
                const t = 1 - ((now - visual.recoilStart) / 200);
                recoilOffX = visual.recoilX * t * this.tileSize;
                recoilOffY = visual.recoilY * t * this.tileSize;
            }

            // Stealth Check
            let alpha = visual.opacity;
            if (pos.invisible) {
                if (id !== localPlayerId) continue; // Completely invisible to others
                alpha *= 0.5; // Ghostly for self
            }
            ctx.globalAlpha = alpha;

            // Calculate Attack Shove Offset
            let offsetX = 0;
            let offsetY = 0;
            if (now - visual.attackStart < 150) { // 150ms animation
                const progress = (now - visual.attackStart) / 150;
                const shove = Math.sin(progress * Math.PI) * (this.tileSize * 0.25); // Forward shove
                if (pos.facing) {
                    offsetX = pos.facing.x * shove;
                    offsetY = pos.facing.y * shove;
                }
            }

            // Calculate Bump Offset (Collision feedback)
            let bumpX = 0;
            let bumpY = 0;
            if (now - visual.bumpStart < 150) {
                const progress = (now - visual.bumpStart) / 150;
                const bumpDist = Math.sin(progress * Math.PI) * (this.tileSize * 0.15);
                if (visual.bumpDir) {
                    bumpX = visual.bumpDir.x * bumpDist;
                    bumpY = visual.bumpDir.y * bumpDist;
                }
            }

            const screenX = (visual.x * this.tileSize) - this.camera.x + offsetX + bumpX + recoilOffX;
            const screenY = (visual.y * this.tileSize) - this.camera.y + offsetY + hopOffset + bumpY + recoilOffY;
            
            item.screenX = screenX;
            item.screenY = screenY;

            // Shadow
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.beginPath();
            ctx.ellipse(screenX + (this.tileSize * 0.5), screenY + (this.tileSize * 0.875), this.tileSize * 0.3125, this.tileSize * 0.125, 0, 0, Math.PI * 2);
            ctx.fill();

            // Determine Sprite
            let type = pos.type;
            if (!type && this.combatSystem) {
                const stats = this.combatSystem.getStats(id);
                if (stats) type = stats.type;
            }

            let spriteKey = null;
            if (type === 'player') {
                spriteKey = 'eliteknight.png';
            } else if (this.enemiesConfig && this.enemiesConfig[type]) {
                spriteKey = this.enemiesConfig[type].sprite;
            }
            
            const img = this.assetLoader ? this.assetLoader.getImage(spriteKey) : null;

            if (img) {
                // --- Sprite Rendering ---
                ctx.save();

                // Update Facing Memory (Retain last horizontal direction)
                if (pos.facing && pos.facing.x !== 0) {
                    visual.lastFacingX = pos.facing.x;
                }
                const facingX = visual.lastFacingX;

                const centerX = screenX + (this.tileSize * 0.5);
                const centerY = screenY + (this.tileSize * 0.5);

                ctx.translate(centerX, centerY + (this.tileSize / 2)); // Pivot at feet

                const spriteW = img.width;
                const spriteH = img.height;
                let drawX = -spriteW / 2;

                // Sprite defaults to Left. Flip if facing Right.
                if (facingX > 0) {
                    ctx.scale(-1, 1);
                    drawX -= 1; // Fix 1px offset when flipped
                }

                ctx.rotate(rotation);
                ctx.scale(scaleX, scaleY);

                const drawY = -spriteH; // Draw upwards from feet

                // Flash Effect (Red Tint) - Apply filter before draw
                const isFlashing = (now - visual.flashStart < 100);
                if (isFlashing) {
                    // Subtle red tint using CSS filters on the context
                    ctx.filter = 'sepia(1) hue-rotate(-50deg) saturate(3) brightness(0.8)';
                }

                // Dissolve Logic (Top-Down)
                if (visual.isDying) {
                    const duration = 750;
                    const progress = (now - visual.deathStart) / duration;
                    if (progress < 1) {
                        // Death Effect: Grayscale + Lighter + Transparent
                        ctx.filter = 'grayscale(100%) brightness(50%)';
                        ctx.globalAlpha = alpha * 0.7;

                        // Chevron "Pile of Sand" Clip
                        const chevronDepth = spriteH * 0.4;
                        const level = (progress * (spriteH + chevronDepth)) - chevronDepth;

                        ctx.beginPath();
                        ctx.moveTo(drawX, drawY + spriteH); // Bottom Left
                        ctx.lineTo(drawX + spriteW, drawY + spriteH); // Bottom Right
                        ctx.lineTo(drawX + spriteW, drawY + Math.max(0, level + chevronDepth)); // Right Cut
                        ctx.lineTo(drawX + (spriteW / 2), drawY + Math.max(0, level)); // Middle Peak
                        ctx.lineTo(drawX, drawY + Math.max(0, level + chevronDepth)); // Left Cut
                        ctx.closePath();
                        ctx.clip();

                        ctx.drawImage(img, drawX, drawY, spriteW, spriteH);

                        // Spawn Ash Particles at the dissolve line
                        const spriteHeightInTiles = spriteH / this.tileSize;
                        const dissolveY = visual.y - spriteHeightInTiles + (level / this.tileSize);
                        
                        if (Math.random() < 0.5) {
                            const pX = visual.x + (Math.random() - 0.5) * 0.5;
                            // Downward drift
                            this.spawnParticle(pX, dissolveY, 0, 1, '#666', 0.02, 0.04);
                        }
                    }
                } else {
                    // Normal Draw
                    ctx.drawImage(img, drawX, drawY, spriteW, spriteH);
                }

                if (isFlashing || visual.isDying) {
                    ctx.filter = 'none';
                }

                ctx.restore();
            }
            
            ctx.globalAlpha = 1.0; // Reset
        }
    }

    drawHPBars() {
        const ctx = this.ctx;
        for (const { id, pos, screenX, screenY } of this.renderList) {
            // Resolve HP from CombatSystem if missing on entity (e.g. local GridSystem entity)
            let hp = pos.hp;
            let maxHp = pos.maxHp;
            if ((hp === undefined || maxHp === undefined) && this.combatSystem) {
                const stats = this.combatSystem.getStats(id);
                if (stats) {
                    hp = stats.hp;
                    maxHp = stats.maxHp;
                }
            }

            // Health Bar (Curved under sprite)
            if (hp !== undefined && maxHp !== undefined && hp > 0) {
                const hpRatio = maxHp > 0 ? Math.max(0, hp / maxHp) : 0;
                const cx = screenX + (this.tileSize * 0.5);
                const cy = screenY + (this.tileSize * 1); // Position slightly below feet
                
                const w = this.tileSize * 0.35;
                const h = this.tileSize * 0.2;  // Curve depth
                const th = this.tileSize * 0.05; // Thickness
                const tipR = this.tileSize * 0.02; // Nub radius

                const definePath = () => {
                    ctx.beginPath();
                    // Left Nub (Bottom to Top)
                    ctx.arc(cx - w, cy, tipR, Math.PI * 0.5, Math.PI * 1.5);
                    // Top Curve
                    ctx.quadraticCurveTo(cx, cy + h - th, cx + w, cy - tipR);
                    // Right Nub (Top to Bottom)
                    ctx.arc(cx + w, cy, tipR, -Math.PI * 0.5, Math.PI * 0.5);
                    // Bottom Curve
                    ctx.quadraticCurveTo(cx, cy + h, cx - w, cy + tipR);
                    ctx.closePath();
                };

                // Background
                definePath();
                ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                ctx.fill();

                // Foreground
                if (hpRatio > 0) {
                    ctx.save();
                    definePath();
                    ctx.clip();
                    ctx.fillStyle = hpRatio > 0.5 ? '#4d4' : '#d44';
                    ctx.fillRect(cx - w, cy, (2 * w) * hpRatio, h);
                    ctx.restore();
                }

                // Border
                definePath();
                ctx.lineWidth = 0.3;
                ctx.strokeStyle = '#000';
                ctx.stroke();
            }
        }
    }

    updateCamera(targetX, targetY) {
        // Smooth Camera Follow
        // Center on the tile (add half tile size)
        const centerOffset = this.tileSize * 0.5;
        const targetCamX = ((targetX * this.tileSize) + centerOffset) - (this.canvas.width / (2 * this.scale));
        const targetCamY = ((targetY * this.tileSize) + centerOffset) - (this.canvas.height / (2 * this.scale));
        
        if (!Number.isFinite(targetCamX) || !Number.isFinite(targetCamY)) return;

        // Snap camera on first update to prevent zooming from 0,0
        if (!this.camera.isReady) {
            this.camera.x = targetCamX;
            this.camera.y = targetCamY;
            this.camera.isReady = true;
        }

        // Smooth Lerp Camera
        this.camera.x += (targetCamX - this.camera.x) * 0.1;
        this.camera.y += (targetCamY - this.camera.y) * 0.1;

        if (Math.abs(targetCamX - this.camera.x) < 0.5) this.camera.x = targetCamX;
        if (Math.abs(targetCamY - this.camera.y) < 0.5) this.camera.y = targetCamY;
    }

    drawLoot(lootMap) {
        lootMap.forEach((loot) => {
            const screenX = (loot.x * this.tileSize) - this.camera.x;
            const screenY = (loot.y * this.tileSize) - this.camera.y;
            
            if (loot.type === 'bag') {
                // Draw Bag (Sack)
                const grad = this.ctx.createRadialGradient(screenX + (this.tileSize * 0.5), screenY + (this.tileSize * 0.625), this.tileSize * 0.06, screenX + (this.tileSize * 0.5), screenY + (this.tileSize * 0.625), this.tileSize * 0.3125);
                grad.addColorStop(0, '#D2C290');
                grad.addColorStop(1, '#8B7355');
                
                this.ctx.fillStyle = grad;
                this.ctx.beginPath();
                this.ctx.arc(screenX + (this.tileSize * 0.5), screenY + (this.tileSize * 0.625), this.tileSize * 0.3125, 0, Math.PI * 2);
                this.ctx.fill();
                
                this.ctx.fillStyle = '#5C4033'; // Tie
                this.ctx.fillRect(screenX + (this.tileSize * 0.4375), screenY + (this.tileSize * 0.25), this.tileSize * 0.125, this.tileSize * 0.1875);
                return;
            }

            if (loot.opened) {
                // Draw Opened Chest (Empty)
                this.ctx.fillStyle = '#3e2723'; // Darker Brown
                this.ctx.fillRect(screenX + (this.tileSize * 0.125), screenY + (this.tileSize * 0.25), this.tileSize - (this.tileSize * 0.25), this.tileSize - (this.tileSize * 0.375));
                this.ctx.fillStyle = '#1a1a1a'; // Empty inside
                this.ctx.fillRect(screenX + (this.tileSize * 0.1875), screenY + (this.tileSize * 0.3125), this.tileSize - (this.tileSize * 0.375), this.tileSize - (this.tileSize * 0.5));
            } else {
                // Draw Closed Chest
                // Box Gradient
                const grad = this.ctx.createLinearGradient(screenX, screenY + (this.tileSize * 0.25), screenX, screenY + (this.tileSize * 0.875));
                grad.addColorStop(0, '#8d6e63');
                grad.addColorStop(1, '#4e342e');
                this.ctx.fillStyle = grad;
                this.ctx.fillRect(screenX + (this.tileSize * 0.125), screenY + (this.tileSize * 0.25), this.tileSize - (this.tileSize * 0.25), this.tileSize - (this.tileSize * 0.375));
                
                // Lid
                this.ctx.fillStyle = '#6d4c41';
                this.ctx.fillRect(screenX + (this.tileSize * 0.0625), screenY + (this.tileSize * 0.1875), this.tileSize - (this.tileSize * 0.125), this.tileSize * 0.1875);
                
                // Gold Lock
                this.ctx.fillStyle = '#ffb300';
                this.ctx.fillRect(screenX + (this.tileSize / 2) - (this.tileSize * 0.0625), screenY + (this.tileSize * 0.28), this.tileSize * 0.125, this.tileSize * 0.125);
                this.ctx.strokeStyle = '#3e2723';
                this.ctx.strokeRect(screenX + (this.tileSize * 0.125), screenY + (this.tileSize * 0.25), this.tileSize - (this.tileSize * 0.25), this.tileSize - (this.tileSize * 0.375));
            }
        });
    }

    updateAndDrawParticles() {
        const ts = this.tileSize;
        const dt = 16 / 1000; // Approx dt
        
        for (let i = this.bloodParticles.length - 1; i >= 0; i--) {
            const p = this.bloodParticles[i];
            p.life -= dt;
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.9; // Drag
            p.vy *= 0.9;

            if (p.life <= 0) {
                this.particlePool.push(p);
                this.bloodParticles[i] = this.bloodParticles[this.bloodParticles.length - 1];
                this.bloodParticles.pop();
                continue;
            }

            const sx = (p.x * ts) - this.camera.x;
            const sy = (p.y * ts) - this.camera.y;
            this.ctx.fillStyle = p.color || '#800';
            this.ctx.fillRect(sx, sy, ts * p.size, ts * p.size);
        }
    }

    addEffect(x, y, type) {
        this.effects.push({
            x, y, type,
            startTime: Date.now(),
            duration: 200 // ms
        });
    }

    drawEffects() {
        const now = Date.now();
        this.effects = this.effects.filter(e => now - e.startTime < e.duration);

        this.effects.forEach(e => {
            const screenX = (e.x * this.tileSize) - this.camera.x;
            const screenY = (e.y * this.tileSize) - this.camera.y;

            if (e.type === 'slash') {
                this.ctx.strokeStyle = '#FFF';
                this.ctx.lineWidth = 3;
                this.ctx.beginPath();
                this.ctx.moveTo(screenX, screenY);
                this.ctx.lineTo(screenX + this.tileSize, screenY + this.tileSize);
                this.ctx.stroke();
            }

            if (e.type === 'dust') {
                const progress = (now - e.startTime) / e.duration;
                const radius = (this.tileSize * 0.15) * (1 - progress);
                this.ctx.fillStyle = `rgba(200, 200, 200, ${0.5 * (1 - progress)})`;
                this.ctx.beginPath();
                this.ctx.arc(screenX + (this.tileSize * 0.5), screenY + (this.tileSize * 0.875), radius, 0, Math.PI * 2);
                this.ctx.fill();
            }
        });
    }

    addFloatingText(x, y, text, color) {
        this.floatingTexts.push({
            x, y, text, color,
            startTime: Date.now(),
            duration: 1000,
            driftX: (Math.random() - 0.5) * this.tileSize,
            driftY: (this.tileSize * 0.5) + Math.random() * (this.tileSize * 0.5)
        });
    }

    drawFloatingTexts() {
        const now = Date.now();
        this.floatingTexts = this.floatingTexts.filter(t => now - t.startTime < t.duration);

        this.ctx.textAlign = 'center';
        this.ctx.shadowColor = 'black';
        this.ctx.shadowBlur = 2;

        this.floatingTexts.forEach(t => {
            const elapsed = now - t.startTime;
            const progress = Math.min(1, elapsed / t.duration);
            
            const startX = (t.x * this.tileSize) - this.camera.x + (this.tileSize / 2);
            const startY = (t.y * this.tileSize) - this.camera.y - (this.tileSize * 0.8);

            const screenX = startX + (t.driftX * progress);
            const screenY = startY - (t.driftY * progress);

            // Pop effect
            let scale = 1.0;
            if (progress < 0.2) scale = 1 + (progress * 2);
            else scale = 1.4 - ((progress - 0.2) * 0.5);

            this.ctx.fillStyle = t.color;
            this.ctx.font = `bold ${Math.max(8, Math.floor(10 * scale))}px "Germania One"`;
            this.ctx.globalAlpha = 1 - Math.pow(progress, 3); // Fade out
            this.ctx.fillText(t.text, screenX, screenY);
            this.ctx.globalAlpha = 1.0;
        });
        this.ctx.shadowBlur = 0;
    }

    drawProjectiles(projectiles) {
        projectiles.forEach(p => {
            const screenX = (p.x * this.tileSize) - this.camera.x;
            const screenY = (p.y * this.tileSize) - this.camera.y;
            
            // Draw Arrow
            this.ctx.save();
            this.ctx.translate(screenX + this.tileSize/2, screenY + this.tileSize/2);
            this.ctx.rotate(Math.atan2(p.vy, p.vx));
            
            this.ctx.fillStyle = '#fff';
            this.ctx.fillRect(-(this.tileSize * 0.25), -(this.tileSize * 0.03), this.tileSize * 0.5, this.tileSize * 0.06); // Shaft
            this.ctx.fillStyle = '#888';
            this.ctx.fillRect((this.tileSize * 0.1875), -(this.tileSize * 0.06), this.tileSize * 0.06, this.tileSize * 0.125); // Tip
            this.ctx.fillStyle = 'rgb(108, 56, 37)';
            this.ctx.fillRect(-(this.tileSize * 0.25), -(this.tileSize * 0.06), this.tileSize * 0.125, this.tileSize * 0.125); // Fletching
            
            this.ctx.restore();
        });
    }

    drawInteractionBar(interaction, playerPos) {
        if (!interaction || !playerPos) return;
        
        const screenX = (playerPos.x * this.tileSize) - this.camera.x;
        const screenY = (playerPos.y * this.tileSize) - this.camera.y;
        const progress = Math.min(1, (Date.now() - interaction.startTime) / interaction.duration);

        // Border
        this.ctx.fillStyle = '#222';
        this.ctx.fillRect(screenX - 2, screenY - (this.tileSize * 0.3) - 2, this.tileSize + 4, this.tileSize * 0.1875 + 4);

        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(screenX, screenY - (this.tileSize * 0.3), this.tileSize, this.tileSize * 0.1875);
        this.ctx.fillStyle = '#FFD700';
        this.ctx.fillRect(screenX + (this.tileSize * 0.03), screenY - (this.tileSize * 0.28), (this.tileSize - (this.tileSize * 0.06)) * progress, this.tileSize * 0.125);
    }

    isFloor(t) {
        return t === 0 || t === 2 || t === 4 || t === 9;
    }

    isLightBlocking(grid, x, y) {
        // LINKED SYSTEM: Use TileMapManager for visual consistency.
        // Use GridSystem collision logic for visual consistency with LOS.
        if (this.gridSystem) {
            return !this.gridSystem.isWalkable(x, y);
        }

        // Fallback
        if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length) return false;
        const t = grid[y][x];
        return t === 1 || t === 5;
    }

    checkLineOfSight(grid, x0, y0, x1, y1) {
        let x = Math.floor(x0);
        let y = Math.floor(y0);
        const tx = Math.floor(x1);
        const ty = Math.floor(y1);

        const dx = Math.abs(tx - x);
        const dy = Math.abs(ty - y);
        const sx = (x < tx) ? 1 : -1;
        const sy = (y < ty) ? 1 : -1;
        let err = dx - dy;

        const startX = x;
        const startY = y;

        let loops = 0;
        while (true) {
            if (loops++ > 1000) return false; // Safety break
            if (x === tx && y === ty) return true; // Reached target
            
            // Check collision (ignore start tile and target tile)
            if ((x !== startX || y !== startY) && (x !== tx || y !== ty)) {
                if (this.isLightBlocking(grid, x, y)) return false;
            }

            let e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x += sx; }
            if (e2 < dx) { err += dx; y += sy; }
        }
    }

    // Helper to recycle shadow segment objects
    getShadowSegment(x, y) {
        if (this.segmentPoolIndex >= this.segmentPool.length) {
            this.segmentPool.push({ x, y, w: 1, h: 1 });
        }
        const seg = this.segmentPool[this.segmentPoolIndex++];
        seg.x = x;
        seg.y = y;
        seg.w = 1;
        seg.h = 1;
        return seg;
    }

    rebuildShadowCasters(grid) {
        this.cachedShadowCasters = [];
        const w = grid[0].length;
        const h = grid.length;

        // Casters are walls that are NOT walkable (colliding).
        const isCaster = (x, y) => {
            return this.tileMapSystem.getTileVal(grid, x, y) === 1 && 
                   (!this.gridSystem || !this.gridSystem.isWalkable(x, y));
        };

        this.meshVisited.clear();

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const key = (y << 16) | x;
                if (this.meshVisited.has(key)) continue;

                if (isCaster(x, y)) {
                    let width = 1;
                    while (x + width < w && isCaster(x + width, y) && !this.meshVisited.has((y << 16) | (x + width))) {
                        width++;
                    }
                    
                    let height = 1;
                    let canExtend = true;
                    while (y + height < h && canExtend) {
                        for (let k = 0; k < width; k++) {
                            const checkX = x + k;
                            const checkY = y + height;
                            const checkKey = (checkY << 16) | checkX;
                            if (!isCaster(checkX, checkY) || this.meshVisited.has(checkKey)) {
                                canExtend = false;
                                break;
                            }
                        }
                        if (canExtend) height++;
                    }

                    this.cachedShadowCasters.push({ x, y, w: width, h: height });

                    for (let iy = 0; iy < height; iy++) {
                        for (let ix = 0; ix < width; ix++) {
                            this.meshVisited.add(((y + iy) << 16) | (x + ix));
                        }
                    }
                }
            }
        }
        this.shadowCasterRevision = this.lastGridRevision;
    }

    drawShadowLayer(grid, playerVisual, entities) {
        if (!this.settings.shadows) {
            this.shadowCtx.clearRect(0, 0, this.shadowCanvas.width, this.shadowCanvas.height);
            return;
        }

        if (!playerVisual) return;

        this.segmentPoolIndex = 0; // Reset pool pointer

        const sCtx = this.shadowCtx;
        const w = this.shadowCanvas.width;
        const h = this.shadowCanvas.height;
        const ts = this.tileSize;

        const camX = Math.floor(this.camera.x);
        const camY = Math.floor(this.camera.y);

        // Torch Configuration
        const screenRadius = this.lightRadius;
        const radius = screenRadius / ts; // Tiles
        const px = playerVisual.x;
        const py = playerVisual.y;
        
        const lOffX = 0.5;
        const lOffY = 0.5;

        // Prepare Shadow Canvas
        sCtx.save();
        sCtx.translate(this.bufferMargin, this.bufferMargin);
        sCtx.clearRect(0, 0, w - (this.bufferMargin * 2), h - (this.bufferMargin * 2));
        
        // Optimization: Only calculate shadows within the light radius + padding
        const rBuffer = Math.ceil(radius) + 2;
        
        const camStartCol = Math.floor(this.camera.x / ts) - 2;
        const camEndCol = camStartCol + (this.canvas.width / this.scale / ts) + 4;
        const camStartRow = Math.floor(this.camera.y / ts) - 2;
        const camEndRow = camStartRow + (this.canvas.height / this.scale / ts) + 4;

        const startCol = Math.max(camStartCol, Math.floor(px - rBuffer));
        const endCol = Math.min(camEndCol, Math.ceil(px + rBuffer));
        const startRow = Math.max(camStartRow, Math.floor(py - rBuffer));
        const endRow = Math.min(camEndRow, Math.ceil(py + rBuffer));

        const startY = Math.max(0, Math.floor(startRow));
        const endY = Math.min(grid.length - 1, Math.floor(endRow));
        const startX = Math.max(0, Math.floor(startCol));
        const endX = Math.min(grid[0].length - 1, Math.floor(endCol));

        // Check if we need to rebuild the static shadow casters
        if (this.shadowCasterRevision !== this.lastGridRevision) {
            this.rebuildShadowCasters(grid);
        }

        // Filter cached casters to only those near the player (Optimization)
        // We use the cached list instead of scanning the grid every frame.
        this.shadowCasters = this.cachedShadowCasters.filter(c => {
            // Simple AABB overlap check with the light radius box
            return (c.x < endCol && c.x + c.w > startCol &&
                    c.y < endRow && c.y + c.h > startRow);
        });

        sCtx.save();
        
        // Draw Shadow Volumes from casters
        sCtx.globalCompositeOperation = 'source-over';
        sCtx.fillStyle = '#FFFFFF';
        sCtx.filter = 'blur(4px)'; 

        for (const wall of this.shadowCasters) {
            this.drawShadowVolume(sCtx, wall.x, wall.y, wall.w, wall.h, px, py, radius, lOffX, lOffY);
        }
        sCtx.filter = 'none';

        // Make Void tiles appear in shadow
        sCtx.globalCompositeOperation = 'source-over';
        sCtx.fillStyle = '#FFFFFF';
        
        for (let y = startY; y <= endY; y++) {
            for (let x = startX; x <= endX; x++) {
                if (this.tileMapSystem.shouldDrawVoid(grid, x, y)) {
                    const tx = (x * ts) - camX;
                    const ty = (y * ts) - camY;
                    sCtx.fillRect(tx, ty, ts, ts);
                }
            }
        }

        // Mask out Wall Faces so they don't cast shadows on themselves or neighbors
        sCtx.globalCompositeOperation = 'destination-out';
        sCtx.fillStyle = '#FFFFFF';

        for (let y = startY; y <= endY; y++) {
            for (let x = startX; x <= endX; x++) {
                if (this.tileMapSystem.isFrontFace(grid, x, y)) {
                    const tx = (x * ts) - camX;
                    const ty = (y * ts) - camY;
                    sCtx.fillRect(tx, ty, ts, ts);
                }
            }
        }

        // Project floor shadows onto walls vertically
        sCtx.globalCompositeOperation = 'source-over';
        
        // Iterate Bottom-Up to handle stacked walls
        for (let y = endY; y >= startY; y--) {
            for (let x = startX; x <= endX; x++) {
                if (this.tileMapSystem.isFrontFace(grid, x, y)) {
                    const tx = (x * ts) - camX;
                    const ty = (y * ts) - camY;

                    sCtx.drawImage(
                        this.shadowCanvas,
                        tx + this.bufferMargin, ty + ts + this.bufferMargin, ts, 1,
                        tx, ty, ts, ts
                    );
                }
            }
        }

        // Mask out Entities so they are not in shadow
        sCtx.globalCompositeOperation = 'destination-out';
        if (entities) {
            this.visualEntities.forEach((visual, id) => {
                if (entities.has(id)) {
                    const pos = entities.get(id);

                    let alpha = visual.opacity;
                    if (pos.invisible) {
                        if (visual !== playerVisual) {
                            alpha = 0;
                        } else {
                            alpha *= 0.5;
                        }
                    }
                    if (alpha < 0.05) return;

                    const now = Date.now();
                    let offsetX = 0, offsetY = 0, bumpX = 0, bumpY = 0, recoilOffX = 0, recoilOffY = 0;

                    if (now - visual.attackStart < 150) {
                        const progress = (now - visual.attackStart) / 150;
                        const shove = Math.sin(progress * Math.PI) * (ts * 0.25);
                        if (pos.facing) { offsetX = pos.facing.x * shove; offsetY = pos.facing.y * shove; }
                    }
                    if (now - visual.bumpStart < 150) {
                        const progress = (now - visual.bumpStart) / 150;
                        const bumpDist = Math.sin(progress * Math.PI) * (ts * 0.15);
                        if (visual.bumpDir) { bumpX = visual.bumpDir.x * bumpDist; bumpY = visual.bumpDir.y * bumpDist; }
                    }
                    if (now - visual.recoilStart < 200) {
                        const t = 1 - ((now - visual.recoilStart) / 200);
                        recoilOffX = visual.recoilX * t * ts;
                        recoilOffY = visual.recoilY * t * ts;
                    }

                    const tx = Math.floor((visual.x * ts) - Math.floor(this.camera.x) + offsetX + bumpX + recoilOffX);
                    const ty = Math.floor((visual.y * ts) - Math.floor(this.camera.y) + offsetY + bumpY + recoilOffY);
                    
                    let type = pos.type;
                    if (!type && this.combatSystem) {
                        const stats = this.combatSystem.getStats(id);
                        if (stats) type = stats.type;
                    }

                    let spriteKey = null;
                    if (type === 'player') {
                        spriteKey = 'eliteknight.png';
                    } else if (this.enemiesConfig && this.enemiesConfig[type]) {
                        spriteKey = this.enemiesConfig[type].sprite;
                    }
                    
                    const img = this.assetLoader ? this.assetLoader.getImage(spriteKey) : null;

                    sCtx.save();
                    sCtx.globalAlpha = alpha;

                    if (img) {
                        const hopOffset = -Math.sin(Math.PI * Math.max(Math.abs(visual.x % 1), Math.abs(visual.y % 1))) * (ts * 0.125);
                        let scaleY = 1, scaleX = 1, rotation = 0;
                        if (!visual.isDying) {
                            const breath = Math.sin(now * 0.003 + visual.idlePhase);
                            scaleY = 1 + (breath * 0.012);
                            scaleX = 1 + (breath * 0.006);
                        }

                        const centerX = tx + (ts * 0.5);
                        const centerY = ty + (ts * 0.5) + hopOffset;
                        sCtx.translate(centerX, centerY + (ts / 2));

                        const facingX = visual.lastFacingX !== undefined ? visual.lastFacingX : (pos.facing ? pos.facing.x : -1);
                        const spriteW = img.width;
                        const spriteH = img.height;
                        let drawX = -spriteW / 2;

                        if (facingX > 0) {
                            sCtx.scale(-1, 1);
                            drawX -= 1;
                        }

                        sCtx.rotate(rotation);
                        sCtx.scale(scaleX, scaleY);
                        const drawY = -spriteH;
                        
                        if (visual.isDying) {
                            const duration = 750;
                            const progress = (now - visual.deathStart) / duration;
                            if (progress < 1) {
                                sCtx.globalAlpha = alpha * 0.7;
                                const chevronDepth = spriteH * 0.4;
                                const level = (progress * (spriteH + chevronDepth)) - chevronDepth;
                                sCtx.beginPath();
                                sCtx.moveTo(drawX, drawY + spriteH);
                                sCtx.lineTo(drawX + spriteW, drawY + spriteH);
                                sCtx.lineTo(drawX + spriteW, drawY + Math.max(0, level + chevronDepth));
                                sCtx.lineTo(drawX + (spriteW / 2), drawY + Math.max(0, level));
                                sCtx.lineTo(drawX, drawY + Math.max(0, level + chevronDepth));
                                sCtx.closePath();
                                sCtx.clip();
                                sCtx.drawImage(img, drawX, drawY, spriteW, spriteH);
                            }
                        } else {
                            sCtx.drawImage(img, drawX, drawY, spriteW, spriteH);
                        }
                    } else {
                        sCtx.beginPath();
                        sCtx.arc(tx + (ts * 0.5), ty + (ts * 0.5), ts * 0.4, 0, Math.PI * 2);
                        sCtx.fill();
                    }
                    sCtx.restore();
                }
            });
        }

        sCtx.restore();
        sCtx.restore();
    }

    drawAmbientLayer(playerVisual) {
        if (!this.settings.dynamicLights) {
            this.lightCtx.clearRect(0, 0, this.lightCanvas.width, this.lightCanvas.height);
            return;
        }

        const ctx = this.lightCtx;
        const w = this.lightCanvas.width;
        const h = this.lightCanvas.height;
        const ts = this.tileSize;
        
        const camX = Math.floor(this.camera.x);
        const camY = Math.floor(this.camera.y);

        ctx.save();
        ctx.clearRect(0, 0, w, h);

        if (playerVisual) {
            const px = playerVisual.x;
            const py = playerVisual.y;
            const sx = (px * ts) - camX + (ts * 0.5);
            const sy = (py * ts) - camY + (ts * 0.5);
            const screenRadius = this.lightRadius;

            const now = Date.now();
            const flicker = (Math.sin(now * 0.004) + Math.sin(now * 0.013) + Math.sin(now * 0.03)) * 0.01;
            const currentRadius = screenRadius * (1 + flicker);

            ctx.save();
            ctx.translate(this.bufferMargin, this.bufferMargin);

            // 1. Draw Light Gradient (White)
            ctx.globalCompositeOperation = 'source-over';
            const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, currentRadius);
            grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
            grad.addColorStop(this.lightFalloff * 0.25, 'rgba(255, 255, 255, 0.95)');
            grad.addColorStop(this.lightFalloff, 'rgba(255, 255, 255, 0.5)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(sx, sy, currentRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // 2. Subtract Shadows (from shadowCanvas)
            // shadowCanvas contains White Shadows. destination-out removes Light where Shadows are.
            ctx.globalCompositeOperation = 'destination-out';
            ctx.drawImage(this.shadowCanvas, 0, 0);

            // 3. Invert to create Darkness
            // Source-Out: Keeps Source (Dark) where Dest (Light) is Transparent.
            ctx.globalCompositeOperation = 'source-out';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'; // Grimdark ambient
            ctx.fillRect(0, 0, w, h);
        } else {
            // No player? Full darkness.
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(0, 0, w, h);
        }
        ctx.restore();

        // Apply Ambient Layer to Main Canvas
        this.ctx.drawImage(this.lightCanvas, -this.bufferMargin, -this.bufferMargin);
    }

    drawTorchOverlay(playerVisual) {
        if (!this.settings.dynamicLights) return;

        if (!playerVisual) return;
        const ts = this.tileSize;
        const px = playerVisual.x;
        const py = playerVisual.y;
        const sx = (px * ts) - Math.floor(this.camera.x) + (ts * 0.5);
        const sy = (py * ts) - Math.floor(this.camera.y) + (ts * 0.5);
        const screenRadius = this.lightRadius;

        const now = Date.now();
        const flicker = (Math.sin(now * 0.004) + Math.sin(now * 0.013) + Math.sin(now * 0.03)) * 0.01;
        const currentRadius = screenRadius * (1 + flicker) * 1.2;
        
        // Random Interval Hue Shift
        if (now - this.torchState.lastShift > this.torchState.nextShiftDelay) {
            this.torchState.lastShift = now;
            this.torchState.nextShiftDelay = 50 + Math.random() * 15; // Rapid flicker
            this.torchState.targetHue = (Math.random() * 5) - 5; // +/- 15 degrees
        }
        // Faster lerp for flicker effect
        this.torchState.hue += (this.torchState.targetHue - this.torchState.hue) * 0.2;
        const hueShift = this.torchState.hue;

        // Use lightCanvas as a scratch buffer to mask out shadows
        const ctx = this.lightCtx;
        const w = this.lightCanvas.width;
        const h = this.lightCanvas.height;
        const bx = this.bufferMargin;
        const by = this.bufferMargin;

        ctx.save();
        ctx.clearRect(0, 0, w, h);
        ctx.translate(bx, by);

        ctx.globalCompositeOperation = 'source-over';
        const colorGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, currentRadius);
        colorGrad.addColorStop(0.15, `hsla(${25 + hueShift}, 100%, 80%, 0.7)`);
        colorGrad.addColorStop(0.5, `hsla(${25 + hueShift}, 100%, 60%, 0.4)`);
        colorGrad.addColorStop(0.85, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = colorGrad;
        ctx.beginPath();
        ctx.arc(sx, sy, currentRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Mask out Shadows
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(this.shadowCanvas, 0, 0);
        ctx.restore();

        // Draw to Main Canvas
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'overlay';
        this.ctx.drawImage(this.lightCanvas, -bx, -by);
        this.ctx.restore();
    }

    drawShadowVolume(ctx, gx, gy, gw, gh, lx, ly, radius, lOffX = 0.5, lOffY = 0.5) {
        const ts = this.tileSize;
        const camX = Math.floor(this.camera.x);
        const camY = Math.floor(this.camera.y);

        const tx = (gx * ts) - camX;
        const ty = (gy * ts) - camY;
        
        // FIX: Use full tile size for shadows as requested.
        const tw = gw * ts;
        const th = gh * ts;

        let lsx = (lx * ts) - camX + (ts * lOffX);
        let lsy = (ly * ts) - camY + (ts * lOffY);

        // FIX: Handle Light Source inside Caster (GridSystem overlap).
        // If light is inside, snap it to the nearest edge to preserve occlusion
        // without causing shadow explosion.
        if (lsx > tx && lsx < tx + tw && lsy > ty && lsy < ty + th) {
            const dL = lsx - tx;
            const dR = (tx + tw) - lsx;
            const dT = lsy - ty;
            const dB = (ty + th) - lsy;
            
            const min = Math.min(dL, dR, dT, dB);
            const snap = 2; 
            
            if (min === dL) lsx = tx - snap;
            else if (min === dR) lsx = tx + tw + snap;
            else if (min === dT) lsy = ty - snap;
            else if (min === dB) lsy = ty + th + snap;
        }

        // Small epsilon to prevent float precision z-fighting on edges
        const pad = 0;

        // Reuse static corners array
        this.shadowCorners[0].x = tx + pad; this.shadowCorners[0].y = ty + pad;
        this.shadowCorners[1].x = tx + tw - pad; this.shadowCorners[1].y = ty + pad;
        this.shadowCorners[2].x = tx + tw - pad; this.shadowCorners[2].y = ty + th - pad;
        this.shadowCorners[3].x = tx + pad; this.shadowCorners[3].y = ty + th - pad;

        // Optimization: Reuse array to prevent GC thrashing
        // Recycle old points back to pool
        while(this.shadowPoints.length > 0) {
            const p = this.shadowPoints.pop();
            // Fix: Do not recycle static corner objects into the dynamic point pool
            if (!this.shadowCorners.includes(p)) {
                this.shadowPointPool.push(p);
            }
        }
        this.shadowPoints.length = 0;
        const points = this.shadowPoints;

        // Use a large distance to ensure shadows extend off-screen
        const projectDist = Math.max(this.canvas.width, this.canvas.height) * 2;

        for (const c of this.shadowCorners) {
            points.push(c);
            const dx = c.x - lsx;
            const dy = c.y - lsy;
            if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
                const len = Math.sqrt(dx*dx + dy*dy);
                const p = this.getShadowPoint();
                p.x = c.x + (dx / len) * projectDist;
                p.y = c.y + (dy / len) * projectDist;
                points.push(p);
            }
        }

        const hull = this.computeConvexHull(points);

        ctx.beginPath();
        if (hull.length > 0) {
            ctx.moveTo(hull[0].x, hull[0].y);
            for (let i = 1; i < hull.length; i++) {
                ctx.lineTo(hull[i].x, hull[i].y);
            }
        }
        ctx.closePath();
        ctx.fill();
    }

    computeConvexHull(points) {
        // Monotone Chain Algorithm
        if (points.length <= 2) return points;
        
        points.sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
        const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

        // Reuse buffers
        const lower = this.hullLower;
        const upper = this.hullUpper;
        lower.length = 0;
        upper.length = 0;

        for (let p of points) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
            lower.push(p);
        }
        for (let i = points.length - 1; i >= 0; i--) {
            const p = points[i];
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
            upper.push(p);
        }
        upper.pop(); lower.pop();
        
        // Optimization: Reuse hullBuffer instead of concat (which allocates new arrays)
        this.hullBuffer.length = 0;
        for (let i = 0; i < lower.length; i++) this.hullBuffer.push(lower[i]);
        for (let i = 0; i < upper.length; i++) this.hullBuffer.push(upper[i]);
        
        return this.hullBuffer;
    }

    render(grid, entities, loot, projectiles, interaction, localPlayerId, isHost, gridRevision) {
        if (!entities) return;

        // Check if we need to update static cache
        if (grid && (this.lastGridRevision === -1 || (gridRevision !== undefined && gridRevision !== this.lastGridRevision))) {
            this.updateStaticCache(grid);
            this.lastGridRevision = gridRevision !== undefined ? gridRevision : 0;
        }

        const myPos = entities.get(localPlayerId);
        
        // Camera: Match player's interpolated visual movement
        if (myPos) {
            // We update the visual state for the local player immediately here
            // so the camera can lock onto the smooth interpolated position before drawing.
            const now = Date.now();
            let visual = this.visualEntities.get(localPlayerId);
            if (!visual) {
                visual = { 
                    x: myPos.x, y: myPos.y, 
                    targetX: myPos.x, targetY: myPos.y,
                    startX: myPos.x, startY: myPos.y,
                    moveStartTime: 0,
                    attackStart: 0, flashStart: 0,
                    bumpStart: 0, bumpDir: null,
                    lastFacingX: -1,
                    opacity: 1,
                    idlePhase: Math.random() * Math.PI * 2,
                    recoilX: 0, recoilY: 0, recoilStart: 0,
                    isDying: false, deathStart: 0,
                    flashColor: '#ffffff'
                };
                this.visualEntities.set(localPlayerId, visual);
            }

            if (myPos.x !== visual.targetX || myPos.y !== visual.targetY) {
                visual.startX = visual.x;
                visual.startY = visual.y;
                visual.targetX = myPos.x;
                visual.targetY = myPos.y;
                visual.moveStartTime = now;
            }

            const moveDuration = 250;
            const t = Math.min(1, (now - visual.moveStartTime) / moveDuration);
            visual.x = visual.startX + (visual.targetX - visual.startX) * t;
            visual.y = visual.startY + (visual.targetY - visual.startY) * t;

            this.updateCamera(visual.x, visual.y);
        } else if (grid && grid.length > 0 && !this.camera.isReady) {
            // Fallback: Center camera on map if player entity is missing/not yet spawned
            this.updateCamera(grid[0].length / 2, grid.length / 2);
        }

        this.clear();

        this.ctx.save();
        this.ctx.scale(this.scale, this.scale);

        // Apply Screen Shake
        this.ctx.save(); // Save for shake
        if (Date.now() - this.shake.startTime < this.shake.duration) {
            const dx = (Math.random() - 0.5) * this.shake.intensity;
            const dy = (Math.random() - 0.5) * this.shake.intensity;
            this.ctx.translate(dx, dy);
        }

        const hasGrid = grid && grid.length && grid[0];

        if (hasGrid) {
            this.drawFloor(grid, grid[0].length, grid.length);
            this.drawWalls(grid, grid[0].length, grid.length);
            this.drawLoot(loot);
        } else {
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = '24px "Germania One"';
            this.ctx.textAlign = 'center';
            this.ctx.fillText("Downloading Map...", 0, 0);
        }

        this.updateAndDrawParticles();
        
        // 2. Draw Entities & Projectiles (Before Roofs/Ambient)
        this.drawProjectiles(projectiles);
        this.drawEntities(entities, localPlayerId, 'ALL', this.ctx, isHost);
        this.drawEffects();

        // 3. Update Shadow Buffer (Offscreen) - Moved after entities to use updated positions
        if (hasGrid) {
            this.drawShadowLayer(grid, this.visualEntities.get(localPlayerId), entities);
        
            // 4. Draw Roofs (Occludes entities)
            this.drawRoof(grid, grid[0].length, grid.length);
        }

        this.drawHPBars();

        // 5. Draw Torch Overlay (Color Tinting - BEFORE Shadow)
        this.drawTorchOverlay(this.visualEntities.get(localPlayerId));

        // 6. Draw Ambient Darkness (Shadow Mask - OVER Everything)
        this.drawAmbientLayer(this.visualEntities.get(localPlayerId));

        this.ctx.restore(); // Restore shake

        // Draw UI-like world elements (Floating Text, Interaction) on top, unaffected by shake
        this.drawFloatingTexts();
        this.drawInteractionBar(interaction, myPos);

        this.ctx.restore(); // Restore scale

        // 7. Draw Vignette / Letterbox (Screen Space)
        // Locks the viewable area to a maximum aspect ratio (16:9)
        const aspect = this.canvas.width / this.canvas.height;
        if (aspect > this.maxAspectRatio) {
            const safeWidth = this.canvas.height * this.maxAspectRatio;
            const margin = ((this.canvas.width - safeWidth) / 2) - 100;
            const fadeSize = 100; // Width of the gradient fade

            this.ctx.save();
            
            // Left Fade
            if (margin > 0) {
                const gradL = this.ctx.createLinearGradient(margin - fadeSize, 0, margin, 0);
                gradL.addColorStop(0, '#000');
                gradL.addColorStop(1, 'rgba(0,0,0,0)');
                
                this.ctx.fillStyle = '#000';
                this.ctx.fillRect(0, 0, margin - fadeSize, this.canvas.height);
                this.ctx.fillStyle = gradL;
                this.ctx.fillRect(margin - fadeSize, 0, fadeSize, this.canvas.height);
            }

            // Right Fade
            const rightEdge = this.canvas.width - margin;
            const gradR = this.ctx.createLinearGradient(rightEdge, 0, rightEdge + fadeSize, 0);
            gradR.addColorStop(0, 'rgba(0,0,0,0)');
            gradR.addColorStop(1, '#000');
            this.ctx.fillStyle = gradR;
            this.ctx.fillRect(rightEdge, 0, fadeSize, this.canvas.height);
            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(rightEdge + fadeSize, 0, margin - fadeSize, this.canvas.height);

            this.ctx.restore();
        }
    }
}