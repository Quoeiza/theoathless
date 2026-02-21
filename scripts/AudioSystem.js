/**
 * Manages all audio for the game, including music, sound effects, spatial audio, and procedural audio generation.
 */
export default class AudioSystem {
    constructor() {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (AudioCtor) {
            try {
                this.ctx = new AudioCtor();
                this.enabled = true;
                
                // Master Gain for global volume control
                this.masterGain = this.ctx.createGain();
                this.masterGain.gain.value = 0.4; // Default to 40% to prevent clipping
                this.masterGain.connect(this.ctx.destination);

                /** @type {Object.<string, AudioBuffer>} */
                this.buffers = {};
                /** @type {?import('./AssetSystem.js').default} */
                this.assetLoader = null;
                this.listenerPos = null;
                /** @type {?AudioBufferSourceNode} */
                this.musicSource = null;

                this.generateGrimdarkAssets();
            } catch (e) {
                console.error("Failed to create AudioContext:", e);
                this.enabled = false;
            }
        } else {
            console.warn("AudioContext not supported");
            this.enabled = false;
        }
    }

    /**
     * Sets the asset loader instance and loads initial audio assets.
     * @param {import('./AssetSystem.js').default} loader - The asset loader instance.
     * @returns {Promise<void[]>}
     */
    setAssetLoader(loader) {
        this.assetLoader = loader;
        return this.assetLoader.loadAudio({
            'sword1': './assets/audio/weapon/sword1.mp3',
            'sword2': './assets/audio/weapon/sword2.mp3',
            'sword3': './assets/audio/weapon/sword3.mp3',
            'sword4': './assets/audio/weapon/sword4.mp3',
            'sword5': './assets/audio/weapon/sword5.mp3',
            'swing1': './assets/audio/weapon/swing1.mp3',
            'swing2': './assets/audio/weapon/swing2.mp3',
            'theme': './assets/audio/music/theme.mp3'
        });
    }

    /**
     * Resumes the audio context if it is suspended.
     */
    resume() {
        if (this.enabled && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(e => console.error("AudioContext resume failed:", e));
        }
    }

    /**
     * Unlocks the audio context, typically after a user interaction.
     */
    unlock() {
        if (!this.enabled) return;
        this.resume();
        // Play a silent buffer to force the audio subsystem to unlock on some browsers (e.g., mobile).
        const buffer = this.ctx.createBuffer(1, 1, 22050);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.ctx.destination);
        source.start(0);
    }

    /**
     * Generates procedural audio assets and stores them in the buffers cache.
     * @private
     */
    async generateGrimdarkAssets() {
        if (!this.enabled) return;
        
        // Impact Sound (Used for Attack and Hit)
        this.buffers['hit'] = await this.renderProceduralSound(0.4, (ctx) => {
            // Low-frequency thud
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(120, 0);
            osc.frequency.exponentialRampToValueAtTime(30, 0.2);
            
            const oscGain = ctx.createGain();
            oscGain.gain.setValueAtTime(1, 0);
            oscGain.gain.exponentialRampToValueAtTime(0.01, 0.3);
            osc.connect(oscGain);
            oscGain.connect(ctx.destination);

            // White noise with a low-pass filter for a "squelch" effect
            const noise = ctx.createBufferSource();
            const nBuf = ctx.createBuffer(1, ctx.length, ctx.sampleRate);
            const data = nBuf.getChannelData(0);
            for (let i = 0; i < ctx.length; i++) data[i] = Math.random() * 2 - 1;
            noise.buffer = nBuf;

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(1200, 0);
            filter.frequency.linearRampToValueAtTime(200, 0.2);

            const nGain = ctx.createGain();
            nGain.gain.setValueAtTime(0.8, 0);
            nGain.gain.exponentialRampToValueAtTime(0.01, 0.25);

            noise.connect(filter);
            filter.connect(nGain);
            nGain.connect(ctx.destination);

            osc.start();
            noise.start();
        });

        // Footstep sound
        this.buffers['step'] = await this.renderProceduralSound(0.1, (ctx) => {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(50, 0);
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.05, 0);
            gain.gain.exponentialRampToValueAtTime(0.01, 0.05);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
        });

        // Item pickup chime
        this.buffers['pickup'] = await this.renderProceduralSound(0.5, (ctx) => {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, 0);
            osc.frequency.exponentialRampToValueAtTime(1200, 0.1);
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.3, 0);
            gain.gain.exponentialRampToValueAtTime(0.01, 0.5);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
        });

        // Wall bump thud
        this.buffers['bump'] = await this.renderProceduralSound(0.1, (ctx) => {
            const osc = ctx.createOscillator();
            osc.type = 'square';
            osc.frequency.setValueAtTime(80, 0);
            osc.frequency.exponentialRampToValueAtTime(10, 0.1);
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 200;
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.5, 0);
            gain.gain.exponentialRampToValueAtTime(0.01, 0.1);
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
        });
    }

    /**
     * Renders a procedural sound into an AudioBuffer using an OfflineAudioContext.
     * @param {number} duration - The duration of the sound in seconds.
     * @param {function(OfflineAudioContext): void} setupFn - A function that sets up the audio graph on the provided context.
     * @returns {Promise<AudioBuffer>} The rendered audio buffer.
     * @private
     */
    async renderProceduralSound(duration, setupFn) {
        const offlineCtx = new OfflineAudioContext(1, 44100 * duration, 44100);
        setupFn(offlineCtx);
        return await offlineCtx.startRendering();
    }

    /**
     * Updates the position of the listener for spatial audio.
     * @param {number} x - The x-coordinate of the listener.
     * @param {number} y - The y-coordinate of the listener.
     */
    updateListener(x, y) {
        this.listenerPos = { x, y };
    }

    /**
     * Plays a sound effect.
     * @param {string} effect - The name of the effect to play.
     * @param {number} [x] - The x-coordinate of the sound source for spatialization.
     * @param {number} [y] - The y-coordinate of the sound source for spatialization.
     */
    play(effect, x, y) {
        if (!this.enabled) return;
        this.resume();

        const { buffer, volumeScale } = this._getSoundBuffer(effect);
        if (!buffer) return;

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;

        let outputNode = this._applySpatialization(source, x, y);
        outputNode = this._applyRandomization(source, outputNode, volumeScale);
        
        outputNode.connect(this.masterGain);
        source.start();
    }

    _getSoundBuffer(effect) {
        let targetEffect = effect;
        let volumeScale = 1.0;

        if (effect === 'attack') {
            const idx = Math.floor(Math.random() * 5) + 1;
            targetEffect = `sword${idx}`;
        } else if (effect === 'swing') {
            const idx = Math.floor(Math.random() * 2) + 1;
            targetEffect = `swing${idx}`;
            volumeScale = 0.5;
        }

        const buffer = this.buffers[targetEffect] || (this.assetLoader && this.assetLoader.getAudio(targetEffect));
        return { buffer, volumeScale };
    }

    _applySpatialization(source, x, y) {
        const gainNode = this.ctx.createGain();
        if (x !== undefined && y !== undefined && this.listenerPos) {
            const dx = x - this.listenerPos.x;
            const dy = y - this.listenerPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxDist = 24;

            if (dist > maxDist) {
                gainNode.gain.value = 0; // Too far to hear
            } else {
                gainNode.gain.value = Math.max(0, 1 - (dist / maxDist));
            }

            const panner = this.ctx.createStereoPanner();
            const pan = Math.max(-1, Math.min(1, dx / (maxDist / 2)));
            panner.pan.value = pan;
            
            source.connect(panner);
            panner.connect(gainNode);
            return gainNode;
        }
        
        source.connect(gainNode);
        return gainNode;
    }

    _applyRandomization(source, inputNode, volumeScale) {
        const detune = (Math.random() * 400) - 200; // Pitch variation: +/- 2 semitones
        source.detune.value = detune;

        const volVariance = 0.8 + (Math.random() * 0.4); // Volume variation: 80% to 120%
        if (inputNode.gain) {
            inputNode.gain.value *= volVariance * volumeScale;
        }
        
        return inputNode;
    }

    /**
     * Plays background music.
     * @param {string} key - The name of the music track to play.
     */
    playMusic(key) {
        if (!this.enabled) return;
        this.stopMusic();
        this.resume();

        const buffer = this.buffers[key] || (this.assetLoader && this.assetLoader.getAudio(key));
        if (!buffer) return;

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        const gain = this.ctx.createGain();
        gain.gain.value = 0.3; // Background volume

        source.connect(gain);
        gain.connect(this.masterGain);
        source.start();

        this.musicSource = source;
    }

    /**
     * Stops the currently playing background music.
     */
    stopMusic() {
        if (this.musicSource) {
            try {
                this.musicSource.stop();
            } catch (e) {
                // It's possible the source was already stopped or never started.
                console.warn("Could not stop music source:", e.message);
            }
            this.musicSource = null;
        }
    }
}