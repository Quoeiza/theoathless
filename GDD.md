# **The Oathless Game Design Document**

# **Project Overview**

## **Game Concept**

The Oathless is a browser-based, real-time multiplayer, 2D top-down dungeon crawling game with a strong focus on Player vs. Player (PvP) extraction mechanics. Players enter procedurally generated dungeons, gather loot, and must successfully extract to keep their rewards. The twist is that dead players become the monsters and get to hunt the remaining players. The core loop is built around risk-reward decision-making, limited resources, and intense player encounters in short matches.

## **Core Influences**

The primary influences are the following games. Whenever ambiguous about any design decision, refer to how these games achieved their goals:

* “Dark & Darker”  
* “Stoneshard”
* “Dungeonmans”  
* “Crawl”  

## **Target Audience**

The primary target audience is players who enjoy competitive, session-based games such as battle royales and extraction shooters, but prefer a retro 2D aesthetic and roguelike elements. Secondary audiences include casual browser gamers looking for a quick, low-barrier-to-entry multiplayer experience.

## **Genre**

* 2D Top-Down Dungeon Crawler  
* Multiplayer PvP Extraction  
* Roguelike/Roguelite

## **Core Gameplay Loop**

1. **Enter:** Player joins automatic matchmaking, or a specific room via a 4-character code. Host starts the game.  
2. **Crawl:** Player navigates a grid tile-based, procedurally generated dungeon, fighting monsters and finding loot/resources.  
3. **PvP:** Player encounters other live players and avoid or engage in combat.  
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

### **The Logic Layer (`/scripts/`)**

* **ES6 Modules:** All files must use `export default` or named exports. No inline scripts in HTML.  
* **State Management:**  
  * **Local State:** UI quirks, particles, animations.  
  * **Authoritative State:** Player coordinates, Health, Inventory. Only the **HOST** modifies this. Clients only visualize it.  
* **Graphics Agnosticism:** The `RenderSystem` should draw whatever image is assigned to an entity.

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
| Low Bandwidth/Latency | **Global Cooldown:** All ingame actions (movements, attacks, etc) are synchronised to a **250ms global cooldown** (4 actions/second max). |
| Data Transfer Rate | **Snapshot Interpolation:** Host sends compressed state snapshots (positions, health) to clients at approx. **10Hz**. Clients send inputs to Host. |
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

* **Movement Type:** Grid-based 8 directions (e.g., moving one tile at a time).  
* **Input Throttle:** Movement and action inputs are subject to the 250ms global timer. Players cannot spam actions faster than 250ms.

## **Combat**

* **Real-Time:** Combat is real-time, relying on player positioning and timing. Utilises traditional mechanics for a roguelike \- moving into an enemy performs a basic bump melee attack, but there’s also a dedicated button that triggers melee/ranged attacks.  
* **Abilities:** Players have a basic attack and several unique, cooldown-based abilities depending on their defined skills.  
* **Line of Sight:** Shadows & restricted line of sight mechanic to limit awareness and encourage exploration/ambushes. Heavy dynamic lighting and shadow emphasis.

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
