import EventEmitter from './EventEmitter.js';

export default class PeerClient extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.peer = null;
        this.connections = [];
        this.isHost = false;
        this.isScanning = false;
    }

    init(id = null) {
        // In a real implementation, we would import PeerJS from a CDN or bundle
        try {
            this.peer = new Peer(id, {
                debug: this.config.peerConfig.debug,
                config: { iceServers: this.config.stunServers }
            });
            this._bindPeerEvents();
        } catch (e) {
            console.error("PeerJS not loaded", e);
        }
    }

    async initHost() {
        // Try to acquire a Public Room ID (PUB0 - PUB9)
        for (let i = 0; i < 10; i++) {
            const id = `coldcoin-PUB${i}`;
            const success = await new Promise(resolve => {
                const p = new Peer(id, {
                    debug: this.config.peerConfig.debug,
                    config: { iceServers: this.config.stunServers }
                });
                
                const onError = (err) => {
                    p.destroy();
                    resolve(false);
                };

                p.on('error', onError);
                p.on('open', (id) => {
                    p.off('error', onError);
                    this.peer = p;
                    this._bindPeerEvents();
                    console.log('My peer ID is: ' + id);
                    this.emit('ready', id);
                    resolve(true);
                });
            });
            if (success) return;
        }

        // Fallback to random ID if all public slots are full
        const randomId = `coldcoin-${this.generateRoomId()}`;
        this.init(randomId);
    }

    _bindPeerEvents() {
        if (!this.peer) return;

        this.peer.on('open', (id) => {
            console.log('My peer ID is: ' + id);
            this.emit('ready', id);
        });

        this.peer.on('connection', (conn) => {
            this.handleConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.error(err);
            if (this.isScanning && err.type === 'peer-unavailable') return;
            this.emit('error', err);
        });
    }

    connect(hostId, metadata = {}) {
        const conn = this.peer.connect(hostId, { metadata, reliable: true });
        this.handleConnection(conn);
    }

    handleConnection(conn) {
        this.connections.push(conn);
        conn.on('data', (data) => {
            this.emit('data', { sender: conn.peer, data });
        });
        conn.on('open', () => {
            this.emit('connected', { peerId: conn.peer, metadata: conn.metadata });
        });

        // If connection is already open (race condition), emit immediately
        if (conn.open) {
            this.emit('connected', { peerId: conn.peer, metadata: conn.metadata });
        }
    }

    send(data) {
        this.connections.forEach(conn => {
            try {
                if (conn.open) conn.send(data);
            } catch (e) {
                console.warn("PeerClient Send Error:", e);
            }
        });
    }

    sendTo(peerId, data) {
        const conn = this.connections.find(c => c.peer === peerId);
        if (conn) {
            try {
                if (conn.open) conn.send(data);
            } catch (e) {
                console.warn(`PeerClient SendTo ${peerId} Error:`, e);
            }
        }
    }

    generateRoomId() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let result = '';
        for (let i = 0; i < 4; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    async scanForSessions() {
        this.isScanning = true;
        const sessions = [];
        const promises = [];

        // Scan PUB0 to PUB9
        for (let i = 0; i < 10; i++) {
            promises.push(new Promise(resolve => {
                const start = Date.now();
                const conn = this.peer.connect(`coldcoin-PUB${i}`, { reliable: true });
                let resolved = false;

                const cleanup = () => {
                    if (!resolved) { resolved = true; conn.close(); resolve(); }
                };

                // Timeout after 1.5s
                setTimeout(cleanup, 1500);

                conn.on('open', () => {
                    conn.send({ type: 'DISCOVERY_REQUEST' });
                });

                conn.on('data', (data) => {
                    if (data && data.type === 'DISCOVERY_RESPONSE') {
                        sessions.push({ id: `coldcoin-PUB${i}`, ...data.payload, ping: Date.now() - start });
                        cleanup();
                    }
                });
                conn.on('error', cleanup);
            }));
        }

        await Promise.all(promises);
        this.isScanning = false;
        return sessions;
    }
}