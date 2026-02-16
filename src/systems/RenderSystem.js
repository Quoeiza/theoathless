import { TileMapManager, dungeonTilesetConfig } from './TileMapManager.js';

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
        this.scale = 2;
        this.lightRadius = 300;

        // Lighting Layer
        this.lightCanvas = document.createElement('canvas');
        this.lightCtx = this.lightCanvas.getContext('2d');
        // Dimensions set in resize()

        // Shadow Layer (Offscreen)
        this.shadowCanvas = document.createElement('canvas');
        this.shadowCtx = this.shadowCanvas.getContext('2d');
        // Dimensions set in resize()

        this.resize(); // Initialize sizes

        // TileMap Manager for sprite-based rendering
        this.tileMapManager = new TileMapManager(dungeonTilesetConfig);

        // Camera
        this.camera = { x: 0, y: 0, isReady: false };
        
        // Visual Effects
        this.effects = []; // { x, y, type, startTime, duration }
        this.floatingTexts = []; // { x, y, text, color, startTime, duration }
        this.visualEntities = new Map(); // id -> { x, y, targetX, targetY, startX, startY, moveStartTime, attackStart, flashStart, bumpStart, bumpDir }
        this.shake = { intensity: 0, duration: 0, startTime: 0 };
        this.assetLoader = null;

        // Performance Caching
        this.staticCacheBottom = document.createElement('canvas');
        this.staticCtxBottom = this.staticCacheBottom.getContext('2d');
        this.staticCacheTop = document.createElement('canvas');
        this.staticCtxTop = this.staticCacheTop.getContext('2d');
        this.lastGridRevision = -1;
        this.shadowCasters = []; // Reuse array to reduce GC
        this.shadowMaskers = []; // Reuse array to reduce GC
        this.shadowPoints = []; // Reuse array for hull calculation
        this.hullBuffer = [];   // Reuse array for hull results

        this.bloodParticles = [];
        this.particlePool = [];
    }

    setAssetLoader(loader) {
        this.assetLoader = loader;

        // Load Actor Sprites
        const p1 = loader.loadImages({
            'knight': './assets/images/actors/rogue.png',
            'skelly': './assets/images/actors/skelly.png'
        }).catch(err => console.error("Failed to load actor assets:", err));

        // After setting the loader, immediately start loading the tilemap assets
        const p2 = this.tileMapManager.loadAssets(loader).catch(err => {
            console.error("Failed to load tilemap assets:", err);
        });

        return Promise.all([p1, p2]);
    }

    setGridSystem(gridSystem) {
        this.gridSystem = gridSystem;
    }

    setCombatSystem(combatSystem) {
        this.combatSystem = combatSystem;
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        
        // Size lighting buffers to Game Resolution
        const gameW = this.canvas.width / this.scale;
        const gameH = this.canvas.height / this.scale;
        this.lightCanvas.width = gameW;
        this.lightCanvas.height = gameH;
        this.shadowCanvas.width = gameW;
        this.shadowCanvas.height = gameH;
        this.ctx.imageSmoothingEnabled = false;
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
            this.staticCacheTop.width = w * ts;
            this.staticCacheTop.height = h * ts;
        }

        const ctxB = this.staticCtxBottom;
        const ctxT = this.staticCtxTop;

        // Clear
        ctxB.clearRect(0, 0, w * ts, h * ts);
        ctxT.clearRect(0, 0, w * ts, h * ts);

        // Render entire map to cache
        const viewBounds = { startCol: 0, endCol: w - 1, startRow: 0, endRow: h - 1 };

        // 1. Bottom Layer: Floors and Walls
        this.tileMapManager.drawFloor(ctxB, grid, viewBounds);
        
        // Bake static procedural floors (Mud) into the cache
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const tile = grid[y][x];
                if (tile === 3) { // Mud
                    const screenX = x * ts;
                    const screenY = y * ts;
                    const n = noise(x, y);
                    ctxB.fillStyle = '#3e2723';
                    ctxB.fillRect(screenX, screenY, ts, ts);
                    if (n > 0.5) {
                        ctxB.fillStyle = '#281a15';
                        ctxB.fillRect(screenX + (ts * 0.15), screenY + (ts * 0.15), ts * 0.15, ts * 0.15);
                    }
                }
            }
        }

        this.tileMapManager.drawWalls(ctxB, grid, viewBounds);

        // 2. Top Layer: Roofs
        this.tileMapManager.drawRoof(ctxT, grid, viewBounds);

        this.lastGridRevision = this.gridSystem ? this.gridSystem.revision : -1;
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

        // --- Pass 1: Draw Cached Static Layer ---
        this.ctx.save();
        this.ctx.translate(-camX, -camY);
        this.ctx.drawImage(this.staticCacheBottom, 0, 0);
        this.ctx.restore(); // Restore translation, but we need it for the loop below? No, loop calculates screenX manually.

        // --- Pass 2: Draw procedural floor tiles ---
        for (let y = startRow; y <= endRow; y++) {
            for (let x = startCol; x <= endCol; x++) {
                if (y < 0 || y >= height || x < 0 || x >= width) continue;

                const tile = grid[y][x];
                // Only draw DYNAMIC tiles here. Static ones (Mud) are cached.
                // 2=Water, 4=Lava, 9=Extraction
                if (tile === 2 || tile === 4 || tile === 9) {
                    const screenX = (x * ts) - camX;
                    const screenY = (y * ts) - camY;
                    const n = noise(x, y);

                    // Re-add procedural rendering for special tiles
                    if (tile === 2) { // Water
                        const offset = Math.sin(Date.now() / 500 + x) * (ts * 0.15);
                        this.ctx.fillStyle = `rgb(20, 40, ${100 + offset})`;
                        this.ctx.fillRect(screenX, screenY, ts, ts);
                        this.ctx.fillStyle = 'rgba(255,255,255,0.1)';
                        this.ctx.fillRect(screenX + (ts * 0.15), screenY + (ts * 0.15) + offset, ts * 0.3, ts * 0.06);
                    } else if (tile === 4) { // Lava
                        const pulse = Math.sin(Date.now() / 300);
                        this.ctx.fillStyle = `rgb(${200 + pulse * 50}, 50, 0)`;
                        this.ctx.fillRect(screenX, screenY, ts, ts);
                        this.ctx.fillStyle = '#ffeb3b';
                        if (n > 0.7) this.ctx.fillRect(screenX + n*(ts * 0.625), screenY + n*(ts * 0.625), ts * 0.125, ts * 0.125);
                    } else if (tile === 9) { // Extraction Zone
                        const pulse = (Math.sin(Date.now() / 200) + 1) / 2;
                        this.ctx.fillStyle = `rgba(0, 255, 255, ${0.1 + pulse * 0.2})`;
                        this.ctx.fillRect(screenX, screenY, ts, ts);
                        this.ctx.strokeStyle = `rgba(0, 255, 255, ${0.5 + pulse * 0.5})`;
                        this.ctx.lineWidth = 2;
                        this.ctx.strokeRect(screenX + (ts * 0.125), screenY + (ts * 0.125), ts - (ts * 0.25), ts - (ts * 0.25));
                    }
                }
            }
        }
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
            this.spawnBloodParticle(visual.x, visual.y, ndx, ndy);
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

    spawnBloodParticle(x, y, dirX, dirY) {
        const p = this.particlePool.pop() || { x:0, y:0, vx:0, vy:0, life:0, maxLife:0 };
        p.x = x + (Math.random() - 0.5) * 0.2;
        p.y = y + (Math.random() - 0.5) * 0.2;
        
        const speed = 0.05 + Math.random() * 0.15;
        const spread = 0.8; // High spread
        
        // Mix directional velocity with random spread
        p.vx = dirX * speed + (Math.random() - 0.5) * spread * speed;
        p.vy = dirY * speed + (Math.random() - 0.5) * spread * speed;
        
        p.life = 1.0;
        p.maxLife = 1.0;
        p.size = 0.02 + Math.random() * 0.03;
        this.bloodParticles.push(p);
    }

    drawEntities(entities, localPlayerId, drawMode = 'ALL', ctx = this.ctx) {
        const now = Date.now();
        const localPlayer = entities.get(localPlayerId);
        
        // Calculate View Bounds for Culling
        const camX = this.camera.x;
        const camY = this.camera.y;
        const viewW = this.canvas.width / this.scale;
        const viewH = this.canvas.height / this.scale;
        const margin = this.tileSize * 2; // Allow some overhang for sprites/shadows

        // Prune visuals that no longer exist
        for (const id of this.visualEntities.keys()) {
            if (!entities.has(id)) {
                const visual = this.visualEntities.get(id);
                // Keep dying entities until animation finishes (1s)
                if (!visual.isDying || (now - visual.deathStart > 1000)) {
                    this.visualEntities.delete(id);
                }
            }
        }

        // 2. Update Visual State & Prepare Render List
        const renderList = [];

        entities.forEach((pos, id) => {
            if (drawMode === 'REMOTE' && id === localPlayerId) return;
            if (drawMode === 'LOCAL' && id !== localPlayerId) return;

            let visual = this.visualEntities.get(id);
            if (!visual) {
                visual = { 
                    x: pos.x, y: pos.y, 
                    targetX: pos.x, targetY: pos.y,
                    startX: pos.x, startY: pos.y,
                    moveStartTime: 0,
                    attackStart: 0, flashStart: 0,
                    bumpStart: 0, bumpDir: null,
                    lastFacingX: -1, // Default Left
                    opacity: 0, // Start invisible and fade in
                    idlePhase: Math.random() * Math.PI * 2,
                    recoilX: 0, recoilY: 0, recoilStart: 0,
                    isDying: false, deathStart: 0,
                    flashColor: '#ffffff'
                };
                this.visualEntities.set(id, visual);
            }

            // Detect Position Change
            if (pos.x !== visual.targetX || pos.y !== visual.targetY) {
                visual.startX = visual.x;
                visual.startY = visual.y; 
                visual.targetX = pos.x;
                visual.targetY = pos.y;
                visual.moveStartTime = now;
            }

            // Linear Interpolation over 250ms
            // Stop updating position if dying to prevent snapping
            if (!visual.isDying) {
                const moveDuration = 250;
                const t = Math.min(1, (now - visual.moveStartTime) / moveDuration);
                visual.x = visual.startX + (visual.targetX - visual.startX) * t;
                visual.y = visual.startY + (visual.targetY - visual.startY) * t;
            }

            // Optimization: View Frustum Culling
            // If entity is completely off-screen, skip LOS check and rendering
            const screenX = (visual.x * this.tileSize) - camX;
            const screenY = (visual.y * this.tileSize) - camY;
            
            if (screenX < -margin || screenX > viewW + margin || screenY < -margin || screenY > viewH + margin) {
                return; // Skip this entity
            }

            // Line of Sight Check
            let hasLOS = true;
            if (localPlayer && id !== localPlayerId && this.gridSystem) {
                hasLOS = this.gridSystem.hasLineOfSight(localPlayer.x, localPlayer.y, pos.x, pos.y);
            }

            // Fading Logic
            const targetOpacity = hasLOS ? 1.0 : 0.0;
            visual.opacity += (targetOpacity - visual.opacity) * 0.1;
            if (Math.abs(targetOpacity - visual.opacity) < 0.01) visual.opacity = targetOpacity;

            if (visual.opacity > 0.01) {
                renderList.push({ id, pos, visual });
            }
        });

        // 3. Depth Sort (Y-sort)
        renderList.sort((a, b) => {
            if (a.visual.y !== b.visual.y) return a.visual.y - b.visual.y;
            return a.id.localeCompare(b.id); // Stable sort fallback
        });

        // 4. Render
        for (const { id, pos, visual } of renderList) {
            // Hop Animation (Based on fractional grid position)
            // We use the fractional part of the visual position to determine the hop arc
            const hopOffset = -Math.sin(Math.PI * Math.max(Math.abs(visual.x % 1), Math.abs(visual.y % 1))) * (this.tileSize * 0.125);
            
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

            const screenX = Math.floor((visual.x * this.tileSize) - Math.floor(this.camera.x) + offsetX + bumpX + recoilOffX);
            const screenY = Math.floor((visual.y * this.tileSize) - Math.floor(this.camera.y) + offsetY + hopOffset + bumpY + recoilOffY);

            // Health Bar (Curved under sprite)
            if (pos.hp !== undefined && pos.maxHp !== undefined && pos.hp > 0) {
                const hpRatio = pos.maxHp > 0 ? Math.max(0, pos.hp / pos.maxHp) : 0;
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

            // Shadow
            ctx.fillStyle = 'rgba(20, 19, 31, 0.6)';
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
            if (type === 'player') spriteKey = 'knight';
            if (type === 'skeleton') spriteKey = 'skelly';
            
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
                    const progress = (now - visual.deathStart) / 1000;
                    if (progress < 1) {
                        const cropH = spriteH * progress;
                        // Draw only the bottom part
                        ctx.drawImage(img, 
                            0, cropH, spriteW, spriteH - cropH, 
                            drawX, drawY + cropH, spriteW, spriteH - cropH
                        );
                    }
                } else {
                    // Normal Draw
                    ctx.drawImage(img, drawX, drawY, spriteW, spriteH);
                }

                if (isFlashing) {
                    ctx.filter = 'none';
                }

                ctx.restore();
            } else {
                // --- Fallback Procedural Rendering ---

                // Body
                const isMe = (id === localPlayerId);
                const isFlashing = (now - visual.flashStart < 100);

                // Note: Fallback shapes don't support the new dissolve/idle effects fully for brevity
                if (isFlashing) {
                    ctx.fillStyle = '#FFFFFF';
                } else {
                    let baseColor = isMe ? '#4a6' : '#a44';
                    
                    // Monster override for self
                    if (isMe && pos.team === 'monster') {
                        baseColor = '#ff3333'; // Brighter red for self-monster
                    }

                    // Monster Type Overrides
                    if (pos.team === 'monster') {
                        if (pos.type === 'slime') baseColor = '#88cc44';
                        if (pos.type === 'skeleton') baseColor = '#dddddd';
                    }
                    
                    // Gradient Body
                    const grad = ctx.createRadialGradient(screenX + (this.tileSize * 0.5), screenY + (this.tileSize * 0.5), this.tileSize * 0.06, screenX + (this.tileSize * 0.5), screenY + (this.tileSize * 0.5), this.tileSize * 0.375);
                    grad.addColorStop(0, isMe && pos.team !== 'monster' ? '#6c8' : '#c66');
                    grad.addColorStop(1, baseColor);
                    
                    // Simple shape differentiation
                    if (pos.type === 'slime') {
                        // Slimes are slightly translucent
                        ctx.globalAlpha = 0.9;
                    }
                    ctx.fillStyle = grad;
                }

                ctx.beginPath();
                ctx.arc(screenX + (this.tileSize * 0.5), screenY + (this.tileSize * 0.5), this.tileSize * 0.3125, 0, Math.PI * 2);
                ctx.fill();

                // Draw facing indicator
                if (pos.facing) {
                    const indicatorX = screenX + (this.tileSize * 0.5) + (pos.facing.x * (this.tileSize * 0.375));
                    const indicatorY = screenY + (this.tileSize * 0.5) + (pos.facing.y * (this.tileSize * 0.375));
                    ctx.fillStyle = 'rgba(255,255,255,0.8)';
                    ctx.fillRect(indicatorX - (this.tileSize * 0.06), indicatorY - (this.tileSize * 0.06), this.tileSize * 0.125, this.tileSize * 0.125);
                }
            }
            
            ctx.globalAlpha = 1.0; // Reset
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
            const screenX = Math.floor((loot.x * this.tileSize) - Math.floor(this.camera.x));
            const screenY = Math.floor((loot.y * this.tileSize) - Math.floor(this.camera.y));
            
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
                this.bloodParticles.splice(i, 1);
                continue;
            }

            const sx = (p.x * ts) - this.camera.x;
            const sy = (p.y * ts) - this.camera.y;
            this.ctx.fillStyle = '#800';
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
            const screenX = Math.floor((e.x * this.tileSize) - Math.floor(this.camera.x));
            const screenY = Math.floor((e.y * this.tileSize) - Math.floor(this.camera.y));

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
            duration: 1000
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
            const screenX = (t.x * this.tileSize) - Math.floor(this.camera.x) + (this.tileSize / 2);
            const screenY = (t.y * this.tileSize) - Math.floor(this.camera.y) - (progress * (this.tileSize * 1.25)); // Float up faster

            // Pop effect
            let scale = 1.0;
            if (progress < 0.2) scale = 1 + (progress * 2);
            else scale = 1.4 - ((progress - 0.2) * 0.5);

            this.ctx.fillStyle = t.color;
            this.ctx.font = `bold ${Math.max(12, Math.floor(16 * scale))}px "Courier New"`;
            this.ctx.globalAlpha = 1 - Math.pow(progress, 3); // Fade out
            this.ctx.fillText(t.text, screenX, screenY);
            this.ctx.globalAlpha = 1.0;
        });
        this.ctx.shadowBlur = 0;
    }

    drawProjectiles(projectiles) {
        projectiles.forEach(p => {
            const screenX = Math.floor((p.x * this.tileSize) - Math.floor(this.camera.x));
            const screenY = Math.floor((p.y * this.tileSize) - Math.floor(this.camera.y));
            
            // Draw Arrow
            this.ctx.save();
            this.ctx.translate(screenX + this.tileSize/2, screenY + this.tileSize/2);
            this.ctx.rotate(Math.atan2(p.vy, p.vx));
            
            this.ctx.fillStyle = '#fff';
            this.ctx.fillRect(-(this.tileSize * 0.25), -(this.tileSize * 0.03), this.tileSize * 0.5, this.tileSize * 0.06); // Shaft
            this.ctx.fillStyle = '#888';
            this.ctx.fillRect((this.tileSize * 0.1875), -(this.tileSize * 0.06), this.tileSize * 0.06, this.tileSize * 0.125); // Tip
            this.ctx.fillStyle = '#d44';
            this.ctx.fillRect(-(this.tileSize * 0.25), -(this.tileSize * 0.06), this.tileSize * 0.125, this.tileSize * 0.125); // Fletching
            
            this.ctx.restore();
        });
    }

    drawInteractionBar(interaction, playerPos) {
        if (!interaction || !playerPos) return;
        
        const screenX = Math.floor((playerPos.x * this.tileSize) - Math.floor(this.camera.x));
        const screenY = Math.floor((playerPos.y * this.tileSize) - Math.floor(this.camera.y));
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
        return t === 0 || t === 2 || t === 3 || t === 4 || t === 9;
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

    drawShadowLayer(grid, playerVisual, entities) {
        if (!playerVisual) return;

        const sCtx = this.shadowCtx;
        const w = this.shadowCanvas.width;
        const h = this.shadowCanvas.height;
        const ts = this.tileSize;

        // Torch Configuration
        const screenRadius = this.lightRadius;
        const radius = screenRadius / ts; // Tiles
        const px = playerVisual.x;
        const py = playerVisual.y;
        
        // Calculate Screen Coordinates
        // Offset light to player's center (0.5) to align with sprite.
        // Lower values (e.g. 0.8) cause light to peek over walls too early (flooding).
        const lOffX = 0.5;
        const lOffY = 0.5;

        // Use float coordinates for smooth lighting, matching shadow volume calculations
        const sx = (px * ts) - this.camera.x + (ts * lOffX);
        const sy = (py * ts) - this.camera.y + (ts * lOffY);
        
        // Prepare Shadow Canvas
        sCtx.save();
        sCtx.clearRect(0, 0, w, h);
        
        // --- IMPROVED SHADOW LOGIC ---
        // We separate walls into two lists:
        // 1. Casters: Visible walls that generate shadow volumes.
        // 2. Maskers: ALL walls in the vicinity. These must be erased from the shadow 
        //    layer so shadows don't "draw over" the top of walls.
        
        // Reuse arrays to prevent GC
        this.shadowCasters.length = 0;
        this.shadowMaskers.length = 0;

        const iPx = Math.floor(px);
        const iPy = Math.floor(py);
        
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

        for (let y = startY; y <= endY; y++) {
            let casterSeg = null;
            let maskerSeg = null;

            for (let x = startX; x <= endX; x++) {
                // --- LINKED SYSTEM: TileMapManager Classification ---
                const isWall = this.tileMapManager.getTileVal(grid, x, y) === 1;
                const isFrontFace = this.tileMapManager.isFrontFace(grid, x, y);
                const isVoid = this.tileMapManager.shouldDrawVoid(grid, x, y);

                // 1. Maskers: Walls, Faces, and Voids/Roofs.
                // These are "above" the floor and should not receive floor shadows.
                if (isWall || isVoid) {
                    if (maskerSeg) {
                        maskerSeg.w++;
                    } else {
                        maskerSeg = { x, y, w: 1 }; // Optimization: Could pool these objects too, but simple object creation is fast in V8
                    }
                } else {
                    if (maskerSeg) {
                        this.shadowMaskers.push(maskerSeg);
                        maskerSeg = null;
                    }
                }

                // 2. Casters: Only Colliding Walls cast shadows.
                // We use GridSystem to determine collision, ensuring visual consistency with physics.
                // This excludes "Roof Rims" (which are walls but walkable) from casting shadows.
                const isColliding = this.gridSystem ? !this.gridSystem.isWalkable(x, y) : isWall;

                if (isColliding) {
                    if (casterSeg) {
                        casterSeg.w++;
                    } else {
                        casterSeg = { x, y, w: 1 };
                    }
                } else {
                    if (casterSeg) {
                        this.shadowCasters.push(casterSeg);
                        casterSeg = null;
                    }
                }
            }
            // Flush segments at end of row
            if (maskerSeg) this.shadowMaskers.push(maskerSeg);
            if (casterSeg) this.shadowCasters.push(casterSeg);
        }

        sCtx.save();
        
        // A. Draw Shadow Volumes
        // Optimization: Draw opaque first to merge overlaps (prevents banding).
        // Apply blur HERE so that the shadow volume is soft, but we can mask it sharply later.
        sCtx.globalCompositeOperation = 'source-over';
        sCtx.fillStyle = '#FFFFFF'; // White for Masking
        sCtx.filter = 'blur(4px)'; 

        for (const wall of this.shadowCasters) {
            // Draw the wall base to ensure shadow continuity under the wall before masking.
            // This prevents the "lighter edge" artifact where the blurred shadow volume meets the wall.
            const wx = (wall.x * ts) - this.camera.x;
            const wy = (wall.y * ts) - this.camera.y;
            sCtx.fillRect(wx, wy, wall.w * ts, ts);

            this.drawShadowVolume(sCtx, wall.x, wall.y, wall.w, 1, px, py, radius, lOffX, lOffY);
        }
        sCtx.filter = 'none'; // Reset filter for sharp masking

        // B. Mask out ALL Walls (Prevents "Green Circle" issue)
        sCtx.globalCompositeOperation = 'destination-out';
        sCtx.fillStyle = '#FFFFFF'; // Alpha 1.0 to fully erase

        for (const wall of this.shadowMaskers) {
            const tx = Math.floor((wall.x * ts) - this.camera.x);
            const ty = Math.floor((wall.y * ts) - this.camera.y);
            sCtx.fillRect(tx, ty, wall.w * ts, ts);
        }

        // C. Mask out Entities (Prevent shadows on sprites)
        if (entities) {
            this.visualEntities.forEach((visual, id) => {
                if (entities.has(id)) {
                    const pos = entities.get(id);

                    // Calculate Mask Opacity based on Visibility & Stealth
                    let alpha = visual.opacity;
                    if (pos.invisible) {
                        // If invisible and NOT the local player (compared by reference to playerVisual)
                        if (visual !== playerVisual) {
                            alpha = 0;
                        } else {
                            alpha *= 0.5;
                        }
                    }

                    // Skip if effectively invisible to prevent "ghost" outlines in darkness
                    if (alpha < 0.05) return;

                    // Calculate Offsets (Match drawEntities for alignment)
                    const now = Date.now();
                    let offsetX = 0;
                    let offsetY = 0;
                    if (now - visual.attackStart < 150) {
                        const progress = (now - visual.attackStart) / 150;
                        const shove = Math.sin(progress * Math.PI) * (ts * 0.25);
                        if (pos.facing) {
                            offsetX = pos.facing.x * shove;
                            offsetY = pos.facing.y * shove;
                        }
                    }

                    let bumpX = 0;
                    let bumpY = 0;
                    if (now - visual.bumpStart < 150) {
                        const progress = (now - visual.bumpStart) / 150;
                        const bumpDist = Math.sin(progress * Math.PI) * (ts * 0.15);
                        if (visual.bumpDir) {
                            bumpX = visual.bumpDir.x * bumpDist;
                            bumpY = visual.bumpDir.y * bumpDist;
                        }
                    }

                    // Recoil Offset
                    let recoilOffX = 0;
                    let recoilOffY = 0;
                    if (now - visual.recoilStart < 200) {
                        const t = 1 - ((now - visual.recoilStart) / 200);
                        recoilOffX = visual.recoilX * t * ts;
                        recoilOffY = visual.recoilY * t * ts;
                    }

                    const tx = Math.floor((visual.x * ts) - Math.floor(this.camera.x) + offsetX + bumpX + recoilOffX);
                    const ty = Math.floor((visual.y * ts) - Math.floor(this.camera.y) + offsetY + bumpY + recoilOffY);
                    
                    // Determine Sprite
                    let type = pos.type;
                    if (!type && this.combatSystem) {
                        const stats = this.combatSystem.getStats(id);
                        if (stats) type = stats.type;
                    }

                    let spriteKey = null;
                    if (type === 'player') spriteKey = 'knight';
                    if (type === 'skeleton') spriteKey = 'skelly';
                    
                    const img = this.assetLoader ? this.assetLoader.getImage(spriteKey) : null;

                    sCtx.save();
                    sCtx.globalAlpha = alpha; // Apply opacity to the mask

                    if (img) {
                        const hopOffset = -Math.sin(Math.PI * Math.max(Math.abs(visual.x % 1), Math.abs(visual.y % 1))) * (ts * 0.125);
                        
                        // Idle Animation (Breathing & Swaying)
                        let scaleY = 1;
                        let scaleX = 1;
                        let rotation = 0;
                        if (!visual.isDying) {
                            const breath = Math.sin(now * 0.003 + visual.idlePhase);
                            scaleY = 1 + (breath * 0.012);
                            scaleX = 1 + (breath * 0.006);
                        }

                        const centerX = tx + (ts * 0.5);
                        const centerY = ty + (ts * 0.5) + hopOffset;

                        sCtx.translate(centerX, centerY + (ts / 2)); // Pivot at feet

                        const facingX = visual.lastFacingX !== undefined ? visual.lastFacingX : (pos.facing ? pos.facing.x : -1);
                        const spriteW = img.width;
                        const spriteH = img.height;
                        let drawX = Math.floor(-spriteW / 2);

                        if (facingX > 0) {
                            sCtx.scale(-1, 1);
                            drawX -= 1; // Fix 1px offset when flipped
                        }

                        sCtx.rotate(rotation);
                        sCtx.scale(scaleX, scaleY);

                        const drawY = -spriteH; // Draw upwards from feet
                        
                        sCtx.drawImage(img, drawX, Math.floor(drawY), spriteW, spriteH);
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
        const ctx = this.lightCtx;
        const w = this.lightCanvas.width;
        const h = this.lightCanvas.height;
        const ts = this.tileSize;

        ctx.save();
        ctx.clearRect(0, 0, w, h);

        if (playerVisual) {
            const px = playerVisual.x;
            const py = playerVisual.y;
            const sx = (px * ts) - this.camera.x + (ts * 0.5);
            const sy = (py * ts) - this.camera.y + (ts * 0.5);
            const screenRadius = this.lightRadius;

            // 1. Draw Light Gradient (White)
            ctx.globalCompositeOperation = 'source-over';
            const grad = ctx.createRadialGradient(sx, sy, ts * 1.5, sx, sy, screenRadius);
            grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
            grad.addColorStop(0.7, 'rgba(255, 255, 255, 0.3)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(sx, sy, screenRadius, 0, Math.PI * 2);
            ctx.fill();

            // 2. Subtract Shadows (from shadowCanvas)
            // shadowCanvas contains White Shadows. destination-out removes Light where Shadows are.
            ctx.globalCompositeOperation = 'destination-out';
            ctx.drawImage(this.shadowCanvas, 0, 0);

            // 3. Invert to create Darkness
            // Source-Out: Keeps Source (Dark) where Dest (Light) is Transparent.
            ctx.globalCompositeOperation = 'source-out';
            ctx.fillStyle = 'rgba(20, 19, 31, 0.9)'; // Grimdark ambient
            ctx.fillRect(0, 0, w, h);
        } else {
            // No player? Full darkness.
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = 'rgba(20, 19, 31, 0.9)';
            ctx.fillRect(0, 0, w, h);
        }
        ctx.restore();

        // Apply Ambient Layer to Main Canvas
        this.ctx.drawImage(this.lightCanvas, 0, 0);
    }

    drawTorchOverlay(playerVisual) {
        if (!playerVisual) return;
        const ts = this.tileSize;
        const px = playerVisual.x;
        const py = playerVisual.y;
        const sx = (px * ts) - this.camera.x + (ts * 0.5);
        const sy = (py * ts) - this.camera.y + (ts * 0.5);
        const screenRadius = this.lightRadius;

        this.ctx.save();
        this.ctx.globalCompositeOperation = 'overlay';
        const colorGrad = this.ctx.createRadialGradient(sx, sy, 0, sx, sy, screenRadius * 0.8);
        colorGrad.addColorStop(0, 'rgba(255, 160, 60, 0.5)'); // Warm Orange
        colorGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        this.ctx.fillStyle = colorGrad;
        this.ctx.beginPath();
        this.ctx.arc(sx, sy, screenRadius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();
    }

    drawShadowVolume(ctx, gx, gy, gw, gh, lx, ly, radius, lOffX = 0.5, lOffY = 0.5) {
        const ts = this.tileSize;
        const tx = (gx * ts) - this.camera.x;
        const ty = (gy * ts) - this.camera.y;
        
        // FIX: Use full tile size for shadows as requested.
        const tw = gw * ts;
        const th = gh * ts;

        let lsx = (lx * ts) - this.camera.x + (ts * lOffX);
        let lsy = (ly * ts) - this.camera.y + (ts * lOffY);

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
        const pad = 1;

        const corners = [
            { x: tx + pad, y: ty + pad },
            { x: tx + tw - pad, y: ty + pad },
            { x: tx + tw - pad, y: ty + th - pad },
            { x: tx + pad, y: ty + th - pad }
        ];

        // Optimization: Reuse array to prevent GC thrashing
        this.shadowPoints.length = 0;
        const points = this.shadowPoints;

        // Use a large distance to ensure shadows extend off-screen
        const projectDist = Math.max(this.canvas.width, this.canvas.height) * 2;

        corners.forEach(c => {
            points.push(c);
            const dx = c.x - lsx;
            const dy = c.y - lsy;
            // Fast approximate length check to avoid sqrt if possible? No, need normalization.
            // But we can check if dx/dy are tiny.
            if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
                const len = Math.sqrt(dx*dx + dy*dy);
                points.push({
                    x: c.x + (dx / len) * projectDist,
                    y: c.y + (dy / len) * projectDist
                });
            }
        });

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

        // Reuse buffer for hull construction? 
        // It's tricky because we need two stacks. Let's just optimize the array creation slightly.
        const lower = []; 
        for (let p of points) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
            lower.push(p);
        }
        const upper = []; 
        for (let i = points.length - 1; i >= 0; i--) {
            const p = points[i];
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
            upper.push(p);
        }
        upper.pop(); lower.pop();
        return lower.concat(upper);
    }

    render(grid, entities, loot, projectiles, interaction, localPlayerId) {
        // Check if we need to update static cache
        if (this.gridSystem && this.gridSystem.revision !== this.lastGridRevision) {
            this.updateStaticCache(grid);
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

        this.drawFloor(grid, grid[0].length, grid.length);
        this.drawWalls(grid, grid[0].length, grid.length);
        this.drawLoot(loot);
        
        // 1. Update Shadow Buffer (Offscreen)
        this.drawShadowLayer(grid, this.visualEntities.get(localPlayerId), entities);

        // 2. Draw Entities & Projectiles (Before Roofs/Ambient)
        this.drawProjectiles(projectiles);
        this.drawEntities(entities, localPlayerId, 'REMOTE');
        this.updateAndDrawParticles();
        this.drawEffects();
        
        // 3. Draw Roofs (Occludes entities)
        this.drawRoof(grid, grid[0].length, grid.length);

        // 4. Draw Ambient Darkness (Over Everything)
        this.drawAmbientLayer(this.visualEntities.get(localPlayerId));

        // 5. Draw Local Player (Bright, Occluded by Roofs)
        // Reuse shadowCanvas as buffer to mask player against roofs
        const sCtx = this.shadowCtx;
        sCtx.save();
        sCtx.clearRect(0, 0, this.shadowCanvas.width, this.shadowCanvas.height);
        
        this.drawEntities(entities, localPlayerId, 'LOCAL', sCtx);
        
        sCtx.globalCompositeOperation = 'destination-out';
        const camX = Math.floor(this.camera.x);
        const camY = Math.floor(this.camera.y);
        sCtx.translate(-camX, -camY);
        sCtx.drawImage(this.staticCacheTop, 0, 0);
        sCtx.translate(camX, camY);
        sCtx.restore();

        this.ctx.drawImage(this.shadowCanvas, 0, 0);

        // 6. Draw Torch Overlay (New Step)
        this.drawTorchOverlay(this.visualEntities.get(localPlayerId));

        this.ctx.restore(); // Restore shake

        // Draw UI-like world elements (Floating Text, Interaction) on top, unaffected by shake
        this.drawFloatingTexts();
        this.drawInteractionBar(interaction, myPos);

        this.ctx.restore(); // Restore scale
    }
}