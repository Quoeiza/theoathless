export function setupLobby(uiLayer, playerData, onHost, onJoin, onQuickJoin) {
    const lobby = document.createElement('div');
    lobby.id = 'lobby-screen';
    
    // Set background image for main menu
    lobby.style.backgroundImage = "url('./assets/images/ui/bg.jpg')";

    lobby.innerHTML = `
        <video autoplay loop muted playsinline id="lobby-bg-video">
            <source src="./assets/images/ui/bg.mp4" type="video/mp4">
        </video>
        <div class="lobby-panel">
            <img src="./assets/images/ui/logo.png" id="game-logo" alt="The Oathless" />
            
            <div class="menu-container">
                <div id="player-stats">Gold: ${playerData.gold} | Escapes: ${playerData.escapes || 0}</div>
                <input type="text" id="player-name" placeholder="Enter Name" value="${playerData.name}" />
                <select id="class-select">
                    <option value="Fighter">Fighter (Heal)</option>
                    <option value="Rogue">Rogue (Stealth)</option>
                    <option value="Barbarian">Barbarian (Rage)</option>
                </select>
                <button id="btn-quick-join">Quick Join</button>
                <button id="btn-host">Host Game</button>
                <div class="join-row">
                    <input type="text" id="room-code-input" placeholder="****" />
                    <button id="btn-join">Join Game</button>
                </div>
                <button id="btn-quit-game">Quit Game</button>
            </div>
        </div>
        <div id="lobby-footer">
            <div>
                <div style="margin-bottom: 5px;">F11 for Fullscreen</div>
                <div class="version">v0.1.0 Alpha</div>
            </div>
            <div class="socials">
                <span></span>
                <span></span>
            </div>
        </div>
    `;
    uiLayer.appendChild(lobby);

    const bgVideo = document.getElementById('lobby-bg-video');
    if (bgVideo) {
        bgVideo.muted = true;
        bgVideo.play().catch(e => console.warn("Lobby video autoplay failed:", e));
    }

    const codeInput = document.getElementById('room-code-input');
    codeInput.maxLength = 4;
    codeInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    });

    document.getElementById('btn-host').onclick = () => {
        const name = document.getElementById('player-name').value;
        const playerClass = document.getElementById('class-select').value;
        onHost(name, playerClass);
    };

    document.getElementById('btn-quick-join').onclick = () => {
        const name = document.getElementById('player-name').value;
        const playerClass = document.getElementById('class-select').value;
        if (onQuickJoin) onQuickJoin(name, playerClass);
    };

    document.getElementById('btn-join').onclick = () => {
        const code = document.getElementById('room-code-input').value;
        const name = document.getElementById('player-name').value;
        const playerClass = document.getElementById('class-select').value;
        if (!code) return alert("Enter a room code");
        onJoin(code, name, playerClass);
    };

    document.getElementById('btn-quit-game').onclick = () => {
        window.open('', '_self', '');
        window.close();
        setTimeout(() => window.location.href = "about:blank", 100);
    };
}
