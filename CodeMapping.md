<FolderAllocation policy="New folders are permissible, but validate against these first.">
    <Path="assets/audio/..." purpose="All audio asset files. Includes sub-folders." />
    <Path="assets/images/..." purpose="All image asset files. Includes sub-folders." />
    <Path="css/..." purpose="Stylesheets for game UI and layout." />
    <Path="src/..." purpose="Root directory for all game source code." />
    <Path="src/config/..." purpose="JSON configuration files defining game data and settings." />
    <Path="src/core/..." purpose="Low-level engine components for input, events, and the game loop." />
    <Path="src/network/..." purpose="Networking logic for multiplayer communication and state synchronization." />
    <Path="src/services/..." purpose="Services for data persistence and external interactions." />
    <Path="src/systems/..." purpose="Game logic modules handling specific domains (rendering, combat, grid, etc). File names must end in 'System'." />
    <Path="src/ui/..." purpose="User interface components and logic." />
    <Path="src/utils/..." purpose="Helper utilities." />
</FolderAllocation>
<FileAllocation policy="New scripts are permissible, but validate against these first.">
    <Path="css/main.css" purpose="Global styles for the game container, UI overlays, and menus." />
    <Path="src/config/enemies.json" purpose="Defines enemy stats, sprites, and behaviours." />
    <Path="src/config/global.json" purpose="Global constants for game mechanics and engine settings." />
    <Path="src/config/items.json" purpose="Definitions for all items, equipment, and loot tables." />
    <Path="src/config/networking.json" purpose="Configuration for PeerJS connection and STUN servers." />
    <Path="src/core/EventEmitter.js" purpose="Implements the observer pattern for event dispatching." />
    <Path="src/core/GameLoop.js" purpose="Controls the update cycle and render interpolation." />
    <Path="src/core/InputManager.js" purpose="Translates raw DOM events into abstract game intents." />
    <Path="src/core/Ticker.js" purpose="Controls tick rate and global time system." />
    <Path="src/main.js" purpose="Application entry point; initializes systems and manages global state." />
    <Path="src/network/PeerClient.js" purpose="Abstraction layer for WebRTC peer-to-peer connections." />
    <Path="src/network/SyncManager.js" purpose="Manages state snapshots and interpolation for network sync." />
    <Path="src/services/Database.js" purpose="Handles local persistence of player data." />
    <Path="src/systems/AISystem.js" purpose="Handles state machines for monsters (Idle, Chase, Attack, Flee, etc)." />
    <Path="src/systems/AssetSystem.js" purpose="Asynchronously loads and caches game assets." />
    <Path="src/systems/AudioSystem.js" purpose="Manages audio context, spatial sound, and procedural audio." />
    <Path="src/systems/CombatSystem.js" purpose="Processes damage, health, stats, and combat interactions." />
    <Path="src/systems/GridSystem.js" purpose="Handles dungeon generation, spatial queries, and pathfinding." />
    <Path="src/systems/LootSystem.js" purpose="Manages inventory, equipment, and item interactions." />
    <Path="src/systems/RenderSystem.js" purpose="Renders the game world, lighting, and visual effects to the canvas." />
    <Path="src/systems/TileMapSystem.js" purpose="Handles tile-based rendering logic and auto-tiling rules." />
    <Path="src/systems/UISystem.js" purpose="Handles DOM manipulation (inventory rendering, health bars, menus, etc)." />
</FileAllocation>