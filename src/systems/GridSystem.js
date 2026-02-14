export default class GridSystem {
    constructor(width, height, tileSize) {
        this.width = width;
        this.height = height;
        this.tileSize = tileSize;
        this.grid = []; // 0: Floor, 1: Wall
        this.torches = []; // Array of {x, y}
        this.entities = new Map(); // Map<EntityID, {x, y, facing: {x, y}}>
        this.spatialMap = new Map(); // Map<int, EntityID> - Optimization for O(1) lookups
    }

    initializeDungeon() {
        // 1. Fill with walls
        this.grid = new Array(this.height).fill(0).map(() => new Array(this.width).fill(1));
        this.rooms = [];
        this.torches = [];
        this.spawnRooms = []; // Special rooms for player spawns
        this.spatialMap.clear();
        
        // TEST MODE: Single Room (20x20) centered
        const roomW = 20;
        const roomH = 20;
        const roomX = Math.floor((this.width - roomW) / 2);
        const roomY = Math.floor((this.height - roomH) / 2);

        const room = {
            x: roomX,
            y: roomY,
            w: roomW,
            h: roomH,
            cx: roomX + Math.floor(roomW/2),
            cy: roomY + Math.floor(roomH/2),
            isSpawn: true
        };

        this.createRoom(room);
        this.rooms.push(room);
        this.spawnRooms.push(room);

        // Add corner torches
        this.grid[roomY][roomX] = 5; this.torches.push({x: roomX, y: roomY});
        this.grid[roomY][roomX + roomW - 1] = 5; this.torches.push({x: roomX + roomW - 1, y: roomY});
        this.grid[roomY + roomH - 1][roomX] = 5; this.torches.push({x: roomX, y: roomY + roomH - 1});
        this.grid[roomY + roomH - 1][roomX + roomW - 1] = 5; this.torches.push({x: roomX + roomW - 1, y: roomY + roomH - 1});
    }

    splitContainer(container, iter) {
        const root = { ...container, left: null, right: null };
        
        if (iter <= 0 || (container.w < 12 && container.h < 12)) {
            return root;
        }

        // Determine split direction (vertical or horizontal)
        // Bias towards splitting the longer dimension
        let splitH = Math.random() > 0.5;
        if (container.w > container.h && container.w / container.h >= 1.1) splitH = false;
        else if (container.h > container.w && container.h / container.w >= 1.1) splitH = true;

        const max = (splitH ? container.h : container.w) - 8; // Min size 8
        if (max <= 10) return root; // Too small to split

        const splitAt = Math.floor(Math.random() * (max - 10)) + 10;

        if (splitH) {
            root.left = this.splitContainer({ x: container.x, y: container.y, w: container.w, h: splitAt }, iter - 1);
            root.right = this.splitContainer({ x: container.x, y: container.y + splitAt, w: container.w, h: container.h - splitAt }, iter - 1);
        } else {
            root.left = this.splitContainer({ x: container.x, y: container.y, w: splitAt, h: container.h }, iter - 1);
            root.right = this.splitContainer({ x: container.x + splitAt, y: container.y, w: container.w - splitAt, h: container.h }, iter - 1);
        }

        return root;
    }

    getLeaves(node) {
        if (!node.left && !node.right) return [node];
        let leaves = [];
        if (node.left) leaves = leaves.concat(this.getLeaves(node.left));
        if (node.right) leaves = leaves.concat(this.getLeaves(node.right));
        return leaves;
    }

    connectBSPNodes(node) {
        if (node.left && node.right) {
            this.connectBSPNodes(node.left);
            this.connectBSPNodes(node.right);

            // Connect the two children
            // Find a room in the left branch and a room in the right branch
            const leftLeaves = this.getLeaves(node.left);
            const rightLeaves = this.getLeaves(node.right);
            const roomA = leftLeaves[Math.floor(Math.random() * leftLeaves.length)].room;
            const roomB = rightLeaves[Math.floor(Math.random() * rightLeaves.length)].room;

            if (roomA && roomB) {
                this.createCorridor(roomA.cx, roomA.cy, roomB.cx, roomB.cy);
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
        x = Math.round(x);
        y = Math.round(y);
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
        const t = this.grid[y][x];
        return t === 0 || t === 2 || t === 3 || t === 4 || t === 9;
    }

    getMovementCost(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 1.0;
        const t = this.grid[y][x];
        if (t === 2 || t === 3) return 2.0; // Water/Mud slows significantly
        if (t === 4) return 1.5; // Lava slows
        return 1.0;
    }

    hasLineOfSight(x0, y0, x1, y1) {
        // Ensure integers and finite numbers
        x0 = Math.floor(x0); y0 = Math.floor(y0);
        x1 = Math.floor(x1); y1 = Math.floor(y1);
        if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return false;

        let dx = Math.abs(x1 - x0);
        let dy = Math.abs(y1 - y0);
        let sx = (x0 < x1) ? 1 : -1;
        let sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;

        let loops = 0;
        while (true) {
            if (loops++ > 100) return false; // Safety break
            if (x0 === x1 && y0 === y1) return true;
            
            // Bounds check
            if (y0 < 0 || y0 >= this.height || x0 < 0 || x0 >= this.width) return false;

            // Check wall (blocking)
            if (this.grid[y0][x0] === 1 || this.grid[y0][x0] === 5) return false;

            let e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
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

        // Diagonal check: Prevent moving through hard corners (two adjacent walls)
        if (dx !== 0 && dy !== 0) {
            if (!this.isWalkable(pos.x + dx, pos.y) && !this.isWalkable(pos.x, pos.y + dy)) {
                return { success: false, collision: 'wall' };
            }
        }

        if (this.isWalkable(newX, newY)) {
            // Check for entity collision (very basic O(N) for now)
            const otherId = this.getEntityAt(newX, newY);
            if (otherId && otherId !== entityId) {
                return { success: false, collision: otherId };
            }
            this.updateSpatialMap(entityId, pos.x, pos.y, newX, newY);
            pos.x = newX;
            pos.y = newY;
            return { success: true, x: newX, y: newY };
        }
        
        return { success: false, collision: 'wall' };
    }

    getKey(x, y) {
        // Integer key optimization to reduce GC pressure from string generation
        return (Math.round(y) * this.width) + Math.round(x);
    }

    updateSpatialMap(id, oldX, oldY, newX, newY) {
        this.spatialMap.delete(this.getKey(oldX, oldY));
        this.spatialMap.set(this.getKey(newX, newY), id);
    }

    getEntityAt(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
        return this.spatialMap.get(this.getKey(x, y)) || null;
    }

    addEntity(id, x, y) {
        this.entities.set(id, { x, y, facing: { x: 0, y: 1 } });
        this.spatialMap.set(this.getKey(x, y), id);
    }

    removeEntity(id) {
        const pos = this.entities.get(id);
        if (pos) {
            const key = this.getKey(pos.x, pos.y);
            if (this.spatialMap.get(key) === id) {
                this.spatialMap.delete(key);
            }
        }
        this.entities.delete(id);
    }

    syncRemoteEntities(remoteEntities, localId) {
        // Track entities to remove (present locally but missing from server)
        const toRemove = new Set();
        for (const id of this.entities.keys()) {
            if (id !== localId) toRemove.add(id);
        }

        for (const [id, data] of remoteEntities) {
            if (id === localId) continue; // Do not overwrite local player prediction

            toRemove.delete(id); // Entity exists on server, keep it

            const current = this.entities.get(id);
            // Update only if position changed (optimization)
            if (!current || current.x !== data.x || current.y !== data.y) {
                if (current) {
                    // Clean up old spatial position
                    const oldKey = this.getKey(current.x, current.y);
                    if (this.spatialMap.get(oldKey) === id) {
                        this.spatialMap.delete(oldKey);
                    }
                }
                
                // Set new state
                const entity = current || { facing: {x:0, y:1} };
                entity.x = data.x;
                entity.y = data.y;
                entity.facing = data.facing || entity.facing;
                entity.invisible = data.invisible;
                
                this.entities.set(id, entity);
                this.spatialMap.set(this.getKey(data.x, data.y), id);
            }
        }

        // Remove stale entities
        for (const id of toRemove) {
            this.removeEntity(id);
        }
    }

    getValidSpawnLocations() {
        const locations = [];
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.grid[y][x] === 0) { // Only spawn on clean floor
                    // Exclude spawn rooms
                    const inSpawnRoom = this.spawnRooms.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
                    if (!inSpawnRoom) {
                        locations.push({ x, y });
                    }
                }
            }
        }
        return locations;
    }

    getSpawnPoint(isPlayer = false) {
        // If player, try to spawn in a safe spawn room
        if (isPlayer && this.spawnRooms.length > 0) {
            // Pick a random spawn room
            const room = this.spawnRooms[Math.floor(Math.random() * this.spawnRooms.length)];
            // Return center of that room
            return { x: room.cx, y: room.cy };
        }

        // Find a random floor tile
        let attempts = 0;
        while(attempts < 100) {
            const x = Math.floor(Math.random() * this.width);
            const y = Math.floor(Math.random() * this.height);
            // Ensure we don't spawn monsters in spawn rooms
            const inSpawnRoom = this.spawnRooms.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
            
            if (this.grid[y][x] === 0 && !this.getEntityAt(x, y) && !inSpawnRoom) {
                return { x, y };
            }
            attempts++;
        }
        
        // Fallback: Scan for first valid floor tile
        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                if (this.grid[y][x] === 0 && !this.getEntityAt(x, y)) {
                    return { x, y };
                }
            }
        }
        return { x: 1, y: 1 }; // Ultimate Fallback
    }

    getChestSpawnLocations() {
        const locs = [];
        if (!this.rooms) return locs;
        
        for (const r of this.rooms) {
            if (r.isSpawn) continue; // No chests in spawn rooms
            // Add corners (guaranteed to be inside room and usually safe from center-corridors)
            locs.push({ x: r.x, y: r.y });
            locs.push({ x: r.x + r.w - 1, y: r.y });
            locs.push({ x: r.x, y: r.y + r.h - 1 });
            locs.push({ x: r.x + r.w - 1, y: r.y + r.h - 1 });
        }
        return locs;
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

    populate(combatSystem, lootSystem, config) {
        // Test Mode: Single Respawning Enemy
        const spawn = this.getSpawnPoint();
        const id = `test_enemy_${Date.now()}`;
        this.addEntity(id, spawn.x, spawn.y);
        
        // Pick first enemy type from config or default to 'slime'
        const type = config.enemies && Object.keys(config.enemies).length > 0 
            ? Object.keys(config.enemies)[0] 
            : 'slime';

        combatSystem.registerEntity(id, type, false);
        console.log(`GridSystem: Spawned test enemy ${type} (${id}) at ${spawn.x},${spawn.y}`);
    }

    findPath(startX, startY, endX, endY) {
        // Simple A* Implementation
        const startNode = { x: startX, y: startY, g: 0, h: 0, f: 0, parent: null };
        const openList = [startNode];
        const closedList = new Set();
        const endKey = this.getKey(endX, endY);

        while (openList.length > 0) {
            // Sort by F cost
            openList.sort((a, b) => a.f - b.f);
            const current = openList.shift();
            const currentKey = this.getKey(current.x, current.y);

            if (currentKey === endKey) {
                // Reconstruct path
                const path = [];
                let curr = current;
                while (curr.parent) {
                    path.unshift({ x: curr.x, y: curr.y });
                    curr = curr.parent;
                }
                return path;
            }

            closedList.add(currentKey);

            // Neighbors (8-way)
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    
                    const nx = current.x + dx;
                    const ny = current.y + dy;
                    
                    if (!this.isWalkable(nx, ny)) continue;
                    if (closedList.has(this.getKey(nx, ny))) continue;

                    const g = current.g + this.getMovementCost(nx, ny);
                    const h = Math.abs(nx - endX) + Math.abs(ny - endY); // Manhattan heuristic
                    const f = g + h;

                    const neighbor = { x: nx, y: ny, g, h, f, parent: current };
                    // Check if already in open list with lower G (skip optimization for brevity)
                    openList.push(neighbor);
                }
            }
        }
        return null; // No path found
    }
}