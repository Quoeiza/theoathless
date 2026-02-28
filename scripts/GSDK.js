import fs from 'fs';
import os from 'os';
import got from 'got'; // Using 'got' for HTTP requests, will need to be installed.

class GSDK {
    constructor() {
        this.config = {};
        this.state = 'Initializing';
        this.heartbeatInterval = null;
        this.shutdownCallback = null;
        this.healthCallback = null;
        this.connectedPlayers = [];
    }

    start() {
        const configFile = process.env.GSDK_CONFIG_FILE;
        if (!configFile) {
            console.error('GSDK_CONFIG_FILE environment variable not set. Running in standalone mode.');
            this.state = 'Active'; // Assume active for local testing
            return;
        }

        try {
            const data = fs.readFileSync(configFile, 'utf8');
            this.config = JSON.parse(data);
            console.log('GSDK config loaded:', this.config);
        } catch (e) {
            console.error('Failed to read or parse GSDK config file:', e);
            throw e;
        }

        this.startHeartbeat();
    }

    startHeartbeat() {
        if (!this.config.heartbeatEndpoint) {
            console.error('Heartbeat endpoint not configured.');
            return;
        }

        this.heartbeatInterval = setInterval(async () => {
            try {
                const payload = {
                    CurrentGameState: this.state,
                    ConnectedPlayers: this.connectedPlayers,
                };
                
                await got.put(`http://${this.config.heartbeatEndpoint}/v1/sessionHosts/${this.config.sessionId}`, {
                    json: payload,
                    responseType: 'json'
                });

            } catch (e) {
                console.error('Failed to send heartbeat:', e.message);
            }
        }, 1000); // Send heartbeat every second
    }

    readyForPlayers() {
        this.state = 'StandingBy';
        // In a real implementation, we would wait for a signal from the agent.
        // For now, we'll just transition to Active after a short delay.
        setTimeout(() => {
            this.state = 'Active';
        }, 5000);
    }
    
    getGameServerConnectionInfo() {
        return this.config.gamePorts;
    }

    registerShutdownCallback(callback) {
        this.shutdownCallback = callback;
    }

    registerHealthCallback(callback) {
        this.healthCallback = callback;
    }

    updateConnectedPlayers(players) {
        this.connectedPlayers = players;
    }
}

export const GSDKInstance = new GSDK();
