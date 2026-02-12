export default class Database {
    constructor() {
        this.storageKey = 'dungextract_player_data_v1';
    }

    async getPlayer() {
        const data = localStorage.getItem(this.storageKey);
        return data ? JSON.parse(data) : { name: 'Unknown', gold: 0, extractions: 0 };
    }

    async savePlayer(playerData) {
        const current = await this.getPlayer();
        const updated = { ...current, ...playerData };
        localStorage.setItem(this.storageKey, JSON.stringify(updated));
        console.log("DB: Saved player data", updated);
        return true;
    }
}