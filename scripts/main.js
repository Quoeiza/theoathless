import GameLoop from './GameLoop.js';

/**
 * Main entry point for the game.
 */
function main() {
    const game = new GameLoop();

    // Expose the game instance for debugging purposes.
    // In a production environment, you might want to remove this.
    window.game = game;

    game.init();
}

// Wait for the DOM to be fully loaded before initializing the game.
// This allows the game to start faster than waiting for all assets to load.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}