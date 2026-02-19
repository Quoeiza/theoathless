export default class GridSystem {
    constructor(width, height, tileSize) {
        // Cap the dungeon size to 100x100 to prevent performance issues
        this.width = Math.min(width, 100);
        this.height = Math.min(height, 100);
        this.tileSize = tileSize;
        this.grid = []; // 0: Floor, 1: Wall
        this.entities = new Map(); // Map<EntityID, {x, y, facing: {x, y}}>
        this.spatialMap = new Map(); // Map<int, EntityID> - Optimization for O(1) lookups
        this.revision = 0;
        this.lavaTimer = 0;
    }

    initializeDungeon() {
        // 1. Fill with walls
        this.grid = new Array(this.height).fill(0).map(() => new Array(this.width).fill(1));
        this.rooms = [];
        this.spawnRooms = []; // Special rooms for player spawns
        this.spatialMap.clear();

        // 2. Create dungeon layout with BSP
        const bspRoot = this.splitContainer({ x: 1, y: 1, w: this.width - 2, h: this.height - 2 }, 6);
        const leaves = this.getLeaves(bspRoot);

        // 3. Create rooms in the leaves
        for (const leaf of leaves) {
            // Maximize room size within the leaf for density
            // Leave 1 tile padding
            const availableW = leaf.w - 2;
            const availableH = leaf.h - 2;

            if (availableW < 3 || availableH < 3) continue;

            const roomW = Math.min(8, Math.max(3, Math.floor(availableW * (0.5 + Math.random() * 0.5))));
            const roomH = Math.min(8, Math.max(3, Math.floor(availableH * (0.5 + Math.random() * 0.5))));
            const roomX = leaf.x + 1 + Math.floor(Math.random() * (availableW - roomW + 1));
            const roomY = leaf.y + 1 + Math.floor(Math.random() * (availableH - roomH + 1));
            
            const room = {
                x: roomX, y: roomY, w: roomW, h: roomH,
                cx: roomX + Math.floor(roomW / 2),
                cy: roomY + Math.floor(roomH / 2),
                isSpawn: false
            };
            
            this.createRoom(room);
            this.rooms.push(room);
            leaf.room = room; // Attach room to leaf for corridor connection
        }

        // 4. Connect the rooms
        this.connectBSPNodes(bspRoot);

        // 4.5 Add extra random connections for twists and loops
        if (this.rooms.length > 0) {
            const extraCorridors = Math.floor(this.rooms.length * 1.5);
            for (let i = 0; i < extraCorridors; i++) {
                const r1 = this.rooms[Math.floor(Math.random() * this.rooms.length)];
                const r2 = this.rooms[Math.floor(Math.random() * this.rooms.length)];
                if (r1 !== r2) {
                    this.createCorridor(r1.cx, r1.cy, r2.cx, r2.cy);
                }
            }
        }

        // 5. Designate spawn rooms (e.g., the first two rooms) and add some features
        if (this.rooms.length > 0) {
            this.spawnRooms = this.rooms.slice(0, Math.min(2, this.rooms.length)).map(r => { 
                r.isSpawn = true; 
                return r; 
            });
        }
        
        // Puddle generation
        this.addFeature(2, 200, 10, 1);

        // 6. Place torches on some room walls
        for (const room of this.rooms) {
            if (Math.random() > 0.5) {
                const torchX = room.cx;
                const torchY = room.y; // Place on top wall of room
                if (this.grid[torchY-1] && this.grid[torchY-1][torchX] === 1) { // Check wall above
                    this.grid[torchY][torchX] = 0; // Ensure floor in front
                    this.grid[torchY-1][torchX] = 5;
                }
            }
        }
        this.revision++;
    }

    splitContainer(container, iter) {
        const root = { ...container, left: null, right: null };
        
        if (iter <= 0 || (container.w < 6 && container.h < 6)) {
            return root;
        }

        // Determine split direction (vertical or horizontal)
        // Bias towards splitting the longer dimension
        let splitH = Math.random() > 0.5;
        if (container.w > container.h && container.w / container.h >= 1.1) splitH = false;
        else if (container.h > container.w && container.h / container.w >= 1.1) splitH = true;

        const minSplit = 3;
        const max = (splitH ? container.h : container.w) - minSplit; 
        if (max <= minSplit) return root; // Too small to split

        const splitAt = Math.floor(Math.random() * (max - minSplit)) + minSplit;

        if (splitH) {
            root.left = this.splitContainer({ x: container.x, y: container.y, w: container.w, h: splitAt }, iter - 1);
            root.right = this.splitContainer({ x: container.x, y: container.y + splitAt, w: container.w, h: container.h - splitAt }, iter - 1);
        } else {
            root.left = this.splitContainer({ x: container.x, y: container.y, w: splitAt, h: container.h }, iter - 1);
            root.right = this.splitContainer({ x: container.x + splitAt, y: container.y, w: container.w - splitAt, h: container.h }, iter - 1);
        }

        return root;
    }

    getLeaves(node, result = []) {
        if (!node.left && !node.right) {
            result.push(node);
            return result;
        }
        if (node.left) this.getLeaves(node.left, result);
        if (node.right) this.getLeaves(node.right, result);
        return result;
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
        let x = x1;
        let y = y1;
        
        this.grid[y][x] = 0;

        while (x !== x2 || y !== y2) {
            const dx = x2 - x;
            const dy = y2 - y;
            
            // Prefer moving along the axis with greater distance, but add randomness
            // This creates a winding path that generally heads towards the target
            const moveX = Math.abs(dx) > Math.abs(dy) 
                ? Math.random() < 0.7 // 70% chance to follow major axis
                : Math.random() < 0.3; // 30% chance to follow minor axis (X)

            // If we are already at the target on one axis, force the other
            const forceX = (y === y2);
            const forceY = (x === x2);
            
            const isX = forceX || (moveX && !forceY);
            
            // Random step size for "jagged" look (1 to 3 tiles)
            const step = Math.floor(Math.random() * 3) + 1;
            const dir = isX ? Math.sign(dx) : Math.sign(dy);
            
            for (let i = 0; i < step; i++) {
                if (isX) { 
                    if (x === x2) break; 
                    x += dir; 
                    // Prevent horizontal corridors from being 1 tile away vertically from other floors
                    if (y >= 2 && this.grid[y-2][x] === 0) {
                        this.grid[y-1][x] = 0;
                    } else if (y >= 3 && this.grid[y-3][x] === 0) {
                        this.grid[y-1][x] = 0;
                        this.grid[y-2][x] = 0;
                    }
                    if (y <= this.height - 3 && this.grid[y+2][x] === 0) {
                        this.grid[y+1][x] = 0;
                    } else if (y <= this.height - 4 && this.grid[y+3][x] === 0) {
                        this.grid[y+1][x] = 0;
                        this.grid[y+2][x] = 0;
                    }
                } else { 
                    if (y === y2) break; 
                    y += dir; 
                }
                this.grid[y][x] = 0;
            }
        }
    }

    isWalkable(x, y) {
        x = Math.round(x);
        y = Math.round(y);
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
        const t = this.grid[y][x];
        
        // Standard walkable tiles
        if (t === 0 || t === 2 || t === 4 || t === 9) return true;

        // Special Case: "Top Edge" Walls (Visual Roof Rims)
        // Allows walking "behind" the wall (visually under the roof).
        // Condition: It is a Wall, the tile Above is Floor, and it is NOT a Front Face.
        if (t === 1 || t === 5) {
            if (y > 0) {
                const n = this.grid[y-1][x];
                // Check if North is Floor-like
                if (n === 0 || n === 2 || n === 4 || n === 9) {
                    // Check if this is a Front Face (Vertical Wall)
                    let isFrontFace = false;
                    // Scan downwards (Limit 2 to match TileMapManager)
                    for (let dy = 1; dy <= 2; dy++) {
                        if (y + dy >= this.height) break;
                        const val = this.grid[y+dy][x];
                        if (val === 0 || val === 2 || val === 4 || val === 9) {
                            isFrontFace = true;
                            break;
                        }
                        if (val !== 1 && val !== 5) break; // Obstructed
                    }
                    
                    // If it's NOT a front face, it's a walkable roof rim
                    if (!isFrontFace) return true;
                }
            }
        }

        return false;
    }

    getMovementCost(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 1.0;
        const t = this.grid[y][x];
        if (t === 4) return 1.5; // Lava slows
        return 1.0;
    }

    hasLineOfSight(x0, y0, x1, y1) {
        // Ensure integers and finite numbers
        x0 = Math.floor(x0); y0 = Math.floor(y0);
        x1 = Math.floor(x1); y1 = Math.floor(y1);
        if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return false;

        // Optimization: Quick distance check (approx 30 tiles radius)
        // 30^2 = 900. Prevents raycasting across the entire map for far-off entities.
        if ((x1 - x0) ** 2 + (y1 - y0) ** 2 > 900) return false;

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
            if (!this.isWalkable(x0, y0)) return false;

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
        // Bitwise key optimization (matches LootSystem strategy)
        return (Math.round(x) & 0xFFFF) | (Math.round(y) << 16);
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
                entity.type = data.type;
                entity.hp = data.hp;
                entity.maxHp = data.maxHp;
                
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
            this.revision++;
        }
    }

    setGrid(grid) {
        if (!grid || !grid.length) return;
        this.grid = grid;
        this.height = grid.length;
        this.width = grid[0].length;
        
        // Rebuild spatial map as keys depend on width
        this.spatialMap.clear();
        for (const [id, pos] of this.entities) {
            this.spatialMap.set(this.getKey(pos.x, pos.y), id);
        }
        this.revision++;
    }

    spawnEscapePortal() {
        const pos = this.getSpawnPoint();
        this.setTile(pos.x, pos.y, 9); // 9 = Escape Portal
        return pos;
    }

    populate(combatSystem, lootSystem, config) {
        // Test Mode: Spawn skeletons in every room
        let totalSpawned = 0;
        if (this.rooms) {
            for (const room of this.rooms) {
                if (room.isSpawn) continue; // Keep spawn rooms safe

                const count = Math.floor(Math.random() * 2) + 2; // 2-3 per room
                for (let i = 0; i < count; i++) {
                    for (let attempt = 0; attempt < 5; attempt++) {
                        const rx = room.x + Math.floor(Math.random() * room.w);
                        const ry = room.y + Math.floor(Math.random() * room.h);
                        
                        if (this.grid[ry][rx] === 0 && !this.getEntityAt(rx, ry)) {
                            const id = `skeleton_${totalSpawned}_${Date.now()}`;
                            this.addEntity(id, rx, ry);
                            combatSystem.registerEntity(id, 'skeleton', false);
                            totalSpawned++;
                            break;
                        }
                    }
                }
            }
        }
        console.log(`GridSystem: Spawned ${totalSpawned} skeletons.`);
    }

    addFeature(tileType, count, maxSize, minSize = 2) {
        if (!this.rooms || this.rooms.length === 0) return;

        for (let i = 0; i < count; i++) {
            const room = this.rooms[Math.floor(Math.random() * this.rooms.length)];
            if (room.isSpawn) continue;

            const size = Math.floor(Math.random() * maxSize) + minSize;
            if (room.w <= size + 2 || room.h <= size + 2) continue; // Ensure room is large enough

            const startX = room.x + 1 + Math.floor(Math.random() * (room.w - size - 1));
            const startY = room.y + 1 + Math.floor(Math.random() * (room.h - size - 1));

            for (let y = startY; y < startY + size; y++) {
                for (let x = startX; x < startX + size; x++) {
                    // Check bounds just in case
                    if (x < room.x + room.w -1 && y < room.y + room.h -1) {
                        if (Math.random() > 0.35) { // Jagged shape
                            this.grid[y][x] = tileType;
                        }
                    }
                }
            }
        }
    }

    findPath(startX, startY, endX, endY) {
        // Check if target is walkable to prevent infinite/exhaustion search on unreachable tiles
        if (!this.isWalkable(endX, endY)) return null;
        if (startX === endX && startY === endY) return [];

        // Simple A* Implementation
        const startNode = { x: startX, y: startY, g: 0, h: 0, f: 0, parent: null };
        const openList = [startNode];
        const closedList = new Set();
        const endKey = this.getKey(endX, endY);

        while (openList.length > 0) {
            // Optimization: Linear search for lowest F is O(N) vs Sort O(N log N)
            // For small open lists in grid pathfinding, this is significantly faster than sorting + shifting.
            let lowestIndex = 0;
            for (let i = 1; i < openList.length; i++) {
                if (openList[i].f < openList[lowestIndex].f) {
                    lowestIndex = i;
                }
            }
            const current = openList[lowestIndex];
            // Fast remove: swap with end and pop
            openList[lowestIndex] = openList[openList.length - 1];
            openList.pop();

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

    getStraightPath(x0, y0, x1, y1) {
        const path = [];
        let x = Math.round(x0);
        let y = Math.round(y0);
        const tx = Math.round(x1);
        const ty = Math.round(y1);

        const dx = Math.abs(tx - x);
        const dy = Math.abs(ty - y);
        const sx = (x < tx) ? 1 : -1;
        const sy = (y < ty) ? 1 : -1;
        let err = dx - dy;

        let iterations = 0;
        const maxIterations = 100; 

        while (true) {
            if (x === tx && y === ty) break;
            if (iterations++ > maxIterations) break;

            let e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x += sx; }
            if (e2 < dx) { err += dx; y += sy; }

            path.push({ x, y });
        }
        return path;
    }

    findNearestUnexplored(startX, startY, exploredSet) {
        const visited = new Set();
        const queue = [{x: Math.round(startX), y: Math.round(startY)}];
        
        let loops = 0;
        while(queue.length > 0 && loops < 2000) { // Safety limit
            loops++;
            const curr = queue.shift();
            const key = `${curr.x},${curr.y}`;
            
            if (visited.has(key)) continue;
            visited.add(key);

            // If this tile is NOT explored, it's our target
            if (!exploredSet.has(key) && this.isWalkable(curr.x, curr.y)) {
                return curr;
            }

            // Neighbors
            const dirs = [{x:0,y:1},{x:0,y:-1},{x:1,y:0},{x:-1,y:0}];
            for (const d of dirs) {
                const nx = curr.x + d.x;
                const ny = curr.y + d.y;
                if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
                    queue.push({x: nx, y: ny});
                }
            }
        }
        return null;
    }

    processLavaDamage(dt, combatSystem) {
        this.lavaTimer += dt;
        if (this.lavaTimer >= 1000) {
            this.lavaTimer = 0;
            for (const [id, pos] of this.entities) {
                if (this.grid[Math.round(pos.y)][Math.round(pos.x)] === 4) {
                    combatSystem.applyDamage(id, 20, null);
                }
            }
        }
    }

    getFacingFromVector(dx, dy) {
        if (dx === 0 && dy === 0) return {x:0, y:1};
        const angle = Math.atan2(dy, dx);
        const octant = Math.round(8 * angle / (2 * Math.PI) + 8) % 8;
        const dirs = [
            {x:1, y:0}, {x:1, y:1}, {x:0, y:1}, {x:-1, y:1},
            {x:-1, y:0}, {x:-1, y:-1}, {x:0, y:-1}, {x:1, y:-1}
        ];
        return dirs[octant];
    }

    attemptMoveWithSlide(entityId, dx, dy) {
        let result = this.moveEntity(entityId, dx, dy);
        
        if (!result.success && result.collision === 'wall') {
            if (dx !== 0 && dy !== 0) {
                const resX = this.moveEntity(entityId, dx, 0);
                if (resX.success) {
                    return resX;
                }
                const resY = this.moveEntity(entityId, 0, dy);
                if (resY.success) {
                    return resY;
                }
            }
        }
        return result;
    }

    resolveMoveIntent(entityId, direction, lootSystem) {
        const pos = this.entities.get(entityId);
        if (!pos) return { type: 'NONE' };

        const tx = pos.x + direction.x;
        const ty = pos.y + direction.y;

        // 1. Check Loot Collision (Chests)
        if (lootSystem.isCollidable(tx, ty)) {
            const items = lootSystem.getItemsAt(tx, ty);
            const chest = items.find(l => l.type === 'chest' && !l.opened);
            if (chest) {
                return { type: 'INTERACT_LOOT', loot: chest, facing: direction };
            }
            return { type: 'BLOCKED_BY_LOOT', facing: direction };
        }

        // 2. Attempt Move
        const result = this.attemptMoveWithSlide(entityId, direction.x, direction.y);
        
        if (result.success) {
            return { type: 'MOVED', x: result.x, y: result.y };
        } else if (result.collision === 'wall') {
            return { type: 'BUMP_WALL', direction };
        } else if (result.collision) {
            return { type: 'BUMP_ENTITY', targetId: result.collision, direction };
        }

        return { type: 'NONE' };
    }

    determineClickIntent(gridX, gridY, myId, combatSystem, lootSystem, isContinuous, shift) {
        const pos = this.entities.get(myId);
        if (!pos) return null;

        let targetId = this.getEntityAt(gridX, gridY);
        const loot = lootSystem.getLootAt(gridX, gridY);

        if (isContinuous) {
            const bestId = combatSystem.findBestTarget(this, myId, gridX, gridY, 3);
            if (bestId) targetId = bestId;
        }

        const isHostile = targetId && targetId !== myId;

        if (isHostile && !shift) {
            const equip = lootSystem.getEquipment(myId);
            const weaponId = equip.weapon;
            const config = weaponId ? lootSystem.getItemConfig(weaponId) : null;
            const isRanged = config && config.range > 1;

            if (!isRanged) {
                const dist = Math.max(Math.abs(gridX - pos.x), Math.abs(gridY - pos.y));
                if (dist > 1) {
                    const path = this.findPathToAdjacent(pos.x, pos.y, gridX, gridY);
                    if (path) return { type: 'CHASE', path, targetId };
                    return null;
                }
            }
        }

        if (shift || isHostile) return { type: 'ATTACK_TARGET', x: gridX, y: gridY };

        if (loot) {
            const path = this.findPathToAdjacent(pos.x, pos.y, gridX, gridY);
            if (path) return { type: 'MOVE_PATH', path };
        }

        let path = this.findPath(pos.x, pos.y, gridX, gridY);
        if (!path) path = this.getStraightPath(pos.x, pos.y, gridX, gridY);
        
        return path ? { type: 'MOVE_PATH', path } : { type: 'CLEAR_PATH' };
    }

    findPathToAdjacent(startX, startY, endX, endY) {
        const path = this.findPath(startX, startY, endX, endY);
        if (path && path.length > 0) {
            path.pop();
            return path;
        }
        return null;
    }
}