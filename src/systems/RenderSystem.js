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

        // Lighting Layer
        this.lightCanvas = document.createElement('canvas');
        this.lightCtx = this.lightCanvas.getContext('2d');
        this.lightCanvas.width = window.innerWidth;
        this.lightCanvas.height = window.innerHeight;

        // Shadow Layer (Offscreen)
        this.shadowCanvas = document.createElement('canvas');
        this.shadowCtx = this.shadowCanvas.getContext('2d');
        this.shadowCanvas.width = window.innerWidth;
        this.shadowCanvas.height = window.innerHeight;

        // TileMap Manager for sprite-based rendering
        this.tileMapManager = new TileMapManager(dungeonTilesetConfig);

        // Camera
        this.camera = { x: 0, y: 0 };
        
        // Visual Effects
        this.effects = []; // { x, y, type, startTime, duration }
        this.floatingTexts = []; // { x, y, text, color, startTime, duration }
        this.visualEntities = new Map(); // id -> { x, y, targetX, targetY, startX, startY, moveStartTime, attackStart, flashStart, bumpStart, bumpDir }
        this.shake = { intensity: 0, duration: 0, startTime: 0 };
        this.assetLoader = null;
    }

    setAssetLoader(loader) {
        this.assetLoader = loader;
        // After setting the loader, immediately start loading the tilemap assets
        this.tileMapManager.loadAssets(loader).catch(err => {
            console.error("Failed to load tilemap assets:", err);
        });
    }

    setGridSystem(gridSystem) {
        this.gridSystem = gridSystem;
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.lightCanvas.width = window.innerWidth;
        this.lightCanvas.height = window.innerHeight;
        this.shadowCanvas.width = window.innerWidth;
        this.shadowCanvas.height = window.innerHeight;
        this.ctx.imageSmoothingEnabled = false;
    }

    clear() {
        this.ctx.fillStyle = '#050505';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
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

        // --- Pass 1: Draw base floors with TileMapManager ---
        this.ctx.save();
        this.ctx.translate(-camX, -camY);
        this.tileMapManager.drawFloor(this.ctx, grid, viewBounds);
        this.ctx.restore();

        // --- Pass 2: Draw procedural floor tiles ---
        for (let y = startRow; y <= endRow; y++) {
            for (let x = startCol; x <= endCol; x++) {
                if (y < 0 || y >= height || x < 0 || x >= width) continue;

                const tile = grid[y][x];
                // TileMapManager has already drawn the base for tiles 0 and 1.
                // We only need to render the *additional* procedural parts.
                if (tile !== 0 && tile !== 1) {
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
                    } else if (tile === 3) { // Mud
                        this.ctx.fillStyle = '#3e2723';
                        this.ctx.fillRect(screenX, screenY, ts, ts);
                        if (n > 0.5) {
                            this.ctx.fillStyle = '#281a15';
                            this.ctx.fillRect(screenX + (ts * 0.15), screenY + (ts * 0.15), ts * 0.15, ts * 0.15);
                        }
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

        // --- Pass 1: Draw base walls with TileMapManager ---
        this.ctx.save();
        this.ctx.translate(-camX, -camY);
        this.tileMapManager.drawWalls(this.ctx, grid, viewBounds);
        this.ctx.restore();

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

        this.ctx.save();
        this.ctx.translate(-camX, -camY);
        this.tileMapManager.drawRoof(this.ctx, grid, viewBounds);
        this.ctx.restore();
    }

    triggerShake(intensity, duration) {
        this.shake.intensity = intensity;
        this.shake.duration = duration;
        this.shake.startTime = Date.now();
    }

    triggerHitFlash(id) {
        const visual = this.visualEntities.get(id);
        if (visual) visual.flashStart = Date.now();
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

    drawEntities(entities, localPlayerId) {
        const now = Date.now();
        
        // Prune visuals that no longer exist
        for (const id of this.visualEntities.keys()) {
            if (!entities.has(id)) {
                this.visualEntities.delete(id);
            }
        }

        // 2. Update Visual State & Prepare Render List
        const renderList = [];

        entities.forEach((pos, id) => {
            let visual = this.visualEntities.get(id);
            if (!visual) {
                visual = { 
                    x: pos.x, y: pos.y, 
                    targetX: pos.x, targetY: pos.y,
                    startX: pos.x, startY: pos.y,
                    moveStartTime: 0,
                    attackStart: 0, flashStart: 0,
                    bumpStart: 0, bumpDir: null,
                    lastFacingX: -1 // Default Left
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
            const moveDuration = 250;
            const t = Math.min(1, (now - visual.moveStartTime) / moveDuration);
            visual.x = visual.startX + (visual.targetX - visual.startX) * t;
            visual.y = visual.startY + (visual.targetY - visual.startY) * t;

            renderList.push({ id, pos, visual });
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

            // Stealth Check
            if (pos.invisible) {
                if (id !== localPlayerId) continue; // Completely invisible to others
                this.ctx.globalAlpha = 0.5; // Ghostly for self
            } else {
                this.ctx.globalAlpha = 1.0;
            }

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

            const screenX = Math.floor((visual.x * this.tileSize) - Math.floor(this.camera.x) + offsetX + bumpX);
            const screenY = Math.floor((visual.y * this.tileSize) - Math.floor(this.camera.y) + offsetY + hopOffset + bumpY);

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
                    this.ctx.beginPath();
                    // Left Nub (Bottom to Top)
                    this.ctx.arc(cx - w, cy, tipR, Math.PI * 0.5, Math.PI * 1.5);
                    // Top Curve
                    this.ctx.quadraticCurveTo(cx, cy + h - th, cx + w, cy - tipR);
                    // Right Nub (Top to Bottom)
                    this.ctx.arc(cx + w, cy, tipR, -Math.PI * 0.5, Math.PI * 0.5);
                    // Bottom Curve
                    this.ctx.quadraticCurveTo(cx, cy + h, cx - w, cy + tipR);
                    this.ctx.closePath();
                };

                // Background
                definePath();
                this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                this.ctx.fill();

                // Foreground
                if (hpRatio > 0) {
                    this.ctx.save();
                    definePath();
                    this.ctx.clip();
                    this.ctx.fillStyle = hpRatio > 0.5 ? '#4d4' : '#d44';
                    this.ctx.fillRect(cx - w, cy, (2 * w) * hpRatio, h);
                    this.ctx.restore();
                }

                // Border
                definePath();
                this.ctx.lineWidth = 0.3;
                this.ctx.strokeStyle = '#000';
                this.ctx.stroke();
            }

            // Shadow
            this.ctx.fillStyle = 'rgba(20, 19, 31, 0.6)';
            this.ctx.beginPath();
            this.ctx.ellipse(screenX + (this.tileSize * 0.5), screenY + (this.tileSize * 0.875), this.tileSize * 0.3125, this.tileSize * 0.125, 0, 0, Math.PI * 2);
            this.ctx.fill();

            // Determine Sprite
            let spriteKey = null;
            if (pos.type === 'player') spriteKey = 'knight';
            
            const img = this.assetLoader ? this.assetLoader.getImage(spriteKey) : null;

            if (img) {
                // --- Sprite Rendering ---
                this.ctx.save();

                // Update Facing Memory (Retain last horizontal direction)
                if (pos.facing && pos.facing.x !== 0) {
                    visual.lastFacingX = pos.facing.x;
                }
                const facingX = visual.lastFacingX;

                const centerX = screenX + (this.tileSize * 0.5);
                const centerY = screenY + (this.tileSize * 0.5);

                this.ctx.translate(centerX, centerY);

                // Sprite defaults to Left. Flip if facing Right.
                if (facingX > 0) {
                    this.ctx.scale(-1, 1);
                }

                // Draw Sprite Anchored to Bottom-Center of Tile
                // Use natural image size to allow extending upwards
                const spriteW = img.width;
                const spriteH = img.height;
                
                // Calculate Y offset: Bottom of sprite aligns with bottom of tile (+tileSize/2 relative to center)
                const drawY = (this.tileSize / 2) - spriteH;
                this.ctx.drawImage(img, Math.floor(-spriteW / 2), Math.floor(drawY), spriteW, spriteH);
                this.ctx.restore();
            } else {
                // --- Fallback Procedural Rendering ---

                // Body
                const isMe = (id === localPlayerId);
                const isFlashing = (now - visual.flashStart < 100); // 100ms flash

                if (isFlashing) {
                    this.ctx.fillStyle = '#FFFFFF';
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
                    const grad = this.ctx.createRadialGradient(screenX + (this.tileSize * 0.5), screenY + (this.tileSize * 0.5), this.tileSize * 0.06, screenX + (this.tileSize * 0.5), screenY + (this.tileSize * 0.5), this.tileSize * 0.375);
                    grad.addColorStop(0, isMe && pos.team !== 'monster' ? '#6c8' : '#c66');
                    grad.addColorStop(1, baseColor);
                    
                    // Simple shape differentiation
                    if (pos.type === 'slime') {
                        // Slimes are slightly translucent
                        this.ctx.globalAlpha = 0.9;
                    }
                    this.ctx.fillStyle = grad;
                }

                this.ctx.beginPath();
                this.ctx.arc(screenX + (this.tileSize * 0.5), screenY + (this.tileSize * 0.5), this.tileSize * 0.3125, 0, Math.PI * 2);
                this.ctx.fill();

                // Draw facing indicator
                if (pos.facing) {
                    const indicatorX = screenX + (this.tileSize * 0.5) + (pos.facing.x * (this.tileSize * 0.375));
                    const indicatorY = screenY + (this.tileSize * 0.5) + (pos.facing.y * (this.tileSize * 0.375));
                    this.ctx.fillStyle = 'rgba(255,255,255,0.8)';
                    this.ctx.fillRect(indicatorX - (this.tileSize * 0.06), indicatorY - (this.tileSize * 0.06), this.tileSize * 0.125, this.tileSize * 0.125);
                }
            }
            
            this.ctx.globalAlpha = 1.0; // Reset
        }
    }

    updateCamera(targetX, targetY) {
        // Smooth Camera Follow
        const targetCamX = (targetX * this.tileSize) - (this.canvas.width / (2 * this.scale));
        const targetCamY = (targetY * this.tileSize) - (this.canvas.height / (2 * this.scale));
        
        if (!Number.isFinite(targetCamX) || !Number.isFinite(targetCamY)) return;

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
        if (this.tileMapManager) {
            return this.tileMapManager.getTileVal(grid, x, y) === 1;
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

    renderLighting(grid, playerVisual) {
        const ctx = this.lightCtx;
        const sCtx = this.shadowCtx;
        const w = this.lightCanvas.width;
        const h = this.lightCanvas.height;
        const ts = this.tileSize;

        // 1. Clear & Draw Ambient Darkness (High Contrast)
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(20, 19, 31, 0.9)'; // Grimdark ambient
        ctx.fillRect(0, 0, w, h);

        if (!playerVisual) return;

        // 2. Torch Configuration
        const radius = 10; // Tiles
        const px = playerVisual.x;
        const py = playerVisual.y;
        
        // Calculate Screen Coordinates
        const sx = Math.floor((px * ts) - this.camera.x + (ts * 0.5));
        const sy = Math.floor((py * ts) - this.camera.y + (ts * 0.5));
        const screenRadius = radius * ts;

        ctx.save();
        
        // 3. Cut the "Light Hole" (Attenuation)
        // We use destination-out to remove the darkness, creating the light source.
        ctx.globalCompositeOperation = 'destination-out';
        const grad = ctx.createRadialGradient(sx, sy, ts * 1.5, sx, sy, screenRadius);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)'); // Core
        grad.addColorStop(0.7, 'rgba(255, 255, 255, 0.3)'); // Falloff
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)'); // Edge
        
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sx, sy, screenRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 4. Prepare Shadows (Offscreen)
        sCtx.clearRect(0, 0, w, h);
        
        // --- IMPROVED SHADOW LOGIC ---
        // We separate walls into two lists:
        // 1. Casters: Visible walls that generate shadow volumes.
        // 2. Maskers: ALL walls in the vicinity. These must be erased from the shadow 
        //    layer so shadows don't "draw over" the top of walls.
        
        const casters = [];
        const maskers = [];

        const iPx = Math.floor(px);
        const iPy = Math.floor(py);
        
        // Iterate over the visible screen area plus padding to ensure all on-screen walls cast shadows
        const startCol = Math.floor(this.camera.x / ts) - 2;
        const endCol = startCol + (this.canvas.width / this.scale / ts) + 4;
        const startRow = Math.floor(this.camera.y / ts) - 2;
        const endRow = startRow + (this.canvas.height / this.scale / ts) + 4;

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
                        maskerSeg = { x, y, w: 1 };
                    }
                } else {
                    if (maskerSeg) {
                        maskers.push(maskerSeg);
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
                        casters.push(casterSeg);
                        casterSeg = null;
                    }
                }
            }
            // Flush segments at end of row
            if (maskerSeg) maskers.push(maskerSeg);
            if (casterSeg) casters.push(casterSeg);
        }

        sCtx.save();
        
        // A. Draw Shadow Volumes
        sCtx.globalCompositeOperation = 'source-over';
        sCtx.fillStyle = 'rgba(20, 19, 31, 0.9)'; // Match ambient
        sCtx.filter = 'blur(4px)'; // Slight blur for soft shadows

        for (const wall of casters) {
            this.drawShadowVolume(sCtx, wall.x, wall.y, wall.w, 1, px, py, radius);
        }

        // B. Mask out ALL Walls (Prevents "Green Circle" issue)
        // This ensures a wall tile never has a shadow drawn on top of it.
        sCtx.globalCompositeOperation = 'destination-out';
        sCtx.filter = 'none'; // Sharp cutout for walls
        sCtx.fillStyle = '#FFFFFF';

        for (const wall of maskers) {
            const tx = Math.floor((wall.x * ts) - this.camera.x);
            const ty = Math.floor((wall.y * ts) - this.camera.y);
            sCtx.fillRect(tx, ty, wall.w * ts, ts);
        }
        sCtx.restore();

        // 6. Apply Shadows to Light Layer
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(this.shadowCanvas, 0, 0);
        ctx.restore();

        // 7. Apply Lighting Layer to Main Canvas
        this.ctx.drawImage(this.lightCanvas, 0, 0);

        // 8. Warm Hue Overlay (Torch Color)
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

    drawShadowVolume(ctx, gx, gy, gw, gh, lx, ly, radius) {
        const ts = this.tileSize;
        const tx = (gx * ts) - this.camera.x;
        const ty = (gy * ts) - this.camera.y;
        const tw = gw * ts;
        const th = gh * ts;
        const lsx = (lx * ts) - this.camera.x + (ts * 0.5);
        const lsy = (ly * ts) - this.camera.y + (ts * 0.5);

        const corners = [
            { x: tx, y: ty },
            { x: tx + tw, y: ty },
            { x: tx + tw, y: ty + th },
            { x: tx, y: ty + th }
        ];

        const points = [];
        // Use a large distance to ensure shadows extend off-screen
        const projectDist = Math.max(this.canvas.width, this.canvas.height) * 2;

        corners.forEach(c => {
            points.push(c);
            const dx = c.x - lsx;
            const dy = c.y - lsy;
            const len = Math.sqrt(dx*dx + dy*dy);
            if (len > 0.001) {
                points.push({
                    x: c.x + (dx / len) * projectDist,
                    y: c.y + (dy / len) * projectDist
                });
            }
        });

        let cx = 0, cy = 0;
        points.forEach(p => { cx += p.x; cy += p.y; });
        cx /= points.length;
        cy /= points.length;

        points.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.closePath();
        ctx.fill();
    }

    render(grid, entities, loot, projectiles, interaction, localPlayerId) {
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
                    attackStart: 0, flashStart: 0 
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
        this.drawProjectiles(projectiles);
        this.drawEntities(entities, localPlayerId);
        this.drawEffects();
        this.drawRoof(grid, grid[0].length, grid.length);
        
        // Render Lighting Pass (Dynamic Shadows & Torch)
        this.renderLighting(grid, this.visualEntities.get(localPlayerId));
        
        this.ctx.restore(); // Restore shake

        // Draw UI-like world elements (Floating Text, Interaction) on top, unaffected by shake
        this.drawFloatingTexts();
        this.drawInteractionBar(interaction, myPos);

        this.ctx.restore(); // Restore scale
    }
}