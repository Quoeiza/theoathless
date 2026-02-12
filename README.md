# 🏰 DungExtract

> A browser-based, multiplayer, 2D top-down dungeon crawling extraction game.

**DungExtract** combines the tension of extraction shooters with the retro aesthetic of classic roguelikes. Players enter procedurally generated dungeons, battle monsters and other players, and must extract to secure their loot.

---

## 🎮 Core Features

*   **⚔️ PvPvE Combat:** Fight against AI monsters and other players in real-time grid-based combat.
*   **💀 High Stakes:** If you die, you lose your loot. If you extract, you keep the gold and gear.
*   **👹 Monster Mode:** Eliminated players respawn as monsters to hunt down the remaining survivors.
*   **🔦 Dynamic Atmosphere:** Features dynamic lighting, shadows, and environmental hazards like lava and mud.
*   **📦 Inventory System:** Manage your gear, weapons, and consumables with a drag-and-drop inventory.
*   **🌐 P2P Networking:** Host games directly from your browser using PeerJS. No dedicated servers required.

## 🕹️ Controls

| Action | Key / Input |
| :--- | :--- |
| **Move** | `WASD` / `Arrows` / `Numpad` / `QEZX` (Diagonals) |
| **Attack** | `Space` / `Enter` |
| **Interact / Pickup** | `R` |
| **Class Ability** | `F` |
| **Quick Items** | `1`, `2`, `3` |
| **Menu / Pause** | `Esc` |
| **Inventory** | Click the 🎒 Bag icon |

## 🛠️ Technical Stack

*   **Language:** Vanilla JavaScript (ES6 Modules)
*   **Rendering:** HTML5 Canvas API
*   **Networking:** PeerJS (WebRTC)
*   **Styling:** CSS3

## 🚀 How to Run

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/dungextract.git
    ```
2.  **Serve the directory:**
    Because this project uses ES6 modules, it must be served via a local web server (opening `index.html` directly won't work due to CORS policies).
    *   *VS Code:* Use the "Live Server" extension.
    *   *Python:* `python -m http.server`
    *   *Node:* `npx serve`
3.  **Play:**
    Open the local server URL (e.g., `http://127.0.0.1:5500`) in your browser.

---
*Inspired by Dark & Darker, Dungeonborne, and Dungeonmans.*