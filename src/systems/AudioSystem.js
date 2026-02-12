export default class AudioSystem {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.enabled = true;
    }

    playTone(freq, type, duration, vol = 0.1) {
        if (!this.enabled) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(vol, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch (e) {
            console.error("Audio Error", e);
        }
    }

    play(effect) {
        // Resume context if suspended (browser autoplay policy)
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        switch(effect) {
            case 'attack':
                this.playTone(150, 'sawtooth', 0.1, 0.05);
                break;
            case 'hit':
                this.playTone(100, 'square', 0.1, 0.05);
                break;
            case 'step':
                this.playTone(50, 'sine', 0.05, 0.02);
                break;
            case 'pickup':
                this.playTone(600, 'sine', 0.1, 0.05);
                break;
            case 'death':
                this.playTone(50, 'sawtooth', 0.5, 0.1);
                break;
        }
    }
}