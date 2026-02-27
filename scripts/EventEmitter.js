/**
 * A simple EventEmitter class for implementing the observer pattern.
 */
export default class EventEmitter {
    constructor() {
        /**
         * @private
         * @type {Object.<string, Array.<Function>>}
         */
        this.events = {};
    }

    /**
     * Register a listener for a given event.
     * @param {string} event - The name of the event to listen for.
     * @param {Function} listener - The callback function to execute when the event is emitted.
     */
    on(event, listener) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(listener);
    }

    /**
     * Remove a listener for a given event.
     * @param {string} event - The name of the event.
     * @param {Function} listenerToRemove - The specific listener function to remove.
     */
    off(event, listenerToRemove) {
        if (!this.events[event]) return;
        this.events[event] = this.events[event].filter(listener => listener !== listenerToRemove);
    }

    /**
     * Emit an event, calling all registered listeners.
     * @param {string} event - The name of the event to emit.
     * @param {*} [payload] - The data to pass to the listeners.
     */
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

    /**
     * Removes all listeners for all events.
     */
    offAll() {
        this.events = {};
    }
}