export default class AssetSystem {
    constructor() {
        /** @type {Object.<string, HTMLImageElement>} */
        this.images = {};
        /** @type {Object.<string, AudioBuffer>} */
        this.audio = {};
        /** @type {?AudioContext} */
        this.audioContext = null; // Lazy init
    }

    /**
     * Fetches and parses a JSON configuration file.
     * @param {string} path - The path to the JSON file.
     * @returns {Promise<Object>} A promise that resolves to the parsed JSON object, or an empty object on failure.
     */
    async loadConfig(path) {
        try {
            const response = await fetch(path);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (e) {
            console.error(`Failed to load config: ${path}`, e);
            return {};
        }
    }

    /**
     * Loads a map of images.
     * @param {Object.<string, string>} imageMap - An object where keys are asset names and values are image source paths.
     * @returns {Promise<void[]>} A promise that resolves when all images have either loaded or failed.
     */
    async loadImages(imageMap) {
        const promises = Object.entries(imageMap).map(([name, src]) => {
            return new Promise((resolve) => {
                const img = new Image();
                img.src = src;
                img.onload = () => {
                    this.images[name] = img;
                    resolve();
                };
                img.onerror = (e) => {
                    console.warn(`Failed to load image: ${src}`, e);
                    // Resolve anyway to prevent blocking the entire asset loading process.
                    // The RenderSystem is expected to handle missing images.
                    resolve();
                };
            });
        });
        return Promise.all(promises);
    }

    /**
     * Loads and decodes a map of audio files.
     * @param {Object.<string, string>} audioMap - An object where keys are asset names and values are audio source paths.
     * @returns {Promise<void[]>} A promise that resolves when all audio files have been processed.
     */
    async loadAudio(audioMap) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) {
            console.warn('Web Audio API is not supported in this browser.');
            return Promise.resolve();
        }
        
        if (!this.audioContext) {
            try {
                this.audioContext = new AudioCtor();
            } catch (e) {
                console.error("Could not create AudioContext:", e);
                return Promise.resolve();
            }
        }

        const promises = Object.entries(audioMap).map(([name, src]) => {
            return fetch(src)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return response.arrayBuffer();
                })
                .then(arrayBuffer => this.audioContext.decodeAudioData(arrayBuffer))
                .then(audioBuffer => {
                    this.audio[name] = audioBuffer;
                })
                .catch(e => {
                    console.warn(`Failed to load audio: ${src}`, e);
                    // Resolve promise even on failure to avoid blocking Promise.all
                });
        });
        return Promise.all(promises);
    }

    /**
     * Retrieves a loaded image by name.
     * @param {string} name - The name of the image asset.
     * @returns {?HTMLImageElement} The image element, or null if not found.
     */
    getImage(name) {
        return this.images[name] || null;
    }

    /**
     * Retrieves a loaded audio buffer by name.
     * @param {string} name - The name of the audio asset.
     * @returns {?AudioBuffer} The audio buffer, or null if not found.
     */
    getAudio(name) {
        return this.audio[name] || null;
    }

    /**
     * Loads all core JSON configuration files.
     * @returns {Promise<Object>} A promise that resolves to an object containing all loaded configs.
     */
    async loadAll() {
        const configFiles = {
            global: './scripts/global.json',
            items: './scripts/items.json',
            enemies: './scripts/enemies.json',
        };

        const promises = Object.entries(configFiles).map(([name, path]) => {
            return this.loadConfig(path).then(data => ({ [name]: data }));
        });

        const configs = await Promise.all(promises);
        return configs.reduce((acc, curr) => ({ ...acc, ...curr }), {});
    }
}