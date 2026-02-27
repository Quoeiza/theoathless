import { playFabManager } from './PlayFabManager.js';

export class Lobby {
    constructor(uiLayer, playerData, onHost, onJoin, onQuickJoin, uiSystem) {
        this.uiLayer = uiLayer;
        this.playerData = playerData;
        this.onHost = onHost;
        this.onJoin = onJoin;
        this.onQuickJoin = onQuickJoin;
        this.uiSystem = uiSystem;
        this.loginContainer = document.getElementById('login-container');
        this.lobbyContainer = document.getElementById('lobby-container');
        this.loggedIn = false;

        this.setupEventListeners();
        
        // This is a simple check. A more robust solution might use session storage.
        if (this.loggedIn) {
            this.createLobbyUI();
        } else {
            this.createLoginUI();
        }
    }

    setupEventListeners() {
        playFabManager.on('loginSuccess', this.onLoginSuccess.bind(this));
        playFabManager.on('loginFailure', this.onLoginFailure.bind(this));
        playFabManager.on('registerSuccess', this.onRegisterSuccess.bind(this));
        playFabManager.on('registerFailure', this.onRegisterFailure.bind(this));
        playFabManager.on('forgotPasswordSuccess', this.onForgotPasswordSuccess.bind(this));
        playFabManager.on('forgotPasswordFailure', this.onForgotPasswordFailure.bind(this));
    }

    createLoginUI() {
        this.lobbyContainer.classList.add('hidden');
        this.loginContainer.innerHTML = `
            <div class="login-form">
                <h2>Login</h2>
                <div id="login-error"></div>
                <div class="form-group">
                    <label for="login-email">Email</label>
                    <input type="email" id="login-email" placeholder="Enter your email" required>
                </div>
                <div class="form-group">
                    <label for="login-password">Password</label>
                    <input type="password" id="login-password" placeholder="Enter your password" required>
                </div>
                <div class="login-buttons">
                    <button id="btn-login">Login</button>
                    <button id="btn-create-account">Create Account</button>
                </div>
                <div class="forgot-password">
                    <a id="btn-forgot-password">Forgot your password?</a>
                </div>
            </div>
        `;

        document.getElementById('btn-login').onclick = () => {
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            if (email && password) {
                playFabManager.login(email, password);
            } else {
                this.showError('Please enter both email and password.');
            }
        };

        document.getElementById('btn-create-account').onclick = () => {
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            if (email && password) {
                playFabManager.register(email, password);
            } else {
                this.showError('Please enter both email and password to create an account.');
            }
        };

        document.getElementById('btn-forgot-password').onclick = () => {
            const email = document.getElementById('login-email').value;
            if (email) {
                playFabManager.forgotPassword(email);
            } else {
                this.showError('Please enter your email address to reset your password.');
            }
        };
    }

    createLobbyUI() {
        this.lobbyContainer.innerHTML = `
            <div id="lobby-screen">
                <video autoplay loop muted playsinline id="lobby-bg-video">
                    <source src="./assets/images/ui/bg.mp4" type="video/mp4">
                </video>
                <div class="lobby-panel">
                    <img src="./assets/images/ui/logo.png" id="game-logo" alt="The Oathless" />
                    <div class="menu-container">
                        <div id="player-stats">Gold: ${this.playerData.gold} | Escapes: ${this.playerData.escapes || 0}</div>
                        <input type="text" id="player-name" placeholder="Enter Name" value="${this.playerData.name}" />
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
                        <div class="button-group">
                            <button id="btn-lobby-settings">Settings</button>
                            <button id="btn-logout">Logout</button>
                        </div>
                        <button id="btn-quit-game">Quit Game</button>
                    </div>
                </div>
                <div id="lobby-footer">
                    <div class="version">v0.1.0 Alpha</div>
                </div>
            </div>
        `;

        const bgVideo = document.getElementById('lobby-bg-video');
        if (bgVideo) {
            bgVideo.muted = true;
            bgVideo.play().catch(e => console.warn("Lobby video autoplay failed:", e));
        }

        const codeInput = document.getElementById('room-code-input');
        if (codeInput) {
            codeInput.maxLength = 4;
            codeInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            });
        }

        document.getElementById('btn-host').onclick = () => {
            const name = document.getElementById('player-name').value;
            const playerClass = document.getElementById('class-select').value;
            this.onHost(name, playerClass);
        };

        document.getElementById('btn-quick-join').onclick = () => {
            const name = document.getElementById('player-name').value;
            const playerClass = document.getElementById('class-select').value;
            if (this.onQuickJoin) this.onQuickJoin(name, playerClass);
        };

        document.getElementById('btn-join').onclick = () => {
            const code = document.getElementById('room-code-input').value;
            const name = document.getElementById('player-name').value;
            const playerClass = document.getElementById('class-select').value;
            if (!code) return alert("Enter a room code");
            this.onJoin(code, name, playerClass);
        };

        document.getElementById('btn-lobby-settings').onclick = () => {
            this.uiSystem.toggleSettingsMenu();
        };

        document.getElementById('btn-logout').onclick = () => {
            this.logout();
        };

        document.getElementById('btn-quit-game').onclick = () => {
            window.open('', '_self', '');
            window.close();
            setTimeout(() => window.location.href = "about:blank", 100);
        };
    }

    onLoginSuccess(data) {
        console.log("Login successful:", data);
        this.loggedIn = true;
        this.loginContainer.classList.add('hidden');
        this.lobbyContainer.classList.remove('hidden');
        // You might want to load player data from PlayFab here
        this.playerData.name = data.InfoResultPayload.AccountInfo.Username;
        this.createLobbyUI();
    }

    onLoginFailure(error) {
        this.showError(error);
    }

    onRegisterSuccess(data) {
        console.log("Registration successful:", data);
        // Automatically log the user in after registration
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        playFabManager.login(email, password);
    }

    onRegisterFailure(error) {
        this.showError(error);
    }

    onForgotPasswordSuccess(message) {
        this.showError(message, 'green'); // Show success message in green
    }

    onForgotPasswordFailure(error) {
        this.showError(error);
    }

    logout() {
        this.loggedIn = false;
        this.playerData.name = '';
        this.lobbyContainer.classList.add('hidden');
        this.loginContainer.classList.remove('hidden');
        this.createLoginUI(); // Re-create login UI to clear fields and attach listeners
    }

    showError(message, color = '#ff6b6b') {
        const errorElement = document.getElementById('login-error');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.color = color;
        }
    }
}
