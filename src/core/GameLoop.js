export default class GameLoop {
    constructor(updateFn, renderFn, tickRate = 20) {
        this.updateFn = updateFn;
        this.renderFn = renderFn;
        this.tickRate = tickRate;
        this.timePerTick = 1000 / tickRate;
        
        this.lastTime = 0;
        this.accumulator = 0;
        this.isRunning = false;
        this.animationFrameId = null;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTime = performance.now();
        this.loop(this.lastTime);
    }

    stop() {
        this.isRunning = false;
        cancelAnimationFrame(this.animationFrameId);
    }

    loop(timestamp) {
        if (!this.isRunning) return;

        const deltaTime = timestamp - this.lastTime;
        this.lastTime = timestamp;
        this.accumulator += deltaTime;

        while (this.accumulator >= this.timePerTick) {
            this.updateFn(this.timePerTick); // Fixed update
            this.accumulator -= this.timePerTick;
        }

        this.renderFn(this.accumulator / this.timePerTick); // Interpolation alpha
        this.animationFrameId = requestAnimationFrame((t) => this.loop(t));
    }
}