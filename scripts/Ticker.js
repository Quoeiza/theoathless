/**
 * A fixed-step game loop implementation.
 * This class ensures that the game simulation (update logic) runs at a consistent
 * rate, independent of the rendering frame rate. It also provides an interpolation
 * factor ("alpha") to the render function for smooth visuals.
 */
export default class Ticker {
    /**
     * @param {function(number): void} updateFn - The function to call for each fixed-step update. It receives the fixed time step (delta time) as an argument.
     * @param {function(number): void} renderFn - The function to call for rendering. It receives an interpolation factor (alpha) as an argument.
     * @param {number} [tickRate=20] - The desired number of simulation updates per second.
     */
    constructor(updateFn, renderFn, tickRate = 20) {
        this.updateFn = updateFn;
        this.renderFn = renderFn;
        
        /** @type {number} The desired number of simulation updates per second. */
        this.tickRate = tickRate;
        
        /** @type {number} The time in milliseconds per simulation tick. */
        this.timePerTick = 1000 / tickRate;
        if (!Number.isFinite(this.timePerTick) || this.timePerTick < 1) {
            this.timePerTick = 50; // Safety fallback (20 TPS)
        }

        /** @private @type {number} The timestamp of the last loop execution. */
        this.lastTime = 0;
        
        /** @private @type {number} Accumulates elapsed time to determine when to run the next update. */
        this.accumulator = 0;
        
        /** @private @type {boolean} Flag indicating if the loop is currently running. */
        this.isRunning = false;
        
        /** @private @type {?number} The ID of the current animation frame request. */
        this.animationFrameId = null;
    }

    /**
     * Starts the game loop.
     */
    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTime = performance.now();
        this.loop(this.lastTime);
    }

    /**
     * Stops the game loop.
     */
    stop() {
        this.isRunning = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        this.animationFrameId = null;
    }

    /**
     * The main loop, driven by requestAnimationFrame.
     * @private
     * @param {number} timestamp - The current time provided by the browser.
     */
    loop(timestamp) {
        if (!this.isRunning) return;

        this.animationFrameId = requestAnimationFrame((t) => this.loop(t));

        let deltaTime = timestamp - this.lastTime;
        this.lastTime = timestamp;

        // Cap deltaTime to prevent a "spiral of death" if the tab was backgrounded for a long time.
        if (deltaTime > 1000) {
            deltaTime = 1000;
        }
        
        this.accumulator += deltaTime;

        let updates = 0;
        try {
            // Perform a fixed number of updates based on the accumulated time.
            while (this.accumulator >= this.timePerTick) {
                this.updateFn(this.timePerTick); // Pass fixed delta time to the update function.
                this.accumulator -= this.timePerTick;
                
                // Safety break to prevent the game from getting stuck in an update spiral on slow devices.
                if (++updates > 10) { 
                    this.accumulator = 0; 
                    break;
                }
            }

            // Call the render function with an interpolation factor for smooth rendering between updates.
            const alpha = this.accumulator / this.timePerTick;
            this.renderFn(alpha);
        } catch (e) {
            console.error("Ticker Crash Recovered:", e);
        }
    }
}