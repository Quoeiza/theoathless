import { playFabManager } from './PlayFabManager.js';

export class Lobby {
    constructor(uiLayer, playerData, onEnterDungeon, uiSystem) {
        this.uiLayer = uiLayer;
        this.playerData = playerData;
        this.onEnterDungeon = onEnterDungeon;
        this.uiSystem = uiSystem;
        this.loginContainer = document.getElementById('login-container');
        this.lobbyContainer = document.getElementById('lobby-container');
        this.loggedIn = false;

        this.setupEventListeners();
        
        this.initializeLobbyShell();

        if (this.loggedIn) {
            this.renderMainMenu();
        } else {
            this.renderLoginForm();
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

    initializeLobbyShell() {
        // Ensure the old overlay login container is hidden
        if (this.loginContainer) this.loginContainer.classList.add('hidden');
        this.lobbyContainer.classList.remove('hidden');

        this.lobbyContainer.innerHTML = `
            <div id="lobby-screen">
                <video autoplay loop muted playsinline id="lobby-bg-video">
                    <source src="./assets/images/ui/bg.mp4" type="video/mp4">
                </video>
                <div class="lobby-panel">
                    <img src="./assets/images/ui/logo.png" id="game-logo" alt="The Oathless" />
                    <div class="menu-container" id="lobby-menu-area">
                        <!-- Dynamic Content -->
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
    }

    renderLoginForm() {
        const menuArea = document.getElementById('lobby-menu-area');
        if (!menuArea) return;

        menuArea.innerHTML = `
            <div class="login-form embedded">
                <h2 style="margin-top:0;">Login</h2>
                <div id="login-error"></div>
                <div class="form-group">
                    <input type="email" id="login-email" placeholder="Email" required>
                </div>
                <div class="form-group">
                    <input type="password" id="login-password" placeholder="Password" required>
                </div>
                <div class="login-buttons">
                    <button id="btn-login">Login</button>
                    <button id="btn-create-account">Register</button>
                </div>
                <div class="forgot-password">
                    <a id="btn-forgot-password">Forgot Password?</a>
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

    renderMainMenu() {
        const menuArea = document.getElementById('lobby-menu-area');
        if (!menuArea) return;

        menuArea.innerHTML = `
            <div id="player-stats">Gold: ${this.playerData.gold} | Escapes: ${this.playerData.escapes || 0}</div>
            <input type="text" id="player-name" placeholder="Enter Name" value="${this.playerData.name}" />
            <select id="class-select">
                <option value="Fighter">Fighter (Heal)</option>
                <option value="Rogue">Rogue (Stealth)</option>
                <option value="Barbarian">Barbarian (Rage)</option>
            </select>
            <div id="lobby-status" class="lobby-status"></div>
            <button id="btn-enter-dungeon">Enter the Dungeon</button>
            <button id="btn-debug-local" style="background: #444; border-color: #666;">Debug Local</button>
            <button id="btn-lobby-settings">Settings</button>
            <button id="btn-logout">Logout</button>
            <button id="btn-quit-game">Quit Game</button>
        `;

        document.getElementById('btn-enter-dungeon').onclick = () => {
            const name = document.getElementById('player-name').value;
            const playerClass = document.getElementById('class-select').value;
            if (this.onEnterDungeon) this.onEnterDungeon(name, playerClass);
        };

        document.getElementById('btn-debug-local').onclick = () => {
            const name = document.getElementById('player-name').value;
            const playerClass = document.getElementById('class-select').value;
            if (this.onEnterDungeon) this.onEnterDungeon(name, playerClass, true); // true = isLocal
        };

        document.getElementById('btn-lobby-settings').onclick = () => {
            if (this.uiSystem && typeof this.uiSystem.toggleSettingsMenu === 'function') {
                this.uiSystem.toggleSettingsMenu();
            }
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
        this.playerData.name = data.InfoResultPayload.AccountInfo.Username;
        this.renderMainMenu();
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
        this.renderLoginForm();
    }

    showError(message, color = '#ff6b6b') {
        const errorElement = document.getElementById('login-error');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.color = color;
        }
    }
}
