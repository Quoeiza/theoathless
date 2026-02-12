export default class GridSystem {
    constructor(width, height, tileSize) {
        this.width = width;
        this.height = height;
        this.tileSize = tileSize;
        this.grid = []; // 0: Floor, 1: Wall
        this.entities = new Map(); // Map<EntityID, {x, y, facing: {x, y}}>
    }

    initializeDungeon() {
        // 1. Fill with walls
        this.grid = new Array(this.height).fill(0).map(() => new Array(this.width).fill(1));

        const rooms = [];
        const maxRooms = 10;
        const minSize = 5;
        const maxSize = 12;

        // 2. Place Rooms
        for (let i = 0; i < maxRooms; i++) {
            const w = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
            const h = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
            const x = Math.floor(Math.random() * (this.width - w - 2)) + 1;
            const y = Math.floor(Math.random() * (this.height - h - 2)) + 1;

            const newRoom = { x, y, w, h, cx: x + Math.floor(w/2), cy: y + Math.floor(h/2) };

            // Check overlap (simple check)
            const failed = rooms.some(r => 
                x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y
            );

            if (!failed) {
                this.createRoom(newRoom);
                
                // 3. Connect to previous room
                if (rooms.length > 0) {
                    const prev = rooms[rooms.length - 1];
                    this.createCorridor(prev.cx, prev.cy, newRoom.cx, newRoom.cy);
                }
                rooms.push(newRoom);
            }
        }
    }

    createRoom(room) {
        for (let y = room.y; y < room.y + room.h; y++) {
            for (let x = room.x; x < room.x + room.w; x++) {
                this.grid[y][x] = 0;
            }
        }
    }

    createCorridor(x1, y1, x2, y2) {
        // Horizontal then Vertical
        const startX = Math.min(x1, x2);
        const endX = Math.max(x1, x2);
        for (let x = startX; x <= endX; x++) this.grid[y1][x] = 0;
        
        const startY = Math.min(y1, y2);
        const endY = Math.max(y1, y2);
        for (let y = startY; y <= endY; y++) this.grid[y][x2] = 0;
    }

    isWalkable(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
        return this.grid[y][x] === 0;
    }

    // Returns true if move successful
    moveEntity(entityId, dx, dy) {
        const pos = this.entities.get(entityId);
        if (!pos) return false;

        // Update facing direction regardless of collision
        if (dx !== 0 || dy !== 0) {
            pos.facing = { x: dx, y: dy };
        }

        const newX = pos.x + dx;
        const newY = pos.y + dy;

        if (this.isWalkable(newX, newY)) {
            // Check for entity collision (very basic O(N) for now)
            for (const [otherId, otherPos] of this.entities) {
                if (otherId !== entityId && otherPos.x === newX && otherPos.y === newY) {
                    return { success: false, collision: otherId };
                }
            }
            
            pos.x = newX;
            pos.y = newY;
            return { success: true, x: newX, y: newY };
        }
        
        return { success: false, collision: 'wall' };
    }

    getEntityAt(x, y) {
        for (const [id, pos] of this.entities) {
            if (pos.x === x && pos.y === y) {
                return id;
            }
        }
        return null;
    }

    addEntity(id, x, y) {
        this.entities.set(id, { x, y, facing: { x: 0, y: 1 } });
    }

    removeEntity(id) {
        this.entities.delete(id);
    }

    getSpawnPoint() {
        // Find a random floor tile
        let attempts = 0;
        while(attempts < 100) {
            const x = Math.floor(Math.random() * this.width);
            const y = Math.floor(Math.random() * this.height);
            if (this.grid[y][x] === 0) {
                return { x, y };
            }
            attempts++;
        }
        return { x: 1, y: 1 }; // Fallback
    }

    setTile(x, y, value) {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            this.grid[y][x] = value;
        }
    }

    spawnExtractionZone() {
        const pos = this.getSpawnPoint();
        this.setTile(pos.x, pos.y, 9); // 9 = Extraction Zone
        return pos;
    }
}