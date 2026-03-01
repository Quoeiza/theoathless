import EventEmitter from './EventEmitter.js';

export const DIRECTIONS = {
    N:  { x: 0, y: -1 },
    NE: { x: 1, y: -1 },
    E:  { x: 1, y: 0 },
    SE: { x: 1, y: 1 },
    S:  { x: 0, y: 1 },
    SW: { x: -1, y: 1 },
    W:  { x: -1, y: 0 },
    NW: { x: -1, y: -1 },
    NONE: { x: 0, y: 0 }
};

const MOVEMENT_KEYS = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'Numpad8', 'Numpad2', 'Numpad4', 'Numpad6',
    'Numpad7', 'Numpad9', 'Numpad1', 'Numpad3',
    'KeyQ', 'KeyE', 'KeyZ', 'KeyC'
]);

const KEY_TO_INTENT = {
    'Space': { type: 'INTERACT' },
    'Enter': { type: 'INTERACT' },
    'KeyI': { type: 'TOGGLE_INVENTORY' },
    'Escape': { type: 'TOGGLE_MENU' },
    'Tab': { type: 'AUTO_EXPLORE' },
    'KeyO': { type: 'AUTO_EXPLORE' },
    'KeyR': { type: 'PICKUP' },
    'KeyF': { type: 'ABILITY' },
};

const MOVEMENT_KEY_MAP = {
    'ArrowUp': { y: -1 }, 'KeyW': { y: -1 }, 'Numpad8': { y: -1 },
    'ArrowDown': { y: 1 }, 'KeyS': { y: 1 }, 'Numpad2': { y: 1 },
    'ArrowLeft': { x: -1 }, 'KeyA': { x: -1 }, 'Numpad4': { x: -1 },
    'ArrowRight': { x: 1 }, 'KeyD': { x: 1 }, 'Numpad6': { x: 1 },
    'KeyQ': { x: -1, y: -1 }, 'Numpad7': { x: -1, y: -1 }, // NW
    'KeyE': { x: 1, y: -1 }, 'Numpad9': { x: 1, y: -1 },  // NE
    'KeyZ': { x: -1, y: 1 }, 'Numpad1': { x: -1, y: 1 },  // SW
    'KeyC': { x: 1, y: 1 }, 'Numpad3': { x: 1, y: 1 },   // SE
};

/**
 * Handles all user input and translates it into game-specific intents.
 * @extends {EventEmitter}
 */
export default class InputManager extends EventEmitter {
    constructor(globalConfig) {
        super();
        /** @type {Object.<string, boolean>} */
        this.keys = {};
        /** @type {{x: number, y: number, left: boolean, right: boolean, middle: boolean, wheel: number}} */
        this.mouse = { x: 0, y: 0, left: false, right: false, middle: false, wheel: 0 };
        this.canvas = document.getElementById('game-canvas');
        
        this.initListeners();
    }

    /**
     * Initializes all the necessary DOM event listeners.
     * @private
     */
    initListeners() {
        window.addEventListener('keydown', (e) => {
            // Ignore input if a text field is focused
            const target = e.target;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
                return;
            }

            this.keys[e.code] = true;
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
                e.preventDefault();
            }
            if (!this.isMovementKey(e.code)) {
                this.handleKeyInput(e.code);
            }
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });

        if (this.canvas) {
            this.canvas.addEventListener('mousemove', (e) => {
                const rect = this.canvas.getBoundingClientRect();
                this.mouse.x = e.clientX - rect.left;
                this.mouse.y = e.clientY - rect.top;
                this.emit('mousemove', { x: this.mouse.x, y: this.mouse.y });
            });

            this.canvas.addEventListener('mousedown', (e) => {
                if (e.button === 0) this.mouse.left = true;
                if (e.button === 1) this.mouse.middle = true;
                if (e.button === 2) this.mouse.right = true;
                this.emit('click', {
                    button: e.button,
                    x: this.mouse.x,
                    y: this.mouse.y,
                    shift: !!(this.keys['ShiftLeft'] || this.keys['ShiftRight'])
                });
            });

            this.canvas.addEventListener('mouseup', (e) => {
                if (e.button === 0) this.mouse.left = false;
                if (e.button === 1) this.mouse.middle = false;
                if (e.button === 2) this.mouse.right = false;
            });

            this.canvas.addEventListener('wheel', (e) => {
                this.mouse.wheel = e.deltaY;
                this.emit('scroll', e.deltaY);
            }, { passive: true });
            
            this.canvas.addEventListener('contextmenu', e => e.preventDefault());
        }
        
        this._bindMobileButtons();
    }
    
    /**
     * Binds touch and click events for on-screen mobile buttons.
     * @private
     */
    _bindMobileButtons() {
        const bindBtn = (id, code) => {
            const el = document.getElementById(id);
            if (!el) return;

            if (this.isMovementKey(code)) {
                const setKey = (state) => { this.keys[code] = state; };
                el.addEventListener('mousedown', (e) => { e.preventDefault(); setKey(true); });
                el.addEventListener('mouseup', (e) => { e.preventDefault(); setKey(false); });
                el.addEventListener('mouseleave', (e) => { e.preventDefault(); setKey(false); });
                el.addEventListener('touchstart', (e) => { e.preventDefault(); setKey(true); }, { passive: false });
                el.addEventListener('touchend', (e) => { e.preventDefault(); setKey(false); });
            } else {
                const trigger = (e) => {
                    e.preventDefault();
                    this.handleKeyInput(code);
                };
                el.addEventListener('touchstart', trigger, { passive: false });
                el.addEventListener('click', trigger);
            }
        };

        bindBtn('btn-up', 'ArrowUp');
        bindBtn('btn-down', 'ArrowDown');
        bindBtn('btn-left', 'ArrowLeft');
        bindBtn('btn-right', 'ArrowRight');
        bindBtn('btn-attack', 'Space');
        bindBtn('btn-pickup', 'KeyR');
        bindBtn('btn-ability', 'KeyF');
    }

    /**
     * Checks if a given key code is a movement key.
     * @param {string} code - The key code to check.
     * @returns {boolean} True if it's a movement key.
     */
    isMovementKey(code) {
        return MOVEMENT_KEYS.has(code);
    }

    /**
     * Handles discrete key presses and converts them into game intents.
     * @param {string} code - The key code that was pressed.
     * @private
     */
    handleKeyInput(code) {
        let intent = KEY_TO_INTENT[code] || null;

        if (code.startsWith('Digit')) {
            const num = parseInt(code.replace('Digit', ''));
            if (!isNaN(num)) {
                const slot = num === 0 ? 9 : num - 1;
                intent = { type: 'USE_ABILITY_SLOT', slot };
            }
        }

        if (intent) {
            this.emit('intent', intent);
        }
    }

    /**
     * Polls the current state of movement keys and returns a movement intent.
     * @returns {{type: string, direction: {x: number, y: number}, shift: boolean}|null} A movement intent object or null if no movement keys are pressed.
     */
    getMovementIntent() {
        let x = 0;
        let y = 0;

        for (const key in this.keys) {
            if (this.keys[key] && MOVEMENT_KEY_MAP[key]) {
                const move = MOVEMENT_KEY_MAP[key];
                if(move.x !== undefined) x = move.x;
                if(move.y !== undefined) y = move.y;
            }
        }
        
        const dir = { x: Math.sign(x), y: Math.sign(y) };
        const shift = !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']);

        if (dir.x !== 0 || dir.y !== 0) {
            return { type: 'MOVE', direction: dir, shift };
        }
        return null;
    }

    /**
     * Gets the current state of the mouse.
     * @returns {{x: number, y: number, left: boolean, right: boolean, middle: boolean, wheel: number, shift: boolean}}
     */
    getMouseState() {
        return { 
            ...this.mouse,
            shift: !!(this.keys['ShiftLeft'] || this.keys['ShiftRight'])
        };
    }
}