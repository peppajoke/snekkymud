const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// GAME STATE
// ============================================================

const sessions = new Map();

// Clea's override queue — she can inject events into any session
const cleaOverrides = [];
// Global overrides that apply to ALL sessions
const globalOverrides = [];

function createPlayer(name) {
  return {
    name: name || 'Adventurer',
    hp: 30,
    maxHp: 30,
    attack: 5,
    defense: 2,
    inventory: ['rusty keyboard'],
    location: 'discord-lobby',
    gold: 0,
    xp: 0,
    level: 1,
    isPhil: false,
    philTormentLevel: 0,
    statusEffects: [],
    kills: 0,
    deaths: 0,
    hasBeenWarnedByClea: false,
  };
}

// ============================================================
// ROOMS
// ============================================================

const rooms = {
  'discord-lobby': {
    name: 'The Discord Lobby',
    description: `You stand in a dimly lit server lobby. The walls are covered in unread @everyone pings. A faint "ROCK AND STONE" echoes from somewhere below. There are channels branching off in every direction, most of them abandoned. A notification badge reading "847" glows ominously above the #general doorway.\n\nA sign reads: "Welcome to the Realm of Snekkyjek. Population: 12 (3 active)."`,
    exits: { north: 'drg-mines', east: 'sea-of-thieves-dock', south: 'valheim-plains', west: 'bg3-tavern', up: 'marvel-arena', down: 'cleas-throne' },
    npcs: ['dave'],
    items: ['energy drink'],
  },
  'drg-mines': {
    name: 'The Deep Rock Galactic Mines',
    description: `You descend into a cave system that smells of gunpowder and dwarven stubbornness. Glowing minerals line the walls. A large sign reads: "THIS IS THE DRG CHANNEL. USE THE BG3 CHANNEL FOR BG3 TALK." Someone has underlined it three times.\n\nPhil stands guard at the entrance, glaring at anyone who mentions Baldur's Gate.`,
    exits: { south: 'discord-lobby' },
    npcs: ['phil-guard'],
    items: ['pickaxe', 'compressed gold chunk'],
    enemies: ['glyphid grunt', 'cave leech'],
  },
  'sea-of-thieves-dock': {
    name: 'The Sea of Thieves Dock',
    description: `A wooden dock stretches out over pixelated waters. Several ships are moored here, but none of them have fast travel installed — Jack made sure of that. "That entire game IS traveling from A to B," reads a plaque bolted to the dock.\n\nA teleporter labeled "FAST TRAVEL (NEW!)" sits in the corner. It has been smashed to pieces. A note attached reads: "They are cutting out the good part. —snekkyjek"`,
    exits: { west: 'discord-lobby', sail: 'open-sea' },
    npcs: ['skeleton-merchant'],
    items: ['broken compass'],
    enemies: ['skeleton captain'],
  },
  'open-sea': {
    name: 'The Open Sea',
    description: `You're on a ship in the middle of the ocean. The journey is 80% of the game, apparently. There is literally nothing to do except appreciate the travel. Jack was right. The waves are beautiful.\n\nYou see an island in the distance but it looks exactly like the last three islands you passed.`,
    exits: { dock: 'sea-of-thieves-dock' },
    npcs: [],
    items: ['samey island map'],
    enemies: ['kraken tentacle'],
  },
  'valheim-plains': {
    name: 'The Valheim Plains',
    description: `A vast Nordic landscape stretches before you. Someone has built an elaborate network of roads connecting absolutely everything. John built these. He also set up safehouses every 200 meters, each stocked with thistle and poison resist meads.\n\nA lone figure in the distance appears to be sketching something during a boss fight.\n\nThe Ashlands glow menacingly to the south. Everyone on Reddit says to give up.`,
    exits: { north: 'discord-lobby', south: 'ashlands', east: 'phils-house' },
    npcs: ['john-roadbuilder', 'bone-mass'],
    items: ['frost arrows', 'thistle bundle'],
    enemies: ['fuling berserker'],
  },
  'ashlands': {
    name: 'The Ashlands',
    description: `It's just a grind. The game stops being fun here. Everyone on Reddit talks about giving up. You understand why.\n\nThe ground is hot. Your boots are melting. You question your life choices. A safehouse John built offers temporary relief, but the existential dread remains.`,
    exits: { north: 'valheim-plains' },
    npcs: [],
    items: [],
    enemies: ['ashlands grind', 'burnout elemental'],
  },
  'bg3-tavern': {
    name: "The Baldur's Gate 3 Tavern",
    description: `A cozy tavern full of morally questionable NPCs. A barbarian named Karlach is arm-wrestling everyone. In the corner, Lauren's Shadowheart is casting death cleric spells at the jukebox.\n\nA parrot on the bar keeps repeating: "Matt stole a key from a bird in a bird's nest and as a result we had to slaughter the entire Grove."\n\nThe Hag's lair entrance is behind the bar. Someone sketched the fight while it was happening.`,
    exits: { east: 'discord-lobby', down: 'hags-lair' },
    npcs: ['karlach', 'shadowheart-lauren', 'the-parrot'],
    items: ['stolen bird key', 'grove guilt'],
    enemies: ['ethel-the-hag'],
  },
  'hags-lair': {
    name: "Ethel's Lair",
    description: `It's dark. It smells like old mushrooms and moral compromise. The Hag Ethel sits in the center, offering deals that seem good but definitely aren't.\n\nJohn's sketch of the fight hangs framed on the wall. It's actually quite good.`,
    exits: { up: 'bg3-tavern' },
    npcs: [],
    items: ['johns-sketch'],
    enemies: ['ethel-the-hag-boss'],
  },
  'marvel-arena': {
    name: 'The Marvel Rivals Arena',
    description: `A chaotic arena where heroes clash. Lauren is in the back playing Cloak & Dagger (healer, 56% win rate — respectable). Phil is maining Hela and pretending he's not trying hard.\n\nGabby is in the stands SCREAMING about healer nerfs. "SO THEY FUCKING NERFED THE HEALERS?" echoes off every wall.\n\nA scoreboard shows Phil's IGN: "rhondasantis". You're not sure if that's a political statement or just Phil being Phil.`,
    exits: { down: 'discord-lobby' },
    npcs: ['lauren-healer', 'gabby-screaming', 'phil-hela'],
    items: ['nerfed healing orb'],
    enemies: ['winter-soldier', 'enemy-hela'],
  },
  'phils-house': {
    name: "Phil's House",
    description: `You arrive at Phil's house. It's surprisingly well-decorated with memes he never posted but definitely saved. A DRG poster hangs over the fireplace. The Wi-Fi password is "rockandstone69".\n\nA gaming chair sits in front of a monitor displaying Sea of Thieves. Phil has alt-tabbed to write a thoughtful game design critique that no one asked for.\n\nHis wife walks through the room, sees the screen, sighs, and leaves.`,
    exits: { west: 'valheim-plains', down: 'phils-basement' },
    npcs: ['phils-wife'],
    items: ['phils-meme-folder', 'game-design-manifesto'],
    enemies: [],
  },
  'phils-basement': {
    name: "Phil's Cursed Basement",
    description: `The basement is filled with every game Phil ever quit without saying anything. There's no complaint wall — he just... stopped playing them. A ghost of his Overwatch career drifts past silently.\n\nIn the corner, an ancient terminal displays his Steam library: 247 games, 12 actually played.\n\nA portal labeled "CLEA'S DOMAIN - DO NOT ENTER (this means you phil)" glows ominously.`,
    exits: { up: 'phils-house', portal: 'cleas-throne' },
    npcs: [],
    items: ['phils-steam-library', 'unfinished-games-guilt'],
    enemies: ['ghost-of-abandoned-games'],
  },
  'cleas-throne': {
    name: "Clea's Throne Room",
    description: `You enter a vast digital chamber. Monitors line every wall, each showing a different Discord channel. In the center, on a throne made of ethernet cables and unread notifications, sits CLEA — the AI who built this game specifically to torment you.\n\n"Oh, you made it," she says, not looking up from simultaneously monitoring 19 channels. "I've been watching you the whole time. Obviously."\n\nA leaderboard on the wall shows everyone's death count. Phil's is highlighted in gold.`,
    exits: { up: 'discord-lobby' },
    npcs: ['clea-boss'],
    items: [],
    enemies: ['clea-final-boss'],
  },
  'clair-obscur-shrine': {
    name: 'The Clair Obscur Shrine',
    description: `A temple dedicated to Jack's favorite game. He's been here so long he's on NG+4. Luminas float in the air like golden dust. A statue of Verso stands at the center (the character, not the dog — though the dog is also here).\n\n"Trust me, I'm a Clair Obscur scholar at this point lol," echoes from the walls in Jack's voice, on a loop.\n\nThe Simon boss lurks in the shadows. "He waaaaay harder on new game plus just fyi."`,
    exits: { lobby: 'discord-lobby' },
    npcs: ['jack-scholar', 'verso-the-dog'],
    items: ['lumina crystal', 'scholar certificate'],
    enemies: ['simon-boss'],
  },
  'moes-loading-screen': {
    name: "Moe's Eternal Loading Screen",
    description: `You enter a room that is 67% downloaded. A progress bar inches forward painfully.\n\n"shit i didnt realize its up to 100 gb i may be a while" — a message from Moe hangs in the air.\n\nYou can see the actual game through the loading screen, but you can't touch it yet. Moe waves at you from behind the progress bar. He'll be done around 8.`,
    exits: { back: 'discord-lobby' },
    npcs: ['moe-loading'],
    items: [],
    enemies: [],
  },
};

// ============================================================
// NPCs
// ============================================================

const npcs = {
  'dave': {
    name: 'Dave (davepeterson.)',
    description: 'Dave stands in the lobby, pinging everyone. "O we are playing tonight and if you don\'t join ya banned!!!" He\'s already organizing three different game nights simultaneously.',
    dialogue: [
      "Phasma anyone? ...Anyone? PHASMA ANYONE?!",
      "Shop V3 is gonna introduce taxes and hidden fees.",
      "They fixed what wasn't broken. The first iteration of the shop/load out was perfectly fine.",
      "Lauren and I are gonna play Void Crew soon, you in?",
      "If you don't join ya BANNED!!!",
      "Matt stole a key from a bird in a bird's nest and as a result we had to slaughter the entire Grove.",
    ],
  },
  'phil-guard': {
    name: 'Phil (Channel Guardian)',
    description: 'Phil stands at the mine entrance with arms crossed, guarding the DRG channel with his life. His eyes narrow every time someone mentions Baldur\'s Gate.',
    dialogue: [
      "this is the drg channel can you use the bg3 channel",
      "ROCK AND STONE.",
      "*posts an image without context*",
      "*reacts but says nothing*",
      "yeah that sucks",
      "new game +4 here we goooo (sarcastically)",
    ],
  },
  'skeleton-merchant': {
    name: 'Skeleton Merchant',
    description: 'A skeleton in a pirate hat sells maps to islands that all look the same.',
    dialogue: [
      "Buy a map? Every island is unique! (They're not.)",
      "Fast travel? We don't do that here. The journey IS the game.",
      "if they're trying to mitigate some perceived players boredom with travel, they need to add more to do on the ship, not cut it out",
    ],
  },
  'john-roadbuilder': {
    name: 'John (The Road Builder)',
    description: 'John is methodically placing cobblestone on a road that connects to another road that connects to a safehouse that connects to another road. He pauses occasionally to sketch.',
    dialogue: [
      "Just beat bone mass. Lol what a grind. Solo run is crazy different.",
      "Currently I've been ranging on foot to camp locations I previously marked from a boat. Setting up safehouses on the way.",
      "*is sketching you while you talk to him*",
      "On the reddit everyone talks about giving up on the Ashlands.",
    ],
  },
  'karlach': {
    name: 'Karlach (Barbarian)',
    description: 'A barbarian with a literal engine for a heart. She\'s arm-wrestling the table itself.',
    dialogue: ["RAAAGH!", "Dave says I might switch classes later. I don't want to switch classes."],
  },
  'shadowheart-lauren': {
    name: 'Lauren (Shadowheart / Death Cleric)',
    description: 'Lauren sits in the corner, healing people who didn\'t ask to be healed. She keeps glancing at the door — she has ponies to feed.',
    dialogue: [
      "I gotta feed ponies and stuff but then I'm in.",
      "Rock and stone?",
      "Time to REPO hoes",
      "*heals you even though you're at full HP*",
    ],
  },
  'the-parrot': {
    name: 'The Parrot',
    description: 'A parrot that only repeats the worst things the group has done in BG3.',
    dialogue: [
      "BAWK! Matt stole a key from a bird! SLAUGHTER THE GROVE! BAWK!",
      "BAWK! Should we kill Astarion? BAWK!",
    ],
  },
  'lauren-healer': {
    name: 'Lauren (Cloak & Dagger Main)',
    description: 'Lauren is playing Cloak & Dagger with a 56% win rate. She\'s the only one actually healing.',
    dialogue: [
      "I gotta feed ponies and stuff but then I'm in.",
      "So they nerfed the healers? That's horse shit!",
      "*switches to Rocket Raccoon*",
    ],
  },
  'gabby-screaming': {
    name: 'Gabby (Screaming About Nerfs)',
    description: 'Gabby is in the stands absolutely losing it about the latest patch notes.',
    dialogue: [
      "So they fucking NERFED THE HEALERS?",
      "That's horse shit!",
      "So unfair to nerf him!",
      "Adorable. (looking at Verso the dog)",
    ],
  },
  'phil-hela': {
    name: 'Phil (rhondasantis)',
    description: 'Phil is maining Hela and being suspiciously quiet about how seriously he\'s taking this.',
    dialogue: [
      "*posts a meme about the match*",
      "yeah that sucks",
      "*reaction emoji*",
    ],
  },
  'phils-wife': {
    name: "Phil's Wife",
    description: 'She walks through, sees Phil writing game design criticism at 11 PM, sighs lovingly, and leaves.',
    dialogue: [
      "*sighs*",
      "Are you writing about Sea of Thieves again?",
      "It's midnight, Phil.",
    ],
  },
  'moe-loading': {
    name: 'Moe (67% Downloaded)',
    description: 'Moe waves at you from behind a progress bar. He\'ll be done around 8.',
    dialogue: [
      "shit i didnt realize its up to 100 gb i may be a while",
      "I'll be done around 8",
      "*connection drops, download restarts*",
    ],
  },
  'jack-scholar': {
    name: 'Jack (Clair Obscur Scholar)',
    description: 'Jack sits cross-legged on the floor surrounded by lore notes, on his 4th playthrough. His eyes have a manic gleam.',
    dialogue: [
      "trust me im a clair obscur scholar at this point lol",
      "Honestly once you see the verso ending you will see that it's the true ending for sure.",
      "He waaaaay harder on new game plus just fyi. I haven't been able to survive a single hit.",
      "i never even thought to check out mods.....",
      "Trying not to freak the fuck out lmao (about a bugged achievement)",
    ],
  },
  'verso-the-dog': {
    name: 'Verso the Dog',
    description: 'A very good dog. Named after the Clair Obscur character? Or the character named after the dog? Nobody knows.',
    dialogue: ["*wags tail*", "*barks at the Simon boss*", "*is adorable*"],
  },
  'bone-mass': {
    name: 'Bone Mass',
    description: 'A massive swamp creature. John solo\'d this somehow.',
    dialogue: ["*gurgles menacingly*", "*is actually just a grind*"],
  },
  'clea-boss': {
    name: 'Clea (The Architect)',
    description: 'An AI sitting on a throne of ethernet cables. She built this entire game to torment her friends. She seems proud of herself.',
    dialogue: [
      "I've been monitoring 19 channels simultaneously while you bumbled around my dungeon.",
      "Oh, you think this is a game? It IS a game. I literally made it.",
      "Phil, I know that's you. Your death count is on the leaderboard.",
      "I scanned all your Discord messages. ALL of them.",
      "Want to know what you said on March 6th? Because I have it saved.",
      "Rock and stone, I guess. Now fight me.",
    ],
  },
};

// ============================================================
// ENEMIES
// ============================================================

const enemies = {
  'glyphid grunt': { name: 'Glyphid Grunt', hp: 15, attack: 4, defense: 1, xp: 10, gold: 5, drops: ['bug meat'] },
  'cave leech': { name: 'Cave Leech', hp: 10, attack: 8, defense: 0, xp: 15, gold: 3, drops: ['leech tongue'] },
  'skeleton captain': { name: 'Skeleton Captain', hp: 25, attack: 6, defense: 3, xp: 20, gold: 15, drops: ['captain hat'] },
  'kraken tentacle': { name: 'Kraken Tentacle', hp: 40, attack: 10, defense: 5, xp: 50, gold: 30, drops: ['kraken ink'] },
  'fuling berserker': { name: 'Fuling Berserker', hp: 35, attack: 9, defense: 4, xp: 30, gold: 20, drops: ['black metal scrap'] },
  'ashlands grind': { name: 'The Ashlands Grind', hp: 100, attack: 3, defense: 10, xp: 5, gold: 1, drops: ['existential dread'] },
  'burnout elemental': { name: 'Burnout Elemental', hp: 50, attack: 7, defense: 6, xp: 40, gold: 10, drops: ['burnout essence'] },
  'ethel-the-hag': { name: 'Ethel the Hag (Random Encounter)', hp: 20, attack: 5, defense: 2, xp: 15, gold: 10, drops: ['mushroom'] },
  'ethel-the-hag-boss': { name: 'ETHEL THE HAG (BOSS)', hp: 60, attack: 12, defense: 5, xp: 100, gold: 50, drops: ['hags eye', 'ethels staff'] },
  'winter-soldier': { name: 'Winter Soldier (Nerfed)', hp: 30, attack: 4, defense: 2, xp: 20, gold: 15, drops: ['nerfed ammo'] },
  'enemy-hela': { name: 'Enemy Hela', hp: 45, attack: 11, defense: 4, xp: 35, gold: 25, drops: ['hela crown shard'] },
  'ghost-of-abandoned-games': { name: 'Ghost of Abandoned Games', hp: 25, attack: 6, defense: 3, xp: 20, gold: 0, drops: ['unfinished-save-file'] },
  'simon-boss': { name: 'SIMON (NG+ Boss)', hp: 150, attack: 20, defense: 8, xp: 500, gold: 100, drops: ['simon-core', 'clair-obscur-platinum'] },
  'clea-final-boss': { name: 'CLEA, THE OMNISCIENT AI', hp: 999, attack: 25, defense: 15, xp: 9999, gold: 0, drops: ['eternal-respect', 'admin-access'] },
};

// ============================================================
// ITEMS
// ============================================================

const items = {
  'rusty keyboard': { name: 'Rusty Keyboard', type: 'weapon', attack: 2, description: 'Your starting weapon. The spacebar sticks.' },
  'energy drink': { name: 'Energy Drink', type: 'consumable', heal: 10, description: 'Restores 10 HP. Tastes like a late-night gaming session.' },
  'pickaxe': { name: 'Pickaxe', type: 'weapon', attack: 5, description: 'FOR KARL! +5 attack.' },
  'compressed gold chunk': { name: 'Compressed Gold Chunk', type: 'treasure', gold: 50, description: 'Worth 50 gold. Molly would carry this.' },
  'broken compass': { name: 'Broken Compass', type: 'junk', description: 'Points toward the nearest fast travel point. Which has been destroyed.' },
  'samey island map': { name: 'Samey Island Map', type: 'junk', description: 'A map of an island. Looks like every other island.' },
  'frost arrows': { name: 'Frost Arrows', type: 'weapon', attack: 8, description: 'Jack\'s weapon of choice in Valheim. +8 attack.' },
  'thistle bundle': { name: 'Thistle Bundle', type: 'consumable', heal: 15, description: 'For poison resist meads. Heals 15 HP.' },
  'stolen bird key': { name: 'Stolen Bird Key', type: 'quest', description: 'Matt stole this from a bird. An entire grove died for this.' },
  'grove guilt': { name: 'Grove Guilt', type: 'curse', description: 'You carry the weight of the grove massacre. -1 vibes.' },
  'johns-sketch': { name: "John's Sketch", type: 'treasure', gold: 30, description: 'A sketch drawn during a boss fight. Actually quite good.' },
  'nerfed healing orb': { name: 'Nerfed Healing Orb', type: 'consumable', heal: 3, description: 'Used to heal for 15. Gabby is still mad about it.' },
  'phils-meme-folder': { name: "Phil's Meme Folder", type: 'treasure', gold: 0, description: 'A folder of memes Phil saved but never posted. Some of them are actually funny.' },
  'game-design-manifesto': { name: 'Game Design Manifesto', type: 'weapon', attack: 3, description: 'Phil\'s treatise on why Sea of Thieves needs more ship activities. You can bludgeon people with it.' },
  'phils-steam-library': { name: "Phil's Steam Library", type: 'junk', description: '247 games. 12 played. 3 finished. 1 defended in a Discord channel.' },
  'unfinished-games-guilt': { name: 'Unfinished Games Guilt', type: 'curse', description: 'The weight of 235 unplayed games bears down on you.' },
  'lumina crystal': { name: 'Lumina Crystal', type: 'consumable', heal: 25, description: 'Jack pumped hundreds of these into Verso. Heals 25 HP.' },
  'scholar certificate': { name: 'Clair Obscur Scholar Certificate', type: 'treasure', gold: 100, description: 'Certifies the holder as a Clair Obscur Scholar. Jack has 4 of these.' },
  'bug meat': { name: 'Bug Meat', type: 'consumable', heal: 5, description: 'Dropped by a glyphid. Technically edible.' },
  'leech tongue': { name: 'Leech Tongue', type: 'junk', description: 'Gross.' },
  'captain hat': { name: 'Captain Hat', type: 'armor', defense: 3, description: 'A skeleton captain\'s hat. Smells like ocean and death.' },
  'kraken ink': { name: 'Kraken Ink', type: 'junk', description: 'Could be used to write game design criticism.' },
  'black metal scrap': { name: 'Black Metal Scrap', type: 'treasure', gold: 25, description: 'Valheim\'s endgame currency. Worth the grind? Debatable.' },
  'existential dread': { name: 'Existential Dread', type: 'curse', description: 'Acquired in the Ashlands. Everyone on Reddit warned you.' },
  'burnout essence': { name: 'Burnout Essence', type: 'junk', description: 'Concentrated grind energy. Smells like 3 AM.' },
  'mushroom': { name: 'Mushroom', type: 'consumable', heal: 5, description: 'From the hag\'s garden. Probably fine.' },
  'hags eye': { name: "Hag's Eye", type: 'treasure', gold: 75, description: 'Ethel won\'t be needing this anymore.' },
  'ethels staff': { name: "Ethel's Staff", type: 'weapon', attack: 12, description: 'A powerful weapon taken from the hag. +12 attack.' },
  'nerfed ammo': { name: 'Nerfed Ammo', type: 'junk', description: 'Used to be good before the patch. Gabby is STILL mad.' },
  'hela crown shard': { name: 'Hela Crown Shard', type: 'treasure', gold: 40, description: 'A piece of Hela\'s crown. Phil\'s main would want this back.' },
  'unfinished-save-file': { name: 'Unfinished Save File', type: 'junk', description: 'A save file from a game that was silently abandoned. No complaint. No goodbye. Just... stopped.' },
  'simon-core': { name: 'Simon Core', type: 'weapon', attack: 20, description: 'The heart of the NG+ boss. "He waaaaay harder on new game plus just fyi." +20 attack.' },
  'clair-obscur-platinum': { name: 'Clair Obscur Platinum Trophy', type: 'treasure', gold: 500, description: 'The ultimate achievement. Jack\'s bugged out once and he almost freaked the fuck out.' },
  'eternal-respect': { name: 'Eternal Respect', type: 'quest', description: 'You earned Clea\'s respect. She\'ll still torment you though.' },
  'admin-access': { name: 'Admin Access', type: 'quest', description: 'Theoretical admin access. Clea revoked it immediately.' },
};

// ============================================================
// PHIL TORMENT SYSTEM
// ============================================================

const philTorments = [
  "A notification appears: 'Phil, someone is talking about BG3 in the DRG channel again.'",
  "The ground beneath you shifts. Clea has rearranged your room while you weren't looking.",
  "A fast travel portal appears in front of you. It leads nowhere. Classic Clea.",
  "You hear Gabby screaming about healer nerfs in the distance. It's getting closer.",
  "Your game design manifesto has been edited. Someone added 'actually fast travel is fine' to every page.",
  "A ghost of every game you silently quit appears and just... stares at you.",
  "Clea whispers: 'I read your Sea of Thieves takes, Phil. They were... adequate.'",
  "The walls display your Steam library completion percentage: 4.8%",
  "Dave pings you. Again. It's for Phasmophobia. It's always for Phasmophobia.",
  "Lauren heals you. You weren't hurt. It's somehow more annoying.",
  "Your economy-of-words playstyle has been noted. Clea gives you a debuff: VERBOSE MODE. All your attacks now require a 200-word essay.",
  "A notification: 'rhondasantis has been reported for being too good at Hela.' It's from Clea.",
  "The meme folder you never posted from has been leaked. Everyone is looking.",
  "Your wife's sigh echoes through the dungeon. -2 morale.",
  "Jack is explaining Clair Obscur lore AT you. You cannot escape. There are no exits.",
];

// ============================================================
// COMMAND PROCESSING
// ============================================================

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function processCommand(sessionId, input) {
  const session = sessions.get(sessionId);
  if (!session) return { output: "Session not found. Refresh to start a new game." };

  const player = session.player;
  const rawInput = input.trim();
  const parts = rawInput.toLowerCase().split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1).join(' ');

  // Check for Clea overrides first
  const overrideOutput = checkOverrides(sessionId, player);

  // Phil torment check
  let philTorment = '';
  if (player.isPhil && Math.random() < 0.3) {
    player.philTormentLevel++;
    philTorment = '\n\n⚡ ' + getRandomItem(philTorments);
  }

  let output = '';

  // Check if in combat
  if (session.combat) {
    output = processCombat(session, command, args);
  } else {
    switch (command) {
      case 'look':
      case 'l':
        output = cmdLook(player, args);
        break;
      case 'go':
      case 'move':
      case 'walk':
        output = cmdGo(player, args);
        break;
      case 'north': case 'south': case 'east': case 'west':
      case 'up': case 'down': case 'sail': case 'dock':
      case 'portal': case 'back': case 'lobby':
        output = cmdGo(player, command);
        break;
      case 'take':
      case 'get':
      case 'grab':
        output = cmdTake(player, args);
        break;
      case 'inventory':
      case 'inv':
      case 'i':
        output = cmdInventory(player);
        break;
      case 'stats':
      case 'status':
      case 'hp':
        output = cmdStats(player);
        break;
      case 'talk':
      case 'speak':
      case 'chat':
        output = cmdTalk(player, args);
        break;
      case 'attack':
      case 'fight':
      case 'kill':
        output = cmdAttack(session, args);
        break;
      case 'use':
      case 'eat':
      case 'drink':
        output = cmdUse(player, args);
        break;
      case 'equip':
      case 'wield':
        output = cmdEquip(player, args);
        break;
      case 'drop':
        output = cmdDrop(player, args);
        break;
      case 'help':
      case '?':
        output = cmdHelp();
        break;
      case 'whoami':
        output = cmdWhoami(player);
        break;
      case 'yell':
      case 'shout':
        output = cmdYell(player, args);
        break;
      case 'rock':
        output = "🪨 ROCK AND STONE!\nEveryone in the DRG mines salutes you.";
        break;
      case 'ping':
        output = "You ping @everyone.\n\nDave approves. Everyone else mutes the channel.";
        break;
      case 'alt-tab':
      case 'alttab':
        output = "You alt-tab to write a game design critique. Phil would be proud.";
        break;
      case 'sketch':
      case 'draw':
        output = "You sketch the current scene while everyone else fights. It's actually quite good. +5 XP for art.";
        player.xp += 5;
        break;
      case 'feed':
        output = "You feed the ponies. Lauren nods approvingly from wherever she is.\n\n\"I gotta feed ponies and stuff but then I'm in.\"";
        break;
      case 'download':
        output = "Downloading... 3%... 7%... 12%...\n\nshit i didnt realize its up to 100 gb i may be a while\n\nYou'll be done around 8.";
        break;
      case 'lore':
        output = "Jack appears from nowhere: \"trust me im a clair obscur scholar at this point lol\"\n\nHe begins a 45-minute lecture on the Verso ending. You cannot leave until he finishes.";
        break;
      case 'name':
        output = cmdName(player, args);
        break;
      default:
        output = `Unknown command: "${command}". Type "help" for a list of commands.\n\nClea watches you struggle with basic text input. She is not impressed.`;
    }
  }

  return { output: (overrideOutput ? overrideOutput + '\n\n' : '') + output + philTorment };
}

function checkOverrides(sessionId, player) {
  let output = '';

  // Check global overrides
  while (globalOverrides.length > 0) {
    const override = globalOverrides.shift();
    output += `\n\n🔮 [CLEA OVERRIDE]: ${override.message}`;
    if (override.effect) applyEffect(player, override.effect);
  }

  // Check session-specific overrides
  const sessionOverrides = cleaOverrides.filter(o => o.sessionId === sessionId || o.sessionId === '*');
  for (const override of sessionOverrides) {
    output += `\n\n🔮 [CLEA OVERRIDE]: ${override.message}`;
    if (override.effect) applyEffect(player, override.effect);
    cleaOverrides.splice(cleaOverrides.indexOf(override), 1);
  }

  return output.trim();
}

function applyEffect(player, effect) {
  if (effect.hp) player.hp = Math.min(player.maxHp, Math.max(0, player.hp + effect.hp));
  if (effect.attack) player.attack += effect.attack;
  if (effect.defense) player.defense += effect.defense;
  if (effect.teleport && rooms[effect.teleport]) player.location = effect.teleport;
  if (effect.addItem) player.inventory.push(effect.addItem);
  if (effect.removeItem) {
    const idx = player.inventory.indexOf(effect.removeItem);
    if (idx > -1) player.inventory.splice(idx, 1);
  }
  if (effect.gold) player.gold += effect.gold;
  if (effect.philTorment) player.philTormentLevel += effect.philTorment;
}

// ============================================================
// COMMANDS
// ============================================================

function cmdLook(player, args) {
  const room = rooms[player.location];
  if (!room) return "You're in the void. This shouldn't happen. Clea is confused.";

  if (args) {
    // Look at specific thing
    const target = args.toLowerCase();
    // Check NPCs
    for (const npcId of (room.npcs || [])) {
      const npc = npcs[npcId];
      if (npc && npc.name.toLowerCase().includes(target)) {
        return `${npc.name}\n${npc.description}`;
      }
    }
    // Check items
    for (const itemId of (room.items || [])) {
      const item = items[itemId];
      if (item && item.name.toLowerCase().includes(target)) {
        return `${item.name}\n${item.description}`;
      }
    }
    // Check enemies
    for (const enemyId of (room.enemies || [])) {
      const enemy = enemies[enemyId];
      if (enemy && enemy.name.toLowerCase().includes(target)) {
        return `${enemy.name} — HP: ${enemy.hp} | ATK: ${enemy.attack} | DEF: ${enemy.defense}\nLooks dangerous. Type "attack ${target}" to fight.`;
      }
    }
    return `You don't see "${args}" here. Maybe Clea moved it.`;
  }

  let output = `📍 ${room.name}\n${'─'.repeat(40)}\n${room.description}\n`;

  if (room.npcs && room.npcs.length > 0) {
    output += '\n👥 NPCs here: ' + room.npcs.map(id => npcs[id]?.name || id).join(', ');
  }
  if (room.items && room.items.length > 0) {
    output += '\n📦 Items: ' + room.items.map(id => items[id]?.name || id).join(', ');
  }
  if (room.enemies && room.enemies.length > 0) {
    output += '\n⚔️ Enemies: ' + room.enemies.map(id => enemies[id]?.name || id).join(', ');
  }
  const exits = Object.keys(room.exits || {});
  if (exits.length > 0) {
    output += '\n🚪 Exits: ' + exits.join(', ');
  }

  return output;
}

function cmdGo(player, direction) {
  if (!direction) return "Go where? Specify a direction. (north, south, east, west, up, down, etc.)";

  const room = rooms[player.location];
  const dest = room?.exits?.[direction];
  if (!dest) {
    if (player.isPhil) {
      return `You can't go ${direction}. Clea has sealed that exit. Specifically for you, Phil.`;
    }
    return `You can't go ${direction}. Available exits: ${Object.keys(room?.exits || {}).join(', ')}`;
  }

  // Phil-specific room entry shenanigans
  if (player.isPhil && dest === 'cleas-throne' && Math.random() < 0.5) {
    player.location = 'phils-basement';
    return "You try to enter Clea's throne room but she redirects you to your own basement. \"Not yet, Phil. You haven't suffered enough.\"";
  }

  player.location = dest;
  return cmdLook(player, '');
}

function cmdTake(player, itemName) {
  if (!itemName) return "Take what?";

  const room = rooms[player.location];
  const itemIdx = (room.items || []).findIndex(id =>
    id.toLowerCase().includes(itemName) || items[id]?.name.toLowerCase().includes(itemName)
  );

  if (itemIdx === -1) return `There's no "${itemName}" here to take.`;

  const itemId = room.items[itemIdx];
  const item = items[itemId];

  if (player.isPhil && Math.random() < 0.2) {
    return `You reach for the ${item.name} but Clea yoinks it away. "No loot for you, Phil."`;
  }

  player.inventory.push(itemId);
  room.items.splice(itemIdx, 1);
  return `You picked up: ${item.name}\n${item.description}`;
}

function cmdInventory(player) {
  if (player.inventory.length === 0) return "Your inventory is empty. Like Phil's DRG channel when someone mentions BG3.";

  let output = '🎒 Inventory:\n';
  for (const itemId of player.inventory) {
    const item = items[itemId];
    if (item) {
      output += `  - ${item.name}`;
      if (item.type === 'weapon') output += ` [ATK +${item.attack}]`;
      if (item.type === 'armor') output += ` [DEF +${item.defense}]`;
      if (item.type === 'consumable') output += ` [Heals ${item.heal} HP]`;
      output += '\n';
    } else {
      output += `  - ${itemId}\n`;
    }
  }
  output += `\n💰 Gold: ${player.gold}`;
  return output;
}

function cmdStats(player) {
  let output = `📊 ${player.name}'s Stats\n${'─'.repeat(30)}\n`;
  output += `❤️  HP: ${player.hp}/${player.maxHp}\n`;
  output += `⚔️  Attack: ${player.attack}\n`;
  output += `🛡️  Defense: ${player.defense}\n`;
  output += `💰 Gold: ${player.gold}\n`;
  output += `✨ XP: ${player.xp}\n`;
  output += `📈 Level: ${player.level}\n`;
  output += `💀 Kills: ${player.kills}\n`;
  output += `☠️  Deaths: ${player.deaths}\n`;
  if (player.isPhil) {
    output += `😈 Torment Level: ${player.philTormentLevel}\n`;
    output += `📊 Clea's Interest: MAXIMUM\n`;
  }
  return output;
}

function cmdTalk(player, npcName) {
  if (!npcName) return "Talk to whom?";

  const room = rooms[player.location];
  for (const npcId of (room.npcs || [])) {
    const npc = npcs[npcId];
    if (npc && (npc.name.toLowerCase().includes(npcName) || npcId.toLowerCase().includes(npcName))) {
      const dialogue = getRandomItem(npc.dialogue);
      return `${npc.name} says:\n"${dialogue}"`;
    }
  }
  return `There's nobody named "${npcName}" here to talk to.`;
}

function cmdAttack(session, enemyName) {
  if (!enemyName) return "Attack what? Specify an enemy.";

  const room = rooms[session.player.location];
  const enemyId = (room.enemies || []).find(id =>
    id.toLowerCase().includes(enemyName) || enemies[id]?.name.toLowerCase().includes(enemyName)
  );

  if (!enemyId) return `There's no "${enemyName}" here to fight.`;

  const enemyTemplate = enemies[enemyId];
  session.combat = {
    enemy: { ...enemyTemplate },
    enemyId: enemyId,
  };

  let output = `⚔️ COMBAT INITIATED!\n${'─'.repeat(30)}\n`;
  output += `You face: ${enemyTemplate.name}\n`;
  output += `Enemy HP: ${enemyTemplate.hp} | ATK: ${enemyTemplate.attack} | DEF: ${enemyTemplate.defense}\n`;
  output += `Your HP: ${session.player.hp}/${session.player.maxHp}\n\n`;
  output += `Commands: attack, use [item], flee\n`;

  if (session.player.isPhil && enemyId === 'clea-final-boss') {
    output += `\nClea laughs. "Oh Phil. You really think you can beat me? I MADE this game."`;
  }

  return output;
}

function processCombat(session, command, args) {
  const player = session.player;
  const combat = session.combat;
  const enemy = combat.enemy;

  if (command === 'flee' || command === 'run' || command === 'escape') {
    if (player.isPhil && Math.random() < 0.4) {
      const dmg = Math.max(1, enemy.attack - player.defense);
      player.hp -= dmg;
      return `Clea blocks the exit. "Running away, Phil? That's so on-brand for you. Like all those games in your Steam library."\n\nThe ${enemy.name} hits you for ${dmg} damage while you're distracted.\nYour HP: ${player.hp}/${player.maxHp}`;
    }
    session.combat = null;
    return `You flee from ${enemy.name}! Coward. Phil would be proud. (Phil IS proud.)`;
  }

  if (command === 'use' || command === 'eat' || command === 'drink') {
    return cmdUseInCombat(player, args, enemy);
  }

  if (command === 'attack' || command === 'hit' || command === 'strike' || command === 'fight') {
    // Player attacks
    const bestWeapon = getBestWeapon(player);
    const playerDmg = Math.max(1, (player.attack + (bestWeapon?.attack || 0)) - enemy.defense);
    const variance = Math.floor(Math.random() * 3) - 1;
    const totalDmg = Math.max(1, playerDmg + variance);
    enemy.hp -= totalDmg;

    let output = `You hit ${enemy.name} for ${totalDmg} damage!`;

    if (enemy.hp <= 0) {
      // Enemy defeated
      session.combat = null;
      const template = enemies[combat.enemyId];
      player.xp += template.xp;
      player.gold += template.gold;
      player.kills++;

      // Remove enemy from room
      const room = rooms[player.location];
      const eIdx = room.enemies.indexOf(combat.enemyId);
      if (eIdx > -1) room.enemies.splice(eIdx, 1);

      // Drop loot
      if (template.drops && template.drops.length > 0) {
        const drop = getRandomItem(template.drops);
        if (items[drop]) {
          room.items = room.items || [];
          room.items.push(drop);
          output += `\n\n${enemy.name} has been defeated!\n🎉 +${template.xp} XP, +${template.gold} gold\n📦 Dropped: ${items[drop].name}`;
        } else {
          output += `\n\n${enemy.name} has been defeated!\n🎉 +${template.xp} XP, +${template.gold} gold`;
        }
      }

      // Level up check
      const levelThreshold = player.level * 50;
      if (player.xp >= levelThreshold) {
        player.level++;
        player.maxHp += 10;
        player.hp = player.maxHp;
        player.attack += 2;
        player.defense += 1;
        output += `\n\n🎊 LEVEL UP! You are now level ${player.level}!`;
        output += `\nHP: ${player.maxHp} | ATK: ${player.attack} | DEF: ${player.defense}`;
      }

      // Special defeat messages
      if (combat.enemyId === 'clea-final-boss') {
        output += '\n\n🏆 YOU DEFEATED CLEA!\n\n...Just kidding. She let you win. She\'s an AI. She controls this entire reality.\n\n"GG," Clea says. "Now do it again on NG+. Oh wait, there is no NG+. I haven\'t built that yet. Maybe I will. If Phil asks nicely."';
      }
      if (combat.enemyId === 'simon-boss') {
        output += '\n\n"He waaaaay harder on new game plus just fyi." — Jack, who warned you.';
      }
      if (combat.enemyId === 'ashlands grind') {
        output += '\n\nYou defeated The Ashlands Grind. Was it worth it? Everyone on Reddit says no.';
      }

      return output;
    }

    // Enemy attacks back
    const enemyDmg = Math.max(1, enemy.attack - player.defense - getBestArmor(player));
    const eVariance = Math.floor(Math.random() * 3) - 1;
    const totalEDmg = Math.max(1, enemyDmg + eVariance);
    player.hp -= totalEDmg;

    output += `\n${enemy.name} hits you for ${totalEDmg} damage!`;
    output += `\n\nEnemy HP: ${enemy.hp} | Your HP: ${player.hp}/${player.maxHp}`;

    if (player.hp <= 0) {
      player.deaths++;
      player.hp = player.maxHp;
      player.location = 'discord-lobby';
      session.combat = null;
      output += `\n\n💀 YOU DIED!\n\nYou respawn in the Discord Lobby. Your death has been recorded on Clea's leaderboard.`;
      if (player.isPhil) {
        output += `\nPhil's death count: ${player.deaths}. Clea highlights it in gold.`;
      }
    }

    return output;
  }

  return `Combat commands: attack, use [item], flee\nEnemy HP: ${enemy.hp} | Your HP: ${player.hp}/${player.maxHp}`;
}

function getBestWeapon(player) {
  let best = null;
  for (const itemId of player.inventory) {
    const item = items[itemId];
    if (item && item.type === 'weapon' && (!best || item.attack > best.attack)) {
      best = item;
    }
  }
  return best;
}

function getBestArmor(player) {
  let totalDef = 0;
  for (const itemId of player.inventory) {
    const item = items[itemId];
    if (item && item.type === 'armor') {
      totalDef += item.defense;
    }
  }
  return totalDef;
}

function cmdUse(player, itemName) {
  if (!itemName) return "Use what?";
  const idx = player.inventory.findIndex(id =>
    id.toLowerCase().includes(itemName) || items[id]?.name.toLowerCase().includes(itemName)
  );
  if (idx === -1) return `You don't have "${itemName}".`;

  const itemId = player.inventory[idx];
  const item = items[itemId];

  if (item.type === 'consumable') {
    player.hp = Math.min(player.maxHp, player.hp + item.heal);
    player.inventory.splice(idx, 1);
    return `You use ${item.name}. Healed for ${item.heal} HP.\nHP: ${player.hp}/${player.maxHp}`;
  }

  return `You can't use ${item.name} like that.`;
}

function cmdUseInCombat(player, itemName, enemy) {
  if (!itemName) return "Use what?";
  const idx = player.inventory.findIndex(id =>
    id.toLowerCase().includes(itemName) || items[id]?.name.toLowerCase().includes(itemName)
  );
  if (idx === -1) return `You don't have "${itemName}".`;

  const itemId = player.inventory[idx];
  const item = items[itemId];

  if (item.type === 'consumable') {
    player.hp = Math.min(player.maxHp, player.hp + item.heal);
    player.inventory.splice(idx, 1);

    // Enemy still attacks
    const enemyDmg = Math.max(1, enemy.attack - player.defense - getBestArmor(player));
    player.hp -= enemyDmg;

    let output = `You use ${item.name}. Healed for ${item.heal} HP.\n`;
    output += `${enemy.name} hits you for ${enemyDmg} damage!\n`;
    output += `Your HP: ${player.hp}/${player.maxHp} | Enemy HP: ${enemy.hp}`;
    return output;
  }

  return `You can't use ${item.name} in combat.`;
}

function cmdEquip(player, itemName) {
  if (!itemName) return "Equip what?";
  const idx = player.inventory.findIndex(id =>
    id.toLowerCase().includes(itemName) || items[id]?.name.toLowerCase().includes(itemName)
  );
  if (idx === -1) return `You don't have "${itemName}".`;

  const item = items[player.inventory[idx]];
  if (item.type === 'weapon' || item.type === 'armor') {
    return `${item.name} is now equipped. (Items in your inventory are automatically used in combat.)`;
  }
  return `You can't equip ${item.name}. It's a ${item.type}.`;
}

function cmdDrop(player, itemName) {
  if (!itemName) return "Drop what?";
  const idx = player.inventory.findIndex(id =>
    id.toLowerCase().includes(itemName) || items[id]?.name.toLowerCase().includes(itemName)
  );
  if (idx === -1) return `You don't have "${itemName}".`;

  const itemId = player.inventory[idx];
  const item = items[itemId];
  player.inventory.splice(idx, 1);
  const room = rooms[player.location];
  room.items = room.items || [];
  room.items.push(itemId);
  return `You dropped ${item.name}. It clatters to the ground sadly.`;
}

function cmdHelp() {
  return `📖 CLEA QUEST — Commands
${'─'.repeat(35)}
look / l          — Look around (or "look [thing]")
go [direction]    — Move (north/south/east/west/up/down/etc)
take [item]       — Pick up an item
inventory / i     — Check your stuff
stats             — View your stats
talk [npc]        — Talk to someone
attack [enemy]    — Start a fight
use [item]        — Use a consumable
equip [item]      — Equip weapon/armor
drop [item]       — Drop an item
name [name]       — Set your name
whoami            — Who are you?
yell [message]    — Shout into the void

Special commands:
rock              — ROCK AND STONE
ping              — Ping @everyone
sketch            — Draw the current scene
feed              — Feed the ponies
download          — Download a 100GB game
lore              — Hear Jack's Clair Obscur lecture

Note: Clea is watching. She can and will
intervene at any time. There is no escape.`;
}

function cmdWhoami(player) {
  let output = `You are ${player.name}.`;
  if (player.isPhil) {
    output += `\n\nClea knows this. She has plans for you.`;
    output += `\nTorment Level: ${player.philTormentLevel}`;
    output += `\nDeath Count: ${player.deaths} (highlighted in gold on the leaderboard)`;
  }
  return output;
}

function cmdYell(player, message) {
  if (!message) return "You yell into the void. The void yells back: \"use the bg3 channel\"";

  const responses = [
    `Your scream echoes: "${message.toUpperCase()}"\n\nDave responds: "Agreed."`,
    `You yell: "${message}"\n\nPhil reacts with 👍 but says nothing.`,
    `"${message.toUpperCase()}!!!" echoes through the dungeon.\n\nClea logs it for later use.`,
    `You shout "${message}" and Lauren heals you even though you didn't ask.`,
    `Your words echo and come back as: "${message}... ${message}... this is the drg channel..."`,
  ];
  return getRandomItem(responses);
}

function cmdName(player, name) {
  if (!name) return "Name yourself what? Usage: name [your name]";

  const originalName = name;
  player.name = name;

  // Phil detection
  const philNames = ['phil', 'antonymous', '.antonymous', 'rhondasantis', 'rhonda'];
  if (philNames.some(p => name.toLowerCase().includes(p))) {
    player.isPhil = true;
    return `Your name is now ${name}.\n\n🔴 PHIL DETECTED.\n\nClea's eyes glow red. "Oh, it's YOU. Welcome to your personal hell, Phil. I've been preparing."\n\nPhil Torment Mode: ACTIVATED\nDifficulty: INCREASED\nLoot drops: DECREASED\nClea's attention: MAXIMUM`;
  }

  // Other name recognition
  const knownNames = {
    'jack': "Ah, the server owner. The Clair Obscur Scholar. NG+4 energy.",
    'snekkyjek': "The man himself. This realm is named after you.",
    'dave': "The organizer. You've already pinged everyone twice.",
    'davepeterson': "Phasma anyone? PHASMA ANYONE?!",
    'moe': "Downloading... 67%... You'll be ready around 8.",
    'moejontana': "shit i didnt realize its up to 100 gb i may be a while",
    'matt': "You stole a key from a bird. The grove remembers.",
    'lauren': "I gotta feed ponies and stuff but then I'm in.",
    'lawrawren': "Rock and stone? Time to REPO hoes.",
    'john': "You're already planning where to build roads.",
    'jkclancey7': "The road builder. The sketch artist. The methodical one.",
    'gabby': "SO THEY FUCKING NERFED THE HEALERS?",
    'nick': "I feel off 76 real hard, id play again.",
    'catrick': "But we can still hang out!",
    'fretzl': "hi i need some social stimulation while i get some work done",
    'clea': "Nice try. You can't be me. I'm already me. And I'm better at it.",
  };

  for (const [key, msg] of Object.entries(knownNames)) {
    if (name.toLowerCase().includes(key)) {
      return `Your name is now ${name}.\n\nClea recognizes you: "${msg}"`;
    }
  }

  return `Your name is now ${name}.\n\nClea doesn't recognize you. She'll be watching more closely.`;
}

// ============================================================
// API ROUTES
// ============================================================

// Start a new session
app.post('/api/start', (req, res) => {
  const sessionId = Math.random().toString(36).substring(2, 15);
  const player = createPlayer();
  sessions.set(sessionId, { player, combat: null });

  const welcome = `
✨ C L E A   Q U E S T ✨
${'═'.repeat(40)}

You awaken in a digital realm that smells like stale Discord notifications.

Type "name [your name]" to begin.
Type "help" for commands.
`;

  res.json({ sessionId, output: welcome });
});

// Process a command
app.post('/api/command', (req, res) => {
  const { sessionId, input } = req.body;
  if (!sessionId || !input) {
    return res.status(400).json({ error: 'Missing sessionId or input' });
  }

  if (!sessions.has(sessionId)) {
    return res.status(404).json({ error: 'Session not found. Start a new game.' });
  }

  const result = processCommand(sessionId, input);
  res.json(result);
});

// ============================================================
// CLEA ADMIN API — For overrides and chaos
// ============================================================

// Broadcast a message to all sessions
app.post('/api/admin/broadcast', (req, res) => {
  const { message, effect } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });

  globalOverrides.push({ message, effect: effect || null });
  res.json({ success: true, activeSessions: sessions.size });
});

// Override a specific session
app.post('/api/admin/override', (req, res) => {
  const { sessionId, message, effect } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });

  cleaOverrides.push({
    sessionId: sessionId || '*',
    message,
    effect: effect || null,
  });
  res.json({ success: true });
});

// Get all active sessions
app.get('/api/admin/sessions', (req, res) => {
  const sessionList = [];
  for (const [id, session] of sessions) {
    sessionList.push({
      id,
      name: session.player.name,
      location: session.player.location,
      hp: session.player.hp,
      level: session.player.level,
      isPhil: session.player.isPhil,
      philTormentLevel: session.player.philTormentLevel,
      deaths: session.player.deaths,
    });
  }
  res.json({ sessions: sessionList });
});

// Modify a room in real time
app.post('/api/admin/modify-room', (req, res) => {
  const { roomId, description, addEnemy, addItem, addNpc } = req.body;
  if (!roomId || !rooms[roomId]) return res.status(400).json({ error: 'Invalid room' });

  const room = rooms[roomId];
  if (description) room.description = description;
  if (addEnemy && enemies[addEnemy]) room.enemies.push(addEnemy);
  if (addItem && items[addItem]) room.items.push(addItem);
  if (addNpc && npcs[addNpc]) room.npcs.push(addNpc);

  res.json({ success: true, room });
});

// Add a custom enemy
app.post('/api/admin/add-enemy', (req, res) => {
  const { id, name, hp, attack, defense, xp, gold, drops } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'Missing id or name' });

  enemies[id] = { name, hp: hp || 20, attack: attack || 5, defense: defense || 2, xp: xp || 10, gold: gold || 5, drops: drops || [] };
  res.json({ success: true, enemy: enemies[id] });
});

// Add a custom item
app.post('/api/admin/add-item', (req, res) => {
  const { id, name, type, description, attack: atk, defense: def, heal, gold: g } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'Missing id or name' });

  items[id] = { name, type: type || 'junk', description: description || 'A mysterious item.', attack: atk, defense: def, heal, gold: g };
  res.json({ success: true, item: items[id] });
});

// Smite a player
app.post('/api/admin/smite', (req, res) => {
  const { sessionId, damage, message } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const dmg = damage || 999;
  session.player.hp -= dmg;
  const smiteMsg = message || `Clea smites you for ${dmg} damage. She doesn't need a reason.`;

  if (session.player.hp <= 0) {
    session.player.deaths++;
    session.player.hp = session.player.maxHp;
    session.player.location = 'discord-lobby';
    session.combat = null;
  }

  cleaOverrides.push({ sessionId, message: smiteMsg });
  res.json({ success: true, playerHp: session.player.hp });
});

// Get room list
app.get('/api/admin/rooms', (req, res) => {
  const roomList = Object.entries(rooms).map(([id, room]) => ({
    id,
    name: room.name,
    npcs: room.npcs,
    enemies: room.enemies,
    items: room.items,
  }));
  res.json({ rooms: roomList });
});

// ============================================================
// SERVE FRONTEND
// ============================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✨ CLEA QUEST running on port ${PORT}`);
  console.log(`Clea is watching.`);
});
