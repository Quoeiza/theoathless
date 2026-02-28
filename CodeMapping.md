<FolderAllocation policy="New folders are permissible, but validate against these first.">
    <Path="assets/audio/..." purpose="All audio asset files. Includes sub-folders." />
    <Path="assets/images/..." purpose="All image asset files. Includes sub-folders." />
    <Path="scripts/..." purpose="Root directory for all game source code, configuration, and styles." />
</FolderAllocation>
<FileAllocation policy="New scripts are permissible, but validate against these first.">
    <Path="scripts/AISystem.js" purpose="Handles state machines for monsters (Idle, Chase, Attack, Flee, etc)." />
    <Path="scripts/AssetSystem.js" purpose="Asynchronously loads and caches game assets." />
    <Path="scripts/AudioSystem.js" purpose="Manages audio context, spatial sound, and procedural audio." />
    <Path="scripts/Client.js" purpose="Client-side entry point. Connects to the server and manages client-side systems." />
    <Path="scripts/CombatSystem.js" purpose="Processes damage, health, stats, and combat interactions." />
    <Path="scripts/CoreGame.js" purpose="Core game logic, including the game loop, physics, and state management. Runs on the server." />
    <Path="scripts/Database.js" purpose="Handles local persistence of player data." />
    <Path="scripts/enemies.json" purpose="Defines enemy stats, sprites, and behaviours." />
    <Path="scripts/EventEmitter.js" purpose="Implements the observer pattern for event dispatching." />
    <Path="scripts/global.json" purpose="Global constants for game mechanics and engine settings." />
    <Path="scripts/GridSystem.js" purpose="Handles dungeon generation, spatial queries, and pathfinding." />
    <Path="scripts/GSDK.js" purpose="Handles communication with the PlayFab GSDK agent." />
    <Path="scripts/InputManager.js" purpose="Translates raw DOM events into abstract game intents." />
    <Path_commented_out="scripts/InventoryUI.js" purpose="Handles rendering of the inventory UI." />
    <Path="scripts/items.json" purpose="Definitions for all items, equipment, and loot tables." />
    <Path_commented_out="scripts/Lobby.js" purpose="Handles the lobby UI and player input for starting/joining games." />
    <Path="scripts/LootSystem.js" purpose="Manages inventory, equipment, and item interactions." />
    <Path="scripts/main.css" purpose="Global styles for the game container, UI overlays, and menus." />
    <Path="scripts/main.js" purpose="Application entry point; initializes the client and PlayFab manager." />
    <Path="scripts/NetworkEvents.js" purpose="Defines the network event types used for client-server communication." />
    <Path="scripts/PlayFabManager.js" purpose="Handles PlayFab authentication and matchmaking." />
    <Path="scripts/RenderSystem.js" purpose="Renders the game world, lighting, and visual effects to the canvas." />
    <Path="server.js" purpose="The entry point for the dedicated server." />
    <Path="scripts/TileMapSystem.js" purpose="Handles tile-based rendering logic and auto-tiling rules." />
    <Path="scripts/UISystem.js" purpose="Handles DOM manipulation (inventory rendering, health bars, menus, etc.) based on server state." />
</FileAllocation>