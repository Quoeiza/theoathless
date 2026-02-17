# **Cold Coin Game Design Document**

# **Project Overview**

## **Game Concept**

Cold Coin is a browser-based, multiplayer, 2D top-down dungeon crawling game with a strong focus on Player vs. Player (PvP) extraction mechanics. Players enter procedurally generated dungeons, gather loot, and must successfully extract to keep their rewards. The core loop is built around risk-reward decision-making, limited resources, and intense player encounters in short 15 minute matches.

## **Core Influences**

The primary influences are the following games. Whenever ambiguous about any design decision, refer to how these games achieved their goals:

* “Dark & Darker”  
* “Dungeonborne”  
* “Crawl”  
* “He is Coming”  
* “Dungeonmans”

## **Target Audience**

The primary target audience is players who enjoy competitive, session-based games such as battle royales and extraction shooters, but prefer a retro 2D aesthetic and roguelike elements. Secondary audiences include casual browser gamers looking for a quick, low-barrier-to-entry multiplayer experience.

## **Genre**

* 2D Top-Down Dungeon Crawler  
* Multiplayer PvP Extraction  
* Roguelike/Roguelite

## **Core Gameplay Loop**

1. **Enter:** Player joins automatic matchmaking, or a specific room via a 4-character code. Host starts the game.  
2. **Crawl:** Player navigates a grid tile-based, procedurally generated dungeon, fighting monsters and finding loot/resources.  
3. **PvP:** Player encounters other live players and engage in combat.  
4. **Death/Monster Mechanic:** Eliminated players respawn as one of the maps monsters to attack the remaining survivors. The monsters will be rewarded for player damage and kills.  
5. **Extract:** Remaining players must reach an extraction zone before the dungeon collapses or the timer runs out.  
6. **Progress:** Successful extraction secures loot, which contributes to persistent player progression (e.g., new starting gear).

# **Technical and Architectural Design**

## **Technology Stack**

| Component | Technology | Rationale |
| :---- | :---- | :---- |
| Frontend/Game Logic | Vanilla JavaScript | Zero-cost, browser-based, multiplatform compatibility (PC & Mobile). |
| Networking | PeerJS | Handles WebRTC connections for P2P networking. |
| NAT Traversal | Google STUN Servers | Facilitates P2P connection by bypassing NAT restrictions. |
| Hosting | GitHub Pages | Zero-cost, decentralized hosting solution. |
| Database | PostgresSQL | Player account details and inventory storage. |

## **Github Directory Structure**

Strict adherence to this structure is required to maintain separation between Game Logic (AI) and Game Data (Human).

/  
├── index.html                  \# Entry point. Canvas setup and UI overlays.  
├── css/  
│   └── main.css                \# Global styles, UI positioning, responsive rules.  
├── assets/                     \# Initially all graphics and audio will be generated programmatically.  
│   ├── images/                 \# All graphical assets (sprites/placeholders).  
│   └── audio/                  \# SFX and music files.  
├── config/                     \# Game balance and content definitions.  
│   ├── items.json              \# Definitions of loot, weapons, and consumables.  
│   ├── enemies.json            \# Stats for monsters (HP, Damage, Sprite refs).  
│   ├── global.json             \# Game loop constants (tick rate, extraction times).  
│   └── networking.json         \# PeerJS and Database configuration keys.  
├── src/                        \# Game Logic and Source Code.  
│   ├── main.js                 \# Bootstrapper. Initializes Game and Network.  
│   ├── core/  
│   │   ├── GameLoop.js         \# Main update loop (fixed time step).  
│   │   ├── InputManager.js     \# Maps Keys/Touch to Intent (North, Attack, etc).  
│   │   └── EventEmitter.js     \# Pub/Sub system for decoupled communication.  
│   ├── systems/  
│   │   ├── GridSystem.js       \# Tile-based movement and collision logic.  
│   │   ├── CombatSystem.js     \# Damage calculation, death, and respawn logic.  
│   │   ├── LootSystem.js       \# Spawning, pickup, and inventory management.  
│   │   └── RenderSystem.js     \# Draws state to Canvas (supports placeholders/sprites).  
│   ├── network/  
│   │   ├── PeerClient.js       \# Wraps PeerJS for P2P lobby and data transport.  
│   │   └── SyncManager.js      \# Handles state serialization and interpolation.  
│   ├── services/  
│   │   └── Database.js         \# secure API calls to external DB (Save/Load).  
│   └── utils/  
│       └── AssetLoader.js      \# Preloads images/audio before game start.  
└── GDD.md                      \# This Game Design Document! Source of truth.

### **The Configuration Layer (`/config/*.json`)**

* **Rule:** The AI must treat these files as **Read-Only** sources of truth for gameplay values.  
* **Usage:** When creating a monster, do not hardcode `HP = 100`. Instead, read `enemies.json` and find the entry for that monster type.  
* **Benefit:** This allows the Human Developer to balance the game, add new swords, or change drop rates without modifying the codebase.

### **The Logic Layer (`/src/`)**

* **ES6 Modules:** All files must use `export default` or named exports. No inline scripts in HTML.  
* **State Management:**  
  * **Local State:** UI quirks, particles, animations.  
  * **Authoritative State:** Player coordinates, Health, Inventory. Only the **HOST** modifies this. Clients only visualize it.  
* **Graphics Agnosticism:** The `RenderSystem` should draw whatever image is assigned to an entity in the config. If `items.json` says "sword\_1.png", the code attempts to load that. This allows seamless transition from generated art to pixel art.

## **Network Architecture**

**Topology:** Host-Client Star Topology. One player acts as the authoritative Host (Server).

**Player Capacity:** 1 to 16 players per room.

**Room Management:** Decentralized matchmaking managed via 4-character room codes. No dedicated matchmaking server.

**Connection Protocol:**

1. Client connects to Host via PeerJS using the room code.  
2. Connection handshake initiated for validation and state synchronization.

**Host Authority:** The Host is authoritative for:

* Collision detection  
* Initial dungeon generation  
* Game state synchronization  
* Player elimination/monster respawn

## **Networking Constraints and Mitigation**

| Constraint | Mitigation Strategy |
| :---- | :---- |
| Low Bandwidth/Latency | **Global Cooldown:** All player-initiated actions (movement, attacks) are throttled by a **250ms global cooldown** (4 actions/second max). This time may be altered later, possibly 500ms instead? Requires testing for fun and balance. |
| Data Transfer Rate | **Input-Only Networking:** Only player inputs (e.g., move, attack) are transmitted, not regular full positional data. Target network rate is approx. **5-10Hz**. |
| Visual Smoothness | **Client Interpolation:** The client visually smooths movements between received Host state updates to prevent a choppy experience. |
| Host Dropouts | **Pause-and-Reconnect:** If the Host is lost, the game pauses. A new Host is auto-elected, and remaining players attempt to reconnect and resync state. |
| Fairness | **Host-Authoritative Collision:** The Host determines the definitive outcome of all collisions, attacks, and interactions to prevent client-side cheating. |

## **Reliability and Heartbeat**

**Heartbeat Monitoring:** The Host strictly monitors client heartbeats.

**Dropout Handling:** If a client fails the heartbeat check:

1. The Host sends a warning.  
2. If the connection is not restored quickly, the player is marked as disconnected and their character is left in-game (potential loot source).  
3. The Host attempts a **pause-and-reconnect strategy** before permanent removal.

# **Gameplay Mechanics**

## **Movement and Grid**

* **Movement Type:** Grid-based (e.g., moving one tile at a time).  
* **Input Throttle:** Movement and action inputs are subject to the 250ms global cooldown. Players cannot spam actions.

## **Combat**

* **Real-Time:** Combat is real-time, relying on player positioning and timing. Utilises traditional mechanics for a roguelike \- moving into an enemy performs a basic melee attack, but there’s also a dedicated button that triggers melee and ranged attacks.  
* **Abilities:** Players have a basic attack and 1-3 unique, cooldown-based abilities depending on their starting class/kit.  
* **Line of Sight:** Fog of war or restricted line of sight mechanic to limit awareness and encourage exploration/ambushes. Heavy dynamic lighting and shadow emphasis.

## **NPC Monsters**

Generic fantasy enemies\! Skeletons and Demons and Slimes. Boss enemies with better loot drops.

## **Player Monster Mechanic**

The Monster mechanic activates upon a player's first elimination:

1. **Elimination:** A player is defeated by another player or a monster.  
2. **Respawn:** The player chooses a Monster type, and respawns as that Monster unit at a random location away from survivors. They continue to respawn on defeat at different locations and can change type if desired.  
3. **Objective:** The Monster's goal is to attack and eliminate the remaining survivors, potentially earning a small amount if they succeed in damaging or killing a survivor.  
4. **No Extraction:** Monsters cannot extract and are fully dedicated to PvP.

## **Environment**

* **Procedural Dungeon:** Each game will generate a randomly laid out dungeon, including corridors, rooms, and other features. We will introduce rules to ensure the map is always playable and not impossible to complete.

## **Extraction**

* **Extraction Zone:** A dynamically placed zone appears near the end of a session, often tied to a timer or a major objective (e.g., killing a boss).  
* **Timer/Collapse:** Dungeons feature an end-game timer. When the timer runs out, the dungeon begins to collapse, forcing players towards the extraction zone. I hate giant circles, so I’m thinking a purple fire that spreads dynamically through corridors. Not instant death to touch, but still damaging.  
* **Success:** Players who reach the extraction zone with loot secure their items.

# **Game Progression and Systems**

## **Loot and Inventory**

Loot will include:

* **Weapons/Armor:** Equipable items with stat modifiers. Aiming to keep the game fast paced, so inventory management and equipment slots will be low.  
* **Consumables:** Potions, torches, potentially traps.  
* **Gold:** Primary resource that is only kept upon successful extraction.

## **Persistent Progression**

Persistent progression is linked to gold and allows players to:

* Unlock new starting gear, skills etc.  
* Purchase minor, persistent cosmetic items.  
* Acquire permanent, small quality-of-life upgrades (e.g., larger inventory size).

## **Interface**

All interface must be suitable for both playing on a web browser on both a PC and a Mobile device. For PC, the buttons will not be visible, but have the same functions.

**Non-Interactive:**

* **HP Bar**: Shows the players current HP.  
* **Mana Bar:** Shows the players current Mana.  
* **Gold:** Shows the players currently held Gold (ingame, not global).  
* **Torches:** Shows the players currently remaining torches (for extended light radius).

**Interactive:**

* **8-Way D-Pad**: Players and Monsters can move in 8 cardinal directions, and move 1 tile per action tied to the global cooldown.  
* **Attack Button**: Triggers your currently equipped weapon’s basic attack, either melee or ranged.  
* **1-3x Consumable Buttons**: Allows quick access to consumables, such as healing potions.  
* **Inventory Button:** Opens the players inventory / equipment panel.  
  * Etc etc etc