export default class AssetLoader {
    constructor() {
        this.images = {};
        this.audio = {};
    }

    async loadConfig(path) {
        try {
            const response = await fetch(path);
            return await response.json();
        } catch (e) {
            console.error(`Failed to load config: ${path}`, e);
            return {};
        }
    }

    // For the early revision, we will generate placeholder graphics if files are missing
    // to ensure the game is playable immediately.
    async loadImages(imageLists) {
        const promises = [];
        for (const [name, src] of Object.entries(imageLists)) {
            promises.push(new Promise((resolve) => {
                const img = new Image();
                img.src = src;
                img.onload = () => {
                    this.images[name] = img;
                    resolve();
                };
                img.onerror = (e) => {
                    console.warn(`Failed to load image: ${src}`, e);
                    resolve(); // Resolve anyway to prevent blocking
                };
            }));
        }
        return Promise.all(promises);
    }

    getImage(name) {
        return this.images[name] || null; // RenderSystem handles null by drawing a colored rect
    }

    async loadAll() {
        const global = await this.loadConfig('./config/global.json');
        const items = await this.loadConfig('./config/items.json');
        const enemies = await this.loadConfig('./config/enemies.json');
        const net = await this.loadConfig('./config/networking.json');
        
        return { global, items, enemies, net };
    }
}