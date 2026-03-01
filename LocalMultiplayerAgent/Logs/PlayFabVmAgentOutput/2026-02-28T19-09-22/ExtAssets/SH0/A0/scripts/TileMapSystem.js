/**
 * @file TileMapSystem.js
 * Manages rendering using 2.5D Depth Logic.
 * Handles Wall Faces, Wall Bases, and Roof/Void Overlays.
 */

export const dungeonTilesetConfig = {
    name: 'Dungeon',
    tileSize: 48,
    sheetWidth: 33, 
    floorSheetWidth: 38,
    liquidsSheetWidth: 36, 
    assets: {
        floor: './assets/images/dungeon/A2_Terrain_Misc.png',
        wall: './assets/images/dungeon/A4_Walls_And_Edges.png',
        liquids: './assets/images/dungeon/A1_Liquids_Misc_darker.png',
    },
    themes: {
        'rocky': 0,
        'dark': 17,
        'mossy': 165,
        'volcanic': 1832,
        'test': 347
    },
    floorThemes: {
        'rocky': 0,
        'dark': 13,
        'volcanic': 26,
        'mossy': 190,
        'floor_4': 203,
        'floor_5': 216,
        'floor_6': 380,
        'floor_7': 393,
        'floor_8': 406,
        'floor_9': 570,
        'floor_10': 583,
        'floor_11': 596,
        'floor_12': 760,
        'floor_13': 773,
        'floor_14': 786,
        'floor_15': 950,
        'floor_16': 963,
        'floor_17': 976,
        'floor_18': 1140,
        'floor_19': 1153,
        'floor_20': 1166,
        'floor_21': 1330,
        'floor_22': 1343,
        'floor_23': 1356,
        'floor_24': 1520,
        'floor_25': 1533,
        'floor_26': 1546,
        'floor_27': 1710,
        'floor_28': 1723,
        'floor_29': 1736,
        'floor_30': 1900,
        'floor_31': 1913,
        'floor_32': 1926,
        'test': 1546
    },
    liquidThemes: {
        'water': 540,
        'lava': 180,
    },
    tiles: {
        floor: { sx: 0, sy: 0 }, 
    }
};

// --- TILED DATA ---
// VOID: Roofs/Ceilings (Black with Stone Rims)
const VOID_DATA = [
    { id: 4, w: [0, 0, 0, 0, 1, 0, 0, 0] },
    { id: 5, w: [0, 0, 1, 0, 1, 0, 0, 0] },
    { id: 6, w: [0, 0, 1, 0, 1, 0, 1, 0] },
    { id: 7, w: [0, 0, 0, 0, 1, 0, 1, 0] },
    { id: 8, w: [1, 0, 1, 0, 1, 0, 1, 1] },
    { id: 9, w: [0, 0, 1, 1, 1, 0, 1, 0] },
    { id: 10, w: [0, 0, 1, 0, 1, 1, 1, 0] },
    { id: 11, w: [1, 1, 1, 0, 1, 0, 1, 0] },
    { id: 12, w: [0, 0, 1, 1, 1, 0, 0, 0] },
    { id: 13, w: [1, 0, 1, 1, 1, 1, 1, 0] },
    { id: 14, w: [0, 0, 1, 1, 1, 1, 1, 0] },
    { id: 15, w: [0, 0, 0, 0, 1, 1, 1, 0] },
    { id: 37, w: [1, 0, 0, 0, 1, 0, 0, 0] },
    { id: 38, w: [1, 0, 1, 0, 1, 0, 0, 0] },
    { id: 39, w: [1, 0, 1, 0, 1, 0, 1, 0] },
    { id: 40, w: [1, 0, 0, 0, 1, 0, 1, 0] },
    { id: 41, w: [1, 0, 1, 1, 1, 0, 0, 0] },
    { id: 42, w: [1, 1, 1, 1, 1, 1, 1, 0] },
    { id: 43, w: [1, 0, 1, 1, 1, 1, 1, 1] },
    { id: 44, w: [1, 0, 0, 0, 1, 1, 1, 0] },
    { id: 45, w: [1, 1, 1, 1, 1, 0, 0, 0] },
    { id: 46, w: [1, 1, 1, 0, 1, 1, 1, 0] },
    { id: 48, w: [1, 0, 1, 0, 1, 1, 1, 1] },
    { id: 70, w: [1, 0, 0, 0, 0, 0, 0, 0] },
    { id: 71, w: [1, 0, 1, 0, 0, 0, 0, 0] },
    { id: 72, w: [1, 0, 1, 0, 0, 0, 1, 0] },
    { id: 73, w: [1, 0, 0, 0, 0, 0, 1, 0] },
    { id: 74, w: [1, 1, 1, 0, 1, 0, 0, 0] },
    { id: 75, w: [1, 1, 1, 1, 1, 0, 1, 1] },
    { id: 76, w: [1, 1, 1, 0, 1, 1, 1, 1] },
    { id: 77, w: [1, 0, 0, 0, 1, 0, 1, 1] },
    { id: 78, w: [1, 1, 1, 1, 1, 0, 1, 0] },
    { id: 79, w: [1, 1, 1, 1, 1, 1, 1, 1] },
    { id: 80, w: [1, 0, 1, 1, 1, 0, 1, 1] },
    { id: 81, w: [1, 0, 0, 0, 1, 1, 1, 1] },
    { id: 103, w: [0, 0, 0, 0, 0, 0, 0, 0] },
    { id: 104, w: [0, 0, 1, 0, 0, 0, 0, 0] },
    { id: 105, w: [0, 0, 1, 0, 0, 0, 1, 0] },
    { id: 106, w: [0, 0, 0, 0, 0, 0, 1, 0] },
    { id: 107, w: [1, 0, 1, 0, 1, 1, 1, 0] },
    { id: 108, w: [1, 1, 1, 0, 0, 0, 1, 0] },
    { id: 109, w: [1, 0, 1, 0, 0, 0, 1, 1] },
    { id: 110, w: [1, 0, 1, 1, 1, 0, 1, 0] },
    { id: 111, w: [1, 1, 1, 0, 0, 0, 0, 0] },
    { id: 112, w: [1, 1, 1, 0, 0, 0, 1, 1] },
    { id: 113, w: [1, 1, 1, 0, 1, 0, 1, 1] },
    { id: 114, w: [1, 0, 0, 0, 0, 0, 1, 1] }
];

// WALL: Vertical Stone Faces / Pillars
const WALL_DATA = [
    { id: 0, w: [0, 0, 1, 1, 1, 0, 0, 0] },
    { id: 1, w: [0, 0, 1, 1, 1, 1, 1, 0] },
    { id: 2, w: [0, 0, 0, 0, 1, 1, 1, 0] },
    { id: 33, w: [1, 1, 1, 1, 1, 0, 0, 0] },
    { id: 34, w: [1, 1, 1, 1, 1, 1, 1, 1] },
    { id: 35, w: [1, 0, 0, 0, 1, 1, 1, 1] },
    { id: 66, w: [1, 1, 1, 0, 0, 0, 0, 0] },
    { id: 67, w: [1, 1, 1, 0, 0, 0, 1, 1] },
    { id: 68, w: [1, 0, 0, 0, 0, 0, 1, 1] }
];

// FLOOR: Terrain / Ground
const FLOOR_DATA = [
    { id: 0, w: [0, 0, 0, 0, 1, 0, 0, 0] },
    { id: 1, w: [0, 0, 1, 0, 1, 0, 0, 0] },
    { id: 2, w: [0, 0, 1, 0, 1, 0, 1, 0] },
    { id: 3, w: [0, 0, 0, 0, 1, 0, 1, 0] },
    { id: 4, w: [1, 0, 1, 0, 1, 0, 1, 1] },
    { id: 5, w: [0, 0, 1, 1, 1, 0, 1, 0] },
    { id: 6, w: [0, 0, 1, 0, 1, 1, 1, 0] },
    { id: 7, w: [1, 1, 1, 0, 1, 0, 1, 0] },
    { id: 8, w: [0, 0, 1, 1, 1, 0, 0, 0] },
    { id: 9, w: [1, 0, 1, 1, 1, 1, 1, 0] },
    { id: 10, w: [0, 0, 1, 1, 1, 1, 1, 0] },
    { id: 11, w: [0, 0, 0, 0, 1, 1, 1, 0] },
    { id: 38, w: [1, 0, 0, 0, 1, 0, 0, 0] },
    { id: 39, w: [1, 0, 1, 0, 1, 0, 0, 0] },
    { id: 40, w: [1, 0, 1, 0, 1, 0, 1, 0] },
    { id: 41, w: [1, 0, 0, 0, 1, 0, 1, 0] },
    { id: 42, w: [1, 0, 1, 1, 1, 0, 0, 0] },
    { id: 43, w: [1, 1, 1, 1, 1, 1, 1, 0] },
    { id: 44, w: [1, 0, 1, 1, 1, 1, 1, 1] },
    { id: 45, w: [1, 0, 0, 0, 1, 1, 1, 0] },
    { id: 46, w: [1, 1, 1, 1, 1, 0, 0, 0] },
    { id: 47, w: [1, 1, 1, 0, 1, 1, 1, 0] },
    { id: 49, w: [1, 0, 1, 0, 1, 1, 1, 1] },
    { id: 76, w: [1, 0, 0, 0, 0, 0, 0, 0] },
    { id: 77, w: [1, 0, 1, 0, 0, 0, 0, 0] },
    { id: 78, w: [1, 0, 1, 0, 0, 0, 1, 0] },
    { id: 79, w: [1, 0, 0, 0, 0, 0, 1, 0] },
    { id: 80, w: [1, 1, 1, 0, 1, 0, 0, 0] },
    { id: 81, w: [1, 1, 1, 1, 1, 0, 1, 1] },
    { id: 82, w: [1, 1, 1, 0, 1, 1, 1, 1] },
    { id: 83, w: [1, 0, 0, 0, 1, 0, 1, 1] },
    { id: 84, w: [1, 1, 1, 1, 1, 0, 1, 0] },
    { id: 85, w: [1, 1, 1, 1, 1, 1, 1, 1] },
    { id: 86, w: [1, 0, 1, 1, 1, 0, 1, 1] },
    { id: 87, w: [1, 0, 0, 0, 1, 1, 1, 1] },
    { id: 114, w: [0, 0, 0, 0, 0, 0, 0, 0] },
    { id: 115, w: [0, 0, 1, 0, 0, 0, 0, 0] },
    { id: 116, w: [0, 0, 1, 0, 0, 0, 1, 0] },
    { id: 117, w: [0, 0, 0, 0, 0, 0, 1, 0] },
    { id: 118, w: [1, 0, 1, 0, 1, 1, 1, 0] },
    { id: 119, w: [1, 1, 1, 0, 0, 0, 1, 0] },
    { id: 120, w: [1, 0, 1, 0, 0, 0, 1, 1] },
    { id: 121, w: [1, 0, 1, 1, 1, 0, 1, 0] },
    { id: 122, w: [1, 1, 1, 0, 0, 0, 0, 0] },
    { id: 123, w: [1, 1, 1, 0, 0, 0, 1, 1] },
    { id: 124, w: [1, 1, 1, 0, 1, 0, 1, 1] },
    { id: 119, w: [1, 0, 0, 0, 0, 0, 1, 1] }
];

// LIQUIDS: Water / Lava / etc.
const LIQUIDS_DATA = [
    { id: 0, w: [0, 0, 0, 0, 1, 0, 0, 0] },
    { id: 1, w: [0, 0, 1, 0, 1, 0, 0, 0] },
    { id: 2, w: [0, 0, 1, 0, 1, 0, 1, 0] },
    { id: 3, w: [0, 0, 0, 0, 1, 0, 1, 0] },
    { id: 4, w: [1, 0, 1, 0, 1, 0, 1, 1] },
    { id: 5, w: [0, 0, 1, 1, 1, 0, 1, 0] },
    { id: 6, w: [0, 0, 1, 0, 1, 1, 1, 0] },
    { id: 7, w: [1, 1, 1, 0, 1, 0, 1, 0] },
    { id: 8, w: [0, 0, 1, 1, 1, 0, 0, 0] },
    { id: 9, w: [1, 0, 1, 1, 1, 1, 1, 0] },
    { id: 10, w: [0, 0, 1, 1, 1, 1, 1, 0] },
    { id: 11, w: [0, 0, 0, 0, 1, 1, 1, 0] },
    { id: 36, w: [1, 0, 0, 0, 1, 0, 0, 0] },
    { id: 37, w: [1, 0, 1, 0, 1, 0, 0, 0] },
    { id: 38, w: [1, 0, 1, 0, 1, 0, 1, 0] },
    { id: 39, w: [1, 0, 0, 0, 1, 0, 1, 0] },
    { id: 40, w: [1, 0, 1, 1, 1, 0, 0, 0] },
    { id: 41, w: [1, 1, 1, 1, 1, 1, 1, 0] },
    { id: 42, w: [1, 0, 1, 1, 1, 1, 1, 1] },
    { id: 43, w: [1, 0, 0, 0, 1, 1, 1, 0] },
    { id: 44, w: [1, 1, 1, 1, 1, 0, 0, 0] },
    { id: 45, w: [1, 1, 1, 0, 1, 1, 1, 0] },
    { id: 49, w: [1, 0, 1, 0, 1, 1, 1, 1] },
    { id: 72, w: [1, 0, 0, 0, 0, 0, 0, 0] },
    { id: 73, w: [1, 0, 1, 0, 0, 0, 0, 0] },
    { id: 74, w: [1, 0, 1, 0, 0, 0, 1, 0] },
    { id: 75, w: [1, 0, 0, 0, 0, 0, 1, 0] },
    { id: 76, w: [1, 1, 1, 0, 1, 0, 0, 0] },
    { id: 77, w: [1, 1, 1, 1, 1, 0, 1, 1] },
    { id: 78, w: [1, 1, 1, 0, 1, 1, 1, 1] },
    { id: 79, w: [1, 0, 0, 0, 1, 0, 1, 1] },
    { id: 80, w: [1, 1, 1, 1, 1, 0, 1, 0] },
    { id: 81, w: [1, 1, 1, 1, 1, 1, 1, 1] },
    { id: 82, w: [1, 0, 1, 1, 1, 0, 1, 1] },
    { id: 83, w: [1, 0, 0, 0, 1, 1, 1, 1] },
    { id: 108, w: [0, 0, 0, 0, 0, 0, 0, 0] },
    { id: 109, w: [0, 0, 1, 0, 0, 0, 0, 0] },
    { id: 110, w: [0, 0, 1, 0, 0, 0, 1, 0] },
    { id: 111, w: [0, 0, 0, 0, 0, 0, 1, 0] },
    { id: 112, w: [1, 0, 1, 0, 1, 1, 1, 0] },
    { id: 113, w: [1, 1, 1, 0, 0, 0, 1, 0] },
    { id: 114, w: [1, 0, 1, 0, 0, 0, 1, 1] },
    { id: 115, w: [1, 0, 1, 1, 1, 0, 1, 0] },
    { id: 116, w: [1, 1, 1, 0, 0, 0, 0, 0] },
    { id: 117, w: [1, 1, 1, 0, 0, 0, 1, 1] },
    { id: 118, w: [1, 1, 1, 0, 1, 0, 1, 1] },
    { id: 119, w: [1, 0, 0, 0, 0, 0, 1, 1] }
];

export class TileMapSystem {
    constructor(config = dungeonTilesetConfig) {
        this.config = config;
        this.tileSize = config.tileSize;
        this.assets = {}; 
        this.currentTheme = 'test';
        
        this.voidMap = this.buildLookup(VOID_DATA);
        this.wallMap = this.buildLookup(WALL_DATA);
        this.floorMap = this.buildLookup(FLOOR_DATA);
        this.liquidsMap = this.buildLookup(LIQUIDS_DATA);
    }

    buildLookup(data) {
        const map = new Map();
        data.forEach(item => {
            const key = item.w.join(',');
            map.set(key, item.id);
        });
        return map;
    }

    async loadAssets(assetLoader) {
        const imageMap = {
            [this.config.name + '_floor']: this.config.assets.floor,
            [this.config.name + '_wall']: this.config.assets.wall,
            [this.config.name + '_liquids']: this.config.assets.liquids,
        };
        await assetLoader.loadImages(imageMap);
        this.assets.floor = assetLoader.getImage(this.config.name + '_floor');
        this.assets.wall = assetLoader.getImage(this.config.name + '_wall');
        this.assets.liquids = assetLoader.getImage(this.config.name + '_liquids');
    }

    // Helper: 1 = Wall/Torch, 2 = Liquid, 0 = Floor
    getTileVal(map, x, y) {
        if (y < 0 || y >= map.length || x < 0 || x >= map[0].length) return 1;
        const v = map[y][x];
        if (v === 1 || v === 5) return 1; // Wall or Torch
        if (v === 2) return 2; // Liquid
        return 0; // Floor
    }

    // LOGIC: Is this a vertical face visible to the player?
    // It's a face if:
    // 1. It is a WALL
    // 2. AND there is a Floor tile somewhere directly below it in the column
    isFrontFace(map, x, y) {
        if (this.getTileVal(map, x, y) !== 1) return false;
        
        // Scan downwards for floor, with a limit to prevent infinite walls
        // This ensures deep walls eventually become roofs.
        const limit = 2;
        for (let dy = 1; dy <= limit; dy++) {
            if (y + dy >= map.length) break;
            const val = this.getTileVal(map, x, y + dy);
            if (val === 0) return true; // Found floor base
            if (val !== 1) return false; // Obstructed by something else
        }
        return false;
    }

    getWallTileID(map, x, y) {
        const w = this.getTileVal(map, x - 1, y);
        const e = this.getTileVal(map, x + 1, y);
        let colID = 1; // Default Center
        if (w === 0 && e === 1) colID = 0;      // Left
        else if (w === 1 && e === 1) colID = 1; // Center
        else if (w === 1 && e === 0) colID = 2; // Right

        const below = this.getTileVal(map, x, y + 1);

        if (below === 0) return 66 + colID;      // Bottom
        
        // If the tile above is NOT a front face (it's a roof or floor), then THIS is the Top.
        if (!this.isFrontFace(map, x, y - 1)) return 0 + colID; // Top
        
        return 33 + colID;                       // Middle
    }

    // LOGIC: Should we draw a Void/Roof tile here?
    // We draw Void if:
    // 1. It is a "Deep Wall" (Wall behind the face)
    // 2. OR It is a Floor tile directly above a Front Face (Roof Overlay)
    shouldDrawVoid(map, x, y) {
        const val = this.getTileVal(map, x, y);
        
        // Case 1: Deep Wall
        if (val === 1 && !this.isFrontFace(map, x, y)) return true;

        // Case 2: Roof Overlay (The empty tile above a wall needs a rim)
        if (val === 0 && this.isFrontFace(map, x, y + 1)) return true;

        return false;
    }

    /**
     * Calculates neighbors based on the context.
     * @param mode 'VOID', 'FACE', 'FLOOR', or 'LIQUID'
     */
    getWangID(map, x, y, mode) {
        const check = (dx, dy) => {
            const nx = x + dx;
            const ny = y + dy;
            
            if (mode === 'VOID') {
                // Voids connect to other Voids. 
                // Everything else (Face or Floor) is a boundary (0).
                return this.shouldDrawVoid(map, nx, ny) ? 1 : 0;
            } else if (mode === 'FLOOR') {
                // Floors (0) connect to Floors (0).
                // Walls (1) are boundaries (0).
                // Connect to Liquids (2) as well so floor continues under water
                const v = this.getTileVal(map, nx, ny);
                return (v === 0 || v === 2) ? 1 : 0;
            } else if (mode === 'LIQUID') {
                // Liquids (2) connect to other Liquids (2).
                return this.getTileVal(map, nx, ny) === 2 ? 1 : 0;
            } else {
                // Faces connect to any solid Wall.
                // This keeps the pillar structure solid.
                return this.getTileVal(map, nx, ny) === 1 ? 1 : 0;
            }
        };

        return [
            check(0, -1),  // N
            check(1, -1),  // NE
            check(1, 0),   // E
            check(1, 1),   // SE
            check(0, 1),   // S
            check(-1, 1),  // SW
            check(-1, 0),  // W
            check(-1, -1)  // NW
        ];
    }

    canonicalizeWang(w) {
        // 0:N, 1:NE, 2:E, 3:SE, 4:S, 5:SW, 6:W, 7:NW
        if (w[0] === 0 || w[2] === 0) w[1] = 0;
        if (w[2] === 0 || w[4] === 0) w[3] = 0;
        if (w[4] === 0 || w[6] === 0) w[5] = 0;
        if (w[6] === 0 || w[0] === 0) w[7] = 0;
    }

    drawFloor(ctx, map, viewBounds) {
        if (!this.assets.floor) return;
        const ts = this.tileSize;
        const sheetW = this.config.floorSheetWidth || 38;
        const themeOffset = (this.config.floorThemes && this.config.floorThemes[this.currentTheme]) !== undefined 
            ? this.config.floorThemes[this.currentTheme] 
            : 0;
        const { startCol, endCol, startRow, endRow } = viewBounds;

        for (let y = startRow; y <= endRow; y++) {
            for (let x = startCol; x <= endCol; x++) {
                if (y < 0 || y >= map.length || x < 0 || x >= map[0].length) continue;
                
                let tileID = 85; // Default Center Floor

                // If it is a Floor tile (0) or Liquid (2), calculate Wang ID
                const val = this.getTileVal(map, x, y);
                if (val === 0 || val === 2) {
                    const wangID = this.getWangID(map, x, y, 'FLOOR');
                    this.canonicalizeWang(wangID);
                    const key = wangID.join(',');
                    if (this.floorMap.has(key)) {
                        tileID = this.floorMap.get(key);
                    }
                }

                const finalID = tileID + themeOffset;
                const sheetX = (finalID % sheetW) * ts;
                const sheetY = Math.floor(finalID / sheetW) * ts;
                
                ctx.drawImage(this.assets.floor, sheetX, sheetY, ts, ts, x * ts, y * ts, ts, ts);
            }
        }
    }

    drawLiquids(ctx, map, viewBounds, timestamp = 0) {
        if (!this.assets.liquids) return;
        const ts = this.tileSize;
        const sheetW = this.config.liquidsSheetWidth || 36;
        // Simple theme for now, can be expanded
        const themeRoot = (this.config.liquidThemes && this.config.liquidThemes['water']) || 0;
        const { startCol, endCol, startRow, endRow } = viewBounds;

        let animOffset = 0;

        // 3. Exceptions
        if (themeRoot === 180 || themeRoot === 193) {
            animOffset = 0; // Static sets
        } 
        // 2B. Waterfalls (Vertical Forward Loop)
        else if (themeRoot >= 1620) {
            // Loop Type: Forward (0 -> 1 -> 2 -> 0)
            // Timing: 0.5s cycle (Double speed) -> ~166ms per frame
            const frame = Math.floor(timestamp / 166) % 3;
            // Frame Offsets: +0, +36, +72
            animOffset = frame * 36;
        } 
        // 2A. Standard Liquids (Horizontal Ping-Pong)
        else {
            // Loop Type: Ping-Pong (0 -> 1 -> 2 -> 1 -> 0)
            // Timing: 1.0s cycle -> 250ms per frame
            const cycle = Math.floor(timestamp / 250) % 4; // 0, 1, 2, 3
            const frame = cycle === 3 ? 1 : cycle; // Map 3 to 1
            // Frame Offsets: +0, +12, +24
            animOffset = frame * 12;
        }

        for (let y = startRow; y <= endRow; y++) {
            for (let x = startCol; x <= endCol; x++) {
                if (y < 0 || y >= map.length || x < 0 || x >= map[0].length) continue;
                
                // If it is a Liquid tile (2), calculate Wang ID
                if (this.getTileVal(map, x, y) === 2) {
                    let localWangID = 85; // Default Center
                    const wangID = this.getWangID(map, x, y, 'LIQUID');
                    this.canonicalizeWang(wangID);
                    const key = wangID.join(',');
                    if (this.liquidsMap.has(key)) {
                        localWangID = this.liquidsMap.get(key);
                    }

                    // 1. Global ID Calculation
                    const finalID = themeRoot + localWangID + animOffset;
                    const sheetX = (finalID % sheetW) * ts;
                    const sheetY = Math.floor(finalID / sheetW) * ts;
                    
                    ctx.drawImage(this.assets.liquids, sheetX, sheetY, ts, ts, x * ts, y * ts, ts, ts);
                }
            }
        }
    }

    drawWalls(ctx, map, viewBounds) {
        if (!this.assets.wall) return;
        const ts = this.tileSize;
        const halfTs = ts * 0.5;
        const sheetW = this.config.sheetWidth;
        const themeOffset = this.config.themes[this.currentTheme] || 0;
        const { startCol, endCol, startRow, endRow } = viewBounds;

        for (let y = startRow; y <= endRow; y++) {
            for (let x = startCol; x <= endCol; x++) {
                if (y < 0 || y >= map.length || x < 0 || x >= map[0].length) continue;

                if (this.isFrontFace(map, x, y)) {
                    // --- DRAW FRONT FACE ---
                    // This is the vertical stone wall.
                    const tileID = this.getWallTileID(map, x, y);
                    
                    const finalID = tileID + themeOffset;
                    const sheetX = (finalID % sheetW) * ts;
                    const sheetY = Math.floor(finalID / sheetW) * ts;

                    // Special handling for Top Walls (0, 1, 2)
                    // Draw the BOTTOM HALF in the background layer so entities can walk "in front" of it
                    if (tileID >= 0 && tileID <= 2) {
                        ctx.drawImage(this.assets.wall, 
                            sheetX, sheetY + halfTs, ts, halfTs, 
                            x * ts, (y * ts) + halfTs, ts, halfTs);
                        continue;
                    }

                    ctx.drawImage(this.assets.wall, sheetX, sheetY, ts, ts, x * ts, y * ts, ts, ts);
                } 
            }
        }
    }

    drawRoof(ctx, map, viewBounds) {
        if (!this.assets.wall) return;
        const ts = this.tileSize;
        const halfTs = ts * 0.5;
        const sheetW = this.config.sheetWidth;
        const themeOffset = this.config.themes[this.currentTheme] || 0;
        const { startCol, endCol, startRow, endRow } = viewBounds;

        for (let y = startRow; y <= endRow; y++) {
            for (let x = startCol; x <= endCol; x++) {
                if (y < 0 || y >= map.length || x < 0 || x >= map[0].length) continue;

                if (this.shouldDrawVoid(map, x, y)) {
                    // --- DRAW VOID / ROOF ---
                    // This is the black ceiling or the edge rim.
                    const wangID = this.getWangID(map, x, y, 'VOID');
                    this.canonicalizeWang(wangID);
                    const key = wangID.join(',');

                    const tileID = this.voidMap.has(key) ? this.voidMap.get(key) : 79;

                    const finalID = tileID + themeOffset;
                    const sheetX = (finalID % sheetW) * ts;
                    const sheetY = Math.floor(finalID / sheetW) * ts;

                    ctx.drawImage(this.assets.wall, sheetX, sheetY, ts, ts, x * ts, y * ts, ts, ts);
                }

                // --- DRAW TOP WALLS (Layer Above) ---
                if (this.isFrontFace(map, x, y)) {
                    const tileID = this.getWallTileID(map, x, y);

                    if (tileID >= 0 && tileID <= 2) {
                        const finalID = tileID + themeOffset;
                        const sheetX = (finalID % sheetW) * ts;
                        const sheetY = Math.floor(finalID / sheetW) * ts;
                        
                        // Draw ONLY the TOP HALF in the foreground layer
                        ctx.drawImage(this.assets.wall, 
                            sheetX, sheetY, ts, halfTs, 
                            x * ts, y * ts, ts, halfTs);
                    }
                }
            }
        }
    }
}