import EventEmitter from './EventEmitter.js';

export default class InputManager extends EventEmitter {
    constructor(globalConfig) {
        super();
        this.cooldownMs = globalConfig.globalCooldownMs || 250;
        this.lastActionTime = 0;
        this.keys = {};
        
        this.initListeners();
    }

    initListeners() {
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            this.handleInput(e.code);
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });

        // Mobile / UI Button bindings
        const bindBtn = (id, code) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    this.handleInput(code);
                });
                el.addEventListener('click', (e) => {
                    this.handleInput(code);
                });
            }
        };

        bindBtn('btn-up', 'ArrowUp');
        bindBtn('btn-down', 'ArrowDown');
        bindBtn('btn-left', 'ArrowLeft');
        bindBtn('btn-right', 'ArrowRight');
        bindBtn('btn-attack', 'Space');
        bindBtn('btn-pickup', 'KeyE');
    }

    handleInput(code) {
        const now = Date.now();
        if (now - this.lastActionTime < this.cooldownMs) {
            return; // Throttled
        }

        let intent = null;

        switch(code) {
            case 'ArrowUp':
            case 'KeyW':
                intent = { type: 'MOVE', direction: { x: 0, y: -1 } };
                break;
            case 'ArrowDown':
            case 'KeyS':
                intent = { type: 'MOVE', direction: { x: 0, y: 1 } };
                break;
            case 'ArrowLeft':
            case 'KeyA':
                intent = { type: 'MOVE', direction: { x: -1, y: 0 } };
                break;
            case 'ArrowRight':
            case 'KeyD':
                intent = { type: 'MOVE', direction: { x: 1, y: 0 } };
                break;
            case 'Space':
            case 'Enter':
                intent = { type: 'ATTACK' };
                break;
            case 'KeyE':
                intent = { type: 'PICKUP' };
                break;
        }

        if (intent) {
            this.lastActionTime = now;
            this.emit('intent', intent);
        }
    }
}