export default class EventEmitter {
    constructor() {
        this.events = {};
    }

    on(event, listener) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(listener);
    }

    off(event, listenerToRemove) {
        if (!this.events[event]) return;
        this.events[event] = this.events[event].filter(listener => listener !== listenerToRemove);
    }

    emit(event, payload) {
        if (!this.events[event]) return;
        this.events[event].forEach(listener => {
            try {
                listener(payload);
            } catch (e) {
                console.error(`Error in event listener for ${event}:`, e);
            }
        });
    }
}