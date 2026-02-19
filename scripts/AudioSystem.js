export default class AudioSystem {
    constructor() {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (AudioCtor) {
            this.ctx = new AudioCtor();
            this.enabled = true;
            
            // Master Gain for global volume control
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.4; // Default to 40% to prevent clipping
            this.masterGain.connect(this.ctx.destination);

            this.buffers = {};
            this.assetLoader = null;
            this.listenerPos = null;
            this.musicSource = null;

            // Generate high-fidelity procedural assets immediately
            this.generateGrimdarkAssets();
        } else {
            console.warn("AudioContext not supported");
            this.enabled = false;
        }
    }

    setAssetLoader(loader) {
        this.assetLoader = loader;

        // Load Sword Sounds & Music
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

    resume() {
        if (this.enabled && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    unlock() {
        if (this.enabled) {
            if (this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
            // Play a silent buffer to force the audio subsystem to unlock on mobile
            const buffer = this.ctx.createBuffer(1, 1, 22050);
            const source = this.ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(this.ctx.destination);
            source.start(0);
        }
    }

    async generateGrimdarkAssets() {
        if (!this.enabled) return;
        
        // Consolidated Impact Sound (Used for Attack and Hit)
        const createImpactSound = (ctx) => {
            // 1. Low Thud (Kick)
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(120, 0);
            osc.frequency.exponentialRampToValueAtTime(30, 0.2);
            
            const oscGain = ctx.createGain();
            oscGain.gain.setValueAtTime(1, 0);
            oscGain.gain.exponentialRampToValueAtTime(0.01, 0.3);
            osc.connect(oscGain);
            oscGain.connect(ctx.destination);

            // 2. Wet Squelch (Filtered Noise)
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
        };

        const impactBuffer = await this.renderProceduralSound(0.4, createImpactSound);
        this.buffers['hit'] = impactBuffer;

        // Grit Step
        this.buffers['step'] = await this.renderProceduralSound(0.1, (ctx) => {
            // Legacy Sine Step (Restored)
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

        // Pickup Chime
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

        // Bump Thud
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

    async renderProceduralSound(duration, setupFn) {
        // OfflineAudioContext allows us to render complex audio graphs into a static buffer
        // This provides "asset-like" performance with zero network load.
        const offlineCtx = new OfflineAudioContext(1, 44100 * duration, 44100);
        setupFn(offlineCtx);
        return await offlineCtx.startRendering();
    }

    updateListener(x, y) {
        this.listenerPos = { x, y };
    }

    play(effect, x, y) {
        if (!this.enabled) return;
        if (this.enabled && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        let targetEffect = effect;
        let volumeScale = 1.0;

        // Randomize Attack Sound
        if (effect === 'attack') {
            const idx = Math.floor(Math.random() * 5) + 1;
            targetEffect = `sword${idx}`;
        } else if (effect === 'swing') {
            const idx = Math.floor(Math.random() * 2) + 1;
            targetEffect = `swing${idx}`;
            volumeScale = 0.5;
        }

        // Priority: 1. Generated Buffer, 2. Loaded Asset
        let buffer = this.buffers[targetEffect] || (this.assetLoader && this.assetLoader.getAudio(targetEffect));

        if (!buffer) return;

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;

        const gainNode = this.ctx.createGain();
        
        // Spatial Audio Logic
        if (x !== undefined && y !== undefined && this.listenerPos) {
            const dx = x - this.listenerPos.x;
            const dy = y - this.listenerPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxDist = 24;

            if (dist > maxDist) return; // Too far to hear

            // Distance Attenuation (Linear)
            const vol = Math.max(0, 1 - (dist / maxDist));
            volumeScale *= vol;

            // Stereo Panning
            const panner = this.ctx.createStereoPanner();
            // Map X distance to -1 (left) to 1 (right)
            // We use a narrower field for panning than audibility to keep it distinct
            const pan = Math.max(-1, Math.min(1, dx / (maxDist / 2)));
            panner.pan.value = pan;
            
            source.connect(panner);
            panner.connect(gainNode);
        } else {
            source.connect(gainNode);
        }

        // Pitch Randomization (±200 cents / ±2 semitones)
        // This prevents the "machine gun" effect on repeated sounds
        const detune = (Math.random() * 400) - 200; 
        source.detune.value = detune;

        // Volume Randomization (0.8x to 1.2x)
        const volVariance = 0.8 + (Math.random() * 0.4);
        gainNode.gain.value = volVariance * volumeScale;

        gainNode.connect(this.masterGain);
        
        source.start();
    }

    playMusic(key) {
        if (!this.enabled) return;
        this.stopMusic();

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

    stopMusic() {
        if (this.musicSource) {
            try {
                this.musicSource.stop();
            } catch (e) {}
            this.musicSource = null;
        }
    }
}