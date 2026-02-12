export default class RenderSystem {
    constructor(canvasId, width, height, tileSize) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.tileSize = tileSize;
        
        // Camera
        this.camera = { x: 0, y: 0 };
        
        // Fog of War
        this.explored = new Set(); // "x,y"
        this.visible = new Set();  // "x,y"
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    clear() {
        this.ctx.fillStyle = '#111';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawGrid(grid, width, height) {
        const startCol = Math.floor(this.camera.x / this.tileSize);
        const endCol = startCol + (this.canvas.width / this.tileSize) + 1;
        const startRow = Math.floor(this.camera.y / this.tileSize);
        const endRow = startRow + (this.canvas.height / this.tileSize) + 1;

        for (let y = startRow; y <= endRow; y++) {
            for (let x = startCol; x <= endCol; x++) {
                if (y >= 0 && y < height && x >= 0 && x < width) {
                    const key = `${x},${y}`;
                    const isVisible = this.visible.has(key);
                    const isExplored = this.explored.has(key);

                    if (!isExplored && !isVisible) {
                        // Draw nothing (black background)
                        continue;
                    }

                    const tile = grid[y][x];
                    const screenX = (x * this.tileSize) - this.camera.x;
                    const screenY = (y * this.tileSize) - this.camera.y;

                    // Draw Tile
                    if (tile === 1) {
                        this.ctx.fillStyle = '#444'; // Wall
                        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                    } else if (tile === 9) {
                        this.ctx.fillStyle = '#00FFFF'; // Extraction Zone (Cyan)
                        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                        this.ctx.strokeRect(screenX, screenY, this.tileSize, this.tileSize);
                    } else {
                        this.ctx.fillStyle = '#222'; // Floor
                        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                        this.ctx.strokeStyle = '#333';
                        this.ctx.strokeRect(screenX, screenY, this.tileSize, this.tileSize);
                    }

                    // Draw Fog Overlay for Explored but not Visible
                    if (isExplored && !isVisible) {
                        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                    }
                }
            }
        }
    }

    drawEntities(entities, localPlayerId) {
        entities.forEach((pos, id) => {
            // Don't draw entities in FOW (unless it's me)
            const key = `${pos.x},${pos.y}`;
            if (id !== localPlayerId && !this.visible.has(key)) return;

            const screenX = (pos.x * this.tileSize) - this.camera.x;
            const screenY = (pos.y * this.tileSize) - this.camera.y;

            this.ctx.fillStyle = (id === localPlayerId) ? '#0f0' : '#f00';
            this.ctx.fillRect(screenX + 4, screenY + 4, this.tileSize - 8, this.tileSize - 8);

            // Draw facing indicator
            if (pos.facing) {
                const indicatorX = screenX + (this.tileSize / 2) + (pos.facing.x * 10);
                const indicatorY = screenY + (this.tileSize / 2) + (pos.facing.y * 10);
                this.ctx.fillStyle = '#fff';
                this.ctx.fillRect(indicatorX - 2, indicatorY - 2, 4, 4);
            }
        });
    }

    updateCamera(targetX, targetY) {
        // Center camera on target
        this.camera.x = (targetX * this.tileSize) - (this.canvas.width / 2);
        this.camera.y = (targetY * this.tileSize) - (this.canvas.height / 2);
    }

    drawLoot(lootMap) {
        lootMap.forEach((loot) => {
            // Don't draw loot in FOW
            if (!this.visible.has(`${loot.x},${loot.y}`)) return;

            const screenX = (loot.x * this.tileSize) - this.camera.x;
            const screenY = (loot.y * this.tileSize) - this.camera.y;
            
            this.ctx.fillStyle = '#FFD700'; // Gold color for loot
            this.ctx.fillRect(screenX + 10, screenY + 10, this.tileSize - 20, this.tileSize - 20);
        });
    }

    updateFog(playerPos, grid) {
        this.visible.clear();
        if (!playerPos) return;

        const radius = 8; // Vision radius
        const r2 = radius * radius;

        for (let y = playerPos.y - radius; y <= playerPos.y + radius; y++) {
            for (let x = playerPos.x - radius; x <= playerPos.x + radius; x++) {
                const dx = x - playerPos.x;
                const dy = y - playerPos.y;
                if (dx*dx + dy*dy <= r2) {
                    const key = `${x},${y}`;
                    this.visible.add(key);
                    this.explored.add(key);
                }
            }
        }
    }

    render(grid, entities, loot, localPlayerId) {
        const myPos = entities.get(localPlayerId);
        this.updateFog(myPos, grid);

        this.clear();
        this.drawGrid(grid, grid[0].length, grid.length);
        this.drawLoot(loot);
        this.drawEntities(entities, localPlayerId);
    }
}