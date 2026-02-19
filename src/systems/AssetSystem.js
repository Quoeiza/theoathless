export default class AssetSystem {
    constructor() {
        this.images = {};
        this.audio = {};
        this.audioContext = null; // Lazy init
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

    async loadAudio(audioLists) {
        const promises = [];
        // We need a context to decode, but we don't want to start the main AudioContext yet.
        // We use a temporary one or check for window.
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return Promise.resolve();
        
        if (!this.audioContext) this.audioContext = new AudioCtor();

        for (const [name, src] of Object.entries(audioLists)) {
            promises.push(fetch(src)
                .then(response => response.arrayBuffer())
                .then(arrayBuffer => this.audioContext.decodeAudioData(arrayBuffer))
                .then(audioBuffer => {
                    this.audio[name] = audioBuffer;
                })
                .catch(e => console.warn(`Failed to load audio: ${src}`, e))
            );
        }
        return Promise.all(promises);
    }

    getImage(name) {
        return this.images[name] || null; // RenderSystem handles null by drawing a colored rect
    }

    getAudio(name) {
        return this.audio[name] || null;
    }

    async loadAll() {
        const global = await this.loadConfig('./src/config/global.json');
        const items = await this.loadConfig('./src/config/items.json');
        const enemies = await this.loadConfig('./src/config/enemies.json');
        const net = await this.loadConfig('./src/config/networking.json');
        
        return { global, items, enemies, net };
    }
}