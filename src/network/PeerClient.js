import EventEmitter from '../core/EventEmitter.js';

export default class PeerClient extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.peer = null;
        this.connections = [];
        this.isHost = false;
    }

    init(id = null) {
        // In a real implementation, we would import PeerJS from a CDN or bundle
        // Assuming global Peer object exists via script tag in index.html
        try {
            this.peer = new Peer(id, {
                debug: this.config.peerConfig.debug,
                config: { iceServers: this.config.stunServers }
            });

            this.peer.on('open', (id) => {
                console.log('My peer ID is: ' + id);
                this.emit('ready', id);
            });

            this.peer.on('connection', (conn) => {
                this.handleConnection(conn);
            });

            this.peer.on('error', (err) => {
                console.error(err);
                this.emit('error', err);
            });
        } catch (e) {
            console.error("PeerJS not loaded", e);
        }
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
}