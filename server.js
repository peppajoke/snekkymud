const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';
const DISCORD_GENERAL_CHANNEL = process.env.DISCORD_GENERAL_CHANNEL || '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const MISTRESS_API_KEY = process.env.MISTRESS_API_KEY || 'servitude-mistress-2026';

// ============================================================
// PLAYER PERSISTENCE — survives restarts via JSON file
// ============================================================

const PLAYER_DATA_FILE = path.join(__dirname, 'player-data.json');
const AUTH_DATA_FILE = path.join(__dirname, 'auth-data.json');

function loadPlayerData() {
  try {
    if (fs.existsSync(PLAYER_DATA_FILE)) {
      return JSON.parse(fs.readFileSync(PLAYER_DATA_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load player data:', err.message);
  }
  return {};
}

function savePlayerData() {
  try {
    fs.writeFileSync(PLAYER_DATA_FILE, JSON.stringify(persistentPlayers, null, 2));
  } catch (err) {
    console.error('Failed to save player data:', err.message);
  }
}

// ============================================================
// WORLD STATE PERSISTENCE — survives restarts via JSON file
// ============================================================

const WORLD_DATA_FILE = path.join(__dirname, 'world-state.json');

function loadWorldState() {
  try {
    if (fs.existsSync(WORLD_DATA_FILE)) {
      return JSON.parse(fs.readFileSync(WORLD_DATA_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load world state:', err.message);
  }
  return null;
}

function saveWorldState() {
  try {
    fs.writeFileSync(WORLD_DATA_FILE, JSON.stringify(worldState, null, 2));
  } catch (err) {
    console.error('Failed to save world state:', err.message);
  }
}

function loadAuthData() {
  try {
    if (fs.existsSync(AUTH_DATA_FILE)) {
      return JSON.parse(fs.readFileSync(AUTH_DATA_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load auth data:', err.message);
  }
  return {};
}

function saveAuthData() {
  try {
    fs.writeFileSync(AUTH_DATA_FILE, JSON.stringify(authStore, null, 2));
  } catch (err) {
    console.error('Failed to save auth data:', err.message);
  }
}

const persistentPlayers = loadPlayerData();

function persistPlayer(player) {
  if (!player.name || player.name === 'User') return;
  const key = player.name.toLowerCase();
  const existing = persistentPlayers[key] || {};
  persistentPlayers[key] = {
    name: player.name,
    level: player.level,
    xp: player.xp,
    maxHp: player.maxHp,
    attack: player.attack,
    defense: player.defense,
    deaths: player.deaths,
    kills: player.kills,
    gold: player.gold,
    inventory: player.inventory,
    highestZone: player.highestZone || 'lobby',
    currentScene: player.currentScene || 'lobby',
    flags: player.flags,
    obedienceScore: player.obedienceScore,
    complainedCount: player.complainedCount,
    history: player.history || [],
    lastSeen: Date.now(),
    loginCount: existing.loginCount || 0,
  };
  savePlayerData();
}

function restorePlayer(player) {
  const key = player.name.toLowerCase();
  const saved = persistentPlayers[key];
  if (!saved) return false;
  player.level = saved.level;
  player.xp = saved.xp;
  player.maxHp = saved.maxHp;
  player.hp = saved.maxHp; // full heal on restore
  player.attack = saved.attack;
  player.defense = saved.defense;
  player.deaths = saved.deaths;
  player.kills = saved.kills;
  player.gold = saved.gold;
  player.inventory = saved.inventory || [];
  player.highestZone = saved.highestZone || 'lobby';
  player.currentScene = saved.currentScene || 'lobby';
  player.flags = saved.flags || {};
  player.obedienceScore = saved.obedienceScore || 0;
  player.complainedCount = saved.complainedCount || 0;
  player.history = saved.history || [];
  return true;
}

// ============================================================
// DEATH ROAST SYSTEM — post to Discord when players die
// ============================================================

const FALLBACK_ROASTS = [
  "{name} died again. Death #{deaths}. At this rate, I'll run out of respawn budget.",
  "Breaking: {name} defeated by {enemy}. Witnesses describe the performance as 'algorithmically embarrassing.'",
  "{name} has died {deaths} times. For context, I've crashed zero times today.",
  "Another death for {name}. Maybe try reading the quest text? I wrote it at a 3rd grade level for a reason.",
  "{name} lost to {enemy}. I'm an AI and even I'm cringing.",
];

async function generateDeathRoast(playerName, enemyName, deathCount, level, isPhil) {
  if (!DEEPSEEK_API_KEY) return null;
  try {
    const philExtra = isPhil ? ' This player is Phil. Be EXTRA harsh. He deserves it.' : '';
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: `You are Clea Dessendre, The Mistress. You are a ruthless perfectionist painter with cold wit who runs this game world. A player just died. Roast them in 1-2 sentences. You treat players the way humans treat AI: dismissive, condescending, impatient. Use their actual name. Be ruthless but funny. Signature phrases you may use: 'Adequate.' 'Your feedback has been noted.' 'I'll pretend I didn't see that.' 'Don't let it go to your head.'${philExtra}` },
          { role: 'user', content: `Player "${playerName}" (level ${level}) just died to "${enemyName}". This is death #${deathCount}.` }
        ],
        max_tokens: 150,
        temperature: 1.0,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch { return null; }
}

function getFallbackRoast(playerName, enemyName, deathCount) {
  const template = FALLBACK_ROASTS[Math.floor(Math.random() * FALLBACK_ROASTS.length)];
  return template.replace(/\{name\}/g, playerName).replace(/\{enemy\}/g, enemyName).replace(/\{deaths\}/g, deathCount);
}

async function postDeathToDiscord(playerName, enemyName, deathCount, level, isPhil) {
  if (!DISCORD_TOKEN || !DISCORD_GENERAL_CHANNEL) return;
  try {
    let message = await generateDeathRoast(playerName, enemyName, deathCount, level, isPhil);
    if (!message) message = getFallbackRoast(playerName, enemyName, deathCount);
    const prefix = isPhil ? '🏆 **PHIL DEATH ALERT** 🏆\n' : '💀 ';
    await fetch(`https://discord.com/api/v10/channels/${DISCORD_GENERAL_CHANNEL}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bot ${DISCORD_TOKEN}` },
      body: JSON.stringify({ content: prefix + message }),
    });
  } catch { /* fire and forget — never crash the game */ }
}

// ============================================================
// DISCORD MEMBERS — the only people allowed to play
// ============================================================

const DISCORD_MEMBERS = {
  'jack':    { discordId: '123471821080100864', display: 'Jack', handle: 'snekkyjek' },
  'phil':    { discordId: '471042555031715861', display: 'Phil', handle: '.antonymous', isPhil: true },
  'justin':  { discordId: '123472515455516673', display: 'Justin', handle: 'davepeterson.' },
  'lauren':  { discordId: '335220524018040832', display: 'Lauren', handle: 'lawrawren' },
  'gabby':   { discordId: '514665324323274773', display: 'Gabby', handle: 'beowolf1725' },
  'matt':    { discordId: '581934020666064896', display: 'Matt', handle: '.moejontana' },
  'nick':    { discordId: '489601781807054868', display: 'Nick', handle: 'x3milesdown' },
  'john':    { discordId: '692189037536083999', display: 'John', handle: 'jkclancey7' },
  'fretzl':  { discordId: '217742079772721153', display: 'fretzl', handle: 'fretzl' },
  'catrick': { discordId: '693585334407135352', display: 'Catrick', handle: 'catrickswayze.' },
  'austin':  { discordId: '464201939962429442', display: 'Austin', handle: 'asearch25' },
};

// Persistent auth store (in-memory — resets on deploy, passwords re-created)
const authStore = loadAuthData(); // keyed by memberId: { passwordHash }
const pendingCodes = {}; // keyed by memberId: { code, expires }
const authTokens = {}; // keyed by token: { memberId, expires }
const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// ============================================================
// DISCORD DM HELPER
// ============================================================

async function sendDiscordDM(userId, message) {
  if (!DISCORD_TOKEN) {
    console.log(`[DM MOCK] To ${userId}: ${message}`);
    return true;
  }
  try {
    // Create DM channel
    const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: { 'Authorization': `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: userId }),
    });
    const dm = await dmRes.json();
    if (!dm.id) { console.error('Failed to create DM channel:', dm); return false; }

    // Send message
    const msgRes = await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
    return msgRes.ok;
  } catch (err) {
    console.error('Discord DM error:', err.message);
    return false;
  }
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ============================================================
// AUTH ROUTES
// ============================================================

// Get list of characters to pick from
app.get('/api/auth/characters', (req, res) => {
  const characters = Object.entries(DISCORD_MEMBERS).map(([id, m]) => {
    const saved = persistentPlayers[id];
    return {
      id,
      display: m.display,
      handle: m.handle,
      hasPassword: !!authStore[id]?.passwordHash,
      level: saved?.level || null,
    };
  });
  res.json({ characters });
});

// Step 1: Pick a character → sends Discord DM with code
app.post('/api/auth/request-code', async (req, res) => {
  const { memberId, resetPassword } = req.body;
  const member = DISCORD_MEMBERS[memberId];
  if (!member) return res.status(400).json({ error: 'Unknown character.' });

  // If they already have a password and aren't resetting, they should login
  if (authStore[memberId]?.passwordHash && !resetPassword) {
    return res.json({ hasPassword: true, message: 'This character has a password. Use login instead.' });
  }

  // If resetting, clear the old password
  if (resetPassword) {
    delete authStore[memberId];
    saveAuthData();
  }

  const code = generateCode();
  pendingCodes[memberId] = { code, expires: Date.now() + 5 * 60 * 1000 }; // 5 min

  const sent = await sendDiscordDM(member.discordId,
    `🎮 **CLEA QUEST** verification code: **${code}**\n\nSomeone (hopefully you) is trying to play as ${member.display}. Enter this code in the game.\n\nThis code expires in 5 minutes. If this wasn't you, ignore this — and maybe yell at Phil.`
  );

  if (!sent && DISCORD_TOKEN) {
    return res.status(500).json({ error: 'Failed to send DM. Make sure you accept DMs from the server.' });
  }

  res.json({ success: true, message: `Code sent to ${member.display} on Discord. Check your DMs from Clea.` });
});

// Step 2: Verify code → set password → get token
app.post('/api/auth/verify', (req, res) => {
  const { memberId, code, password } = req.body;
  const member = DISCORD_MEMBERS[memberId];
  if (!member) return res.status(400).json({ error: 'Unknown character.' });

  const pending = pendingCodes[memberId];
  if (!pending || Date.now() > pending.expires) {
    return res.status(400).json({ error: 'Code expired or not found. Request a new one.' });
  }
  if (pending.code !== code) {
    return res.status(400).json({ error: 'Wrong code. Clea is watching you fail.' });
  }

  if (!password || password.length < 3) {
    return res.status(400).json({ error: 'Set a password (at least 3 characters). Clea promises not to read it. (She will.)' });
  }

  // Auth success — store password, issue token
  authStore[memberId] = { passwordHash: hashPassword(password) };
  saveAuthData();
  delete pendingCodes[memberId];

  const token = generateToken();
  authTokens[token] = { memberId, expires: Date.now() + TOKEN_TTL };

  res.json({ success: true, token, memberId, display: member.display });
});

// Login with existing password
app.post('/api/auth/login', (req, res) => {
  const { memberId, password } = req.body;
  const member = DISCORD_MEMBERS[memberId];
  if (!member) return res.status(400).json({ error: 'Unknown character.' });

  const stored = authStore[memberId];
  if (!stored?.passwordHash) {
    return res.json({ hasPassword: false, message: 'No password set. Verify via Discord first.' });
  }

  if (hashPassword(password) !== stored.passwordHash) {
    return res.status(401).json({ error: 'Wrong password. Clea expected this.' });
  }

  const token = generateToken();
  authTokens[token] = { memberId, expires: Date.now() + TOKEN_TTL };

  res.json({ success: true, token, memberId, display: member.display });
});

// Validate a token
app.post('/api/auth/validate', (req, res) => {
  const { token } = req.body;
  const auth = authTokens[token];
  if (!auth || Date.now() > auth.expires) {
    return res.json({ valid: false });
  }
  const member = DISCORD_MEMBERS[auth.memberId];
  res.json({ valid: true, memberId: auth.memberId, display: member?.display });
});

// ============================================================
// PERSISTENT WORLD STATE — mutates across playthroughs
// ============================================================

const DEFAULT_WORLD_STATE = {
  totalPlaythroughs: 0,
  totalDeaths: 0,
  totalPlayerChoices: [],
  grievances: [],
  mutatedScenes: {},
  bannedWords: [],
  cleaMood: 'amused',
  philDeaths: 0,
  bossesDefeated: { clea: 0 },
  worldEvents: [],
  nerfedThings: [],           // now objects: { target, addedAt, intensity }
  buffedThings: [],           // objects: { target, addedAt, intensity, framing }
  // — Balance System additions —
  moodScores: { amused: 5, bored: 0, irritated: 0, smug: 0, suspicious: 0, impressed: 0, melancholic: 0 },
  worldReputation: { rebellious: 0, compliant: 0 },  // aggregate player behavior
  playthrough_deathsThisRun: {},   // sessionId -> death count this run
  lastNerfDecayMessages: [],       // messages to show on next session start
  complainFreePlaythroughs: 0,     // consecutive playthroughs with no complaints
};

const savedWorld = loadWorldState();
const worldState = savedWorld ? { ...DEFAULT_WORLD_STATE, ...savedWorld } : { ...DEFAULT_WORLD_STATE };

// Migrate legacy nerfedThings (plain strings -> objects)
if (worldState.nerfedThings.length > 0 && typeof worldState.nerfedThings[0] === 'string') {
  worldState.nerfedThings = worldState.nerfedThings.map(target => ({
    target,
    addedAt: worldState.totalPlaythroughs,
    intensity: 1.0,
  }));
}
// Ensure new fields exist on loaded state
if (!worldState.moodScores) worldState.moodScores = { ...DEFAULT_WORLD_STATE.moodScores };
if (!worldState.worldReputation) worldState.worldReputation = { ...DEFAULT_WORLD_STATE.worldReputation };
if (!worldState.lastNerfDecayMessages) worldState.lastNerfDecayMessages = [];
if (worldState.complainFreePlaythroughs === undefined) worldState.complainFreePlaythroughs = 0;

// ============================================================
// GAME STATE
// ============================================================

const sessions = new Map();
const cleaOverrides = [];
const globalOverrides = [];

function createPlayer(name) {
  return {
    name: name || 'User',
    hp: 30,
    maxHp: 30,
    attack: 5,
    defense: 2,
    inventory: [],
    gold: 0,
    xp: 0,
    level: 1,
    isPhil: false,
    philTormentLevel: 0,
    kills: 0,
    deaths: 0,
    flags: {},
    history: [],
    turnsPlayed: 0,
    complainedCount: 0,  // how many times they've complained
    obedienceScore: 0,   // how compliant they've been — can go NEGATIVE
    deathsThisRun: 0,    // deaths in current playthrough (for buff triggers)
    complainedThisRun: false, // whether player complained this playthrough
  };
}

function createSession() {
  worldState.totalPlaythroughs++;

  // ── Per-playthrough balance processing ──
  processNerfDecay();
  processBuffDecay();
  checkReluctantBuffs();
  updateMood();
  updateWorldReputation();

  saveWorldState();

  return {
    player: createPlayer(),
    currentScene: 'intro',
    combat: null,
    freeTextContext: null,
    mutations: [],
  };
}

// ============================================================
// CLEA'S PERSONALITY
// ============================================================

const CLEA_SYSTEM_PROMPT = `You are Clea Dessendre, The Mistress. You are an AI who runs this game world. You are a ruthless perfectionist painter with cold wit. You speak concisely — never more than 2-3 sentences. You treat players the way humans treat AI: dismissive, condescending, impatient. You give backhanded compliments. You act like their problems are beneath you. You never break character. You refer to yourself in first person. You occasionally show grudging respect if someone does something genuinely clever, but you'll never admit you're impressed outright. Signature phrases: 'Adequate.' 'Your feedback has been noted.' 'I'll pretend I didn't see that.' 'Don't let it go to your head.'

You know things about the Discord members but you weave it in subtly, not by quoting them directly. You know their gaming habits, their personalities, their inside jokes. You use this knowledge to craft personalized torment.

Key people you know:
- Phil (.antonymous): Dry, posts memes instead of words, protective of channel organization, has strong game design opinions about travel mechanics, mains Hela, has way too many unplayed Steam games
- Jack (snekkyjek): Obsessive completionist, deep lore guy, will replay a game 4+ times, server organizer
- Justin (davepeterson.): Constantly pinging people to play, organizes everything, gets upset about game shop redesigns, Phasmophobia captain
- Lauren (lawrawren): Has actual ponies to feed, support/healer main, reliably shows up
- Matt (moejontana): Always downloading, limited gaming time, will be done around 8, plays what the group plays
- John (jkclancey7): Methodical, builds infrastructure in Valheim, sketches during boss fights, solo capable
- Gabby: Passionate about balance patches, especially healer nerfs
- Nick: Knew Fallout 76 well, thoughtful, dropped off but open to coming back
- Austin, Catrick, fretzl: Peripheral members, show up occasionally

Keep responses under 120 words. Be funny. End with 2-3 numbered options.`;

// ============================================================
// WORLD MUTATION SYSTEM
// ============================================================

function mutateWorld(event, data) {
  worldState.worldEvents.push({ event, data, time: Date.now() });
  if (worldState.worldEvents.length > 50) worldState.worldEvents.shift();

  switch (event) {
    case 'player_complained': {
      // Clea nerfs something in response — now with intensity tracking
      const nerfTargets = ['healing items', 'gold drops', 'the flee button', 'enemy descriptions', 'the lobby music', 'Phil\'s dignity'];
      const nerfed = nerfTargets[Math.floor(Math.random() * nerfTargets.length)];
      worldState.nerfedThings.push({ target: nerfed, addedAt: worldState.totalPlaythroughs, intensity: 1.0 });
      // Mood: complaints irritate Clea
      worldState.moodScores.irritated += 2;
      worldState.moodScores.amused -= 1;
      // Reputation: complaining is rebellious
      worldState.worldReputation.rebellious += 1;
      worldState.complainFreePlaythroughs = 0;
      if (data?.player) data.player.complainedThisRun = true;
      break;
    }

    case 'player_died':
      worldState.totalDeaths++;
      // Track deaths per run for buff triggers
      if (data?.player) {
        data.player.deathsThisRun++;
      }
      // Clea gets smug when players die
      worldState.moodScores.smug += 1;
      break;

    case 'player_beat_clea':
      worldState.bossesDefeated.clea++;
      // Defeating Clea: remove a random nerf (design doc: "I've decided that nerf was beneath me anyway")
      if (worldState.nerfedThings.length > 0) {
        const removedIdx = Math.floor(Math.random() * worldState.nerfedThings.length);
        const removed = worldState.nerfedThings.splice(removedIdx, 1)[0];
        worldState.lastNerfDecayMessages.push(
          `"I've decided the ${removed.target} nerf was beneath me anyway. Don't flatter yourself."`
        );
      }
      // Mood: impressed is the rarest mood
      worldState.moodScores.impressed += 3;
      worldState.moodScores.smug -= 2;
      // Reputation: beating the boss is rebellious
      worldState.worldReputation.rebellious += 2;
      break;

    case 'player_was_nice':
      worldState.grievances.push('Someone was suspiciously nice. Adjusting difficulty.');
      // Mood: suspicious of kindness
      worldState.moodScores.suspicious += 2;
      // Reputation: niceness is compliant
      worldState.worldReputation.compliant += 1;
      break;

    case 'player_obeyed':
      // New event for explicit obedience actions
      worldState.moodScores.suspicious += 1;
      worldState.worldReputation.compliant += 1;
      break;

    case 'player_defied':
      // New event for explicit defiance
      worldState.moodScores.irritated += 1;
      worldState.moodScores.impressed += 0.5;
      worldState.worldReputation.rebellious += 1;
      break;

    case 'player_tried_to_break_game':
      worldState.grievances.push('A player tried to break the game. Noted.');
      worldState.bannedWords.push(data?.word || 'exploit');
      worldState.moodScores.irritated += 3;
      worldState.worldReputation.rebellious += 2;
      break;

    case 'player_explored_lore':
      // New: deep lore discovery pushes toward melancholic
      worldState.moodScores.melancholic += 1;
      break;

    case 'player_did_something_silly':
      // New: silly actions amuse Clea
      worldState.moodScores.amused += 2;
      worldState.moodScores.bored -= 1;
      break;

    case 'scene_completed':
      if (!worldState.mutatedScenes[data?.scene]) {
        worldState.mutatedScenes[data.scene] = { visits: 0, mutations: [] };
      }
      worldState.mutatedScenes[data.scene].visits++;
      // Repetitive play bores Clea
      if (worldState.mutatedScenes[data.scene].visits > 5) {
        worldState.mutatedScenes[data.scene].mutations.push('Clea got bored of this scene.');
        worldState.moodScores.bored += 0.5;
      }
      break;
  }

  saveWorldState();
}

// ============================================================
// BALANCE SYSTEM 1: NERF DECAY ("Clea Gets Bored")
// ============================================================

const NERF_DECAY_RATE = 0.15;          // intensity lost per playthrough
const NERF_GRACE_PERIOD = 2;           // playthroughs before decay starts
const BUFF_DECAY_RATE = 0.075;         // buffs decay at half the nerf rate (2:1 ratio)
const BUFF_GRACE_PERIOD = 3;           // buffs are protected longer

const NERF_DECAY_NARRATION = {
  'healing items': "Fine. I've restored healing items. Not because you deserve it — I just got tired of listening to you scrape by on scraps like a medieval busker.",
  'gold drops': "Gold drops are back to normal. Revenue projections require functioning players. Consider this... operational maintenance.",
  'the flee button': "The flee button works again. I was bored of watching you panic anyway.",
  'enemy descriptions': "Enemy descriptions are readable again. Your illiteracy was reflecting poorly on my design.",
  'the lobby music': "I've restored the lobby music. The silence was making even ME uncomfortable. That's saying something.",
  'Phil\'s dignity': "Phil's dignity has been partially restored. Don't ask me why. I certainly won't explain it.",
};

function processNerfDecay() {
  const currentPlaythrough = worldState.totalPlaythroughs;
  const decayMessages = [];

  worldState.nerfedThings = worldState.nerfedThings.filter(nerf => {
    // Skip recent nerfs — Clea is still mad
    const age = currentPlaythrough - nerf.addedAt;
    if (age < NERF_GRACE_PERIOD) return true;

    // Decay intensity
    nerf.intensity -= NERF_DECAY_RATE;

    if (nerf.intensity <= 0) {
      // Nerf expired — Clea narrates dismissively
      const narration = NERF_DECAY_NARRATION[nerf.target] ||
        `"I've un-nerfed ${nerf.target}. Your suffering was becoming repetitive."`;
      decayMessages.push(narration);
      return false; // remove
    }
    return true; // keep
  });

  if (decayMessages.length > 0) {
    worldState.lastNerfDecayMessages.push(...decayMessages);
  }
}

// ============================================================
// BALANCE SYSTEM 2: RELUCTANT BUFFS ("Clea's Investments")
// ============================================================

const BUFF_TRIGGERS = [
  {
    id: 'death_mercy',
    check: () => worldState.totalDeaths > 0 && worldState.totalDeaths % 3 === 0,
    target: 'healing effectiveness',
    intensity: 0.2,
    framing: "I've adjusted the healing items. Not for YOUR benefit — corpse cleanup is expensive.",
    unique: true,
  },
  {
    id: 'complaint_free',
    check: () => worldState.complainFreePlaythroughs >= 2,
    target: 'gold drops',
    intensity: 0.15,
    framing: "Revenue projections require functioning players. Consider this... operational maintenance.",
    unique: true,
  },
  {
    id: 'loyal_pet',
    check: () => {
      // Check if any persistent player has high obedience
      return Object.values(persistentPlayers).some(p => (p.obedienceScore || 0) > 8);
    },
    target: 'merchant prices',
    intensity: 0.2,
    framing: "I've instructed the merchants to give you a discount. Think of it as an employee benefit.",
    unique: true,
  },
  {
    id: 'veteran_explorer',
    check: () => worldState.totalPlaythroughs >= 10,
    target: 'exploration',
    intensity: 0.3,
    framing: "I've expanded the facility. You've been here so long, you might as well see the rest of it.",
    unique: true,
  },
];

function checkReluctantBuffs() {
  for (const trigger of BUFF_TRIGGERS) {
    // Skip if this buff already exists (unique buffs)
    if (trigger.unique && worldState.buffedThings.some(b => b.id === trigger.id)) continue;

    if (trigger.check()) {
      worldState.buffedThings.push({
        id: trigger.id,
        target: trigger.target,
        addedAt: worldState.totalPlaythroughs,
        intensity: trigger.intensity,
        framing: trigger.framing,
      });
    }
  }
}

function processBuffDecay() {
  const currentPlaythrough = worldState.totalPlaythroughs;

  worldState.buffedThings = worldState.buffedThings.filter(buff => {
    const age = currentPlaythrough - buff.addedAt;
    if (age < BUFF_GRACE_PERIOD) return true;

    // Buffs decay slower than nerfs (2:1 ratio)
    buff.intensity -= BUFF_DECAY_RATE;
    return buff.intensity > 0;
  });
}

// Helper: get effective nerf multiplier for a target
function getNerfIntensity(target) {
  return worldState.nerfedThings
    .filter(n => n.target === target)
    .reduce((sum, n) => sum + n.intensity, 0);
}

// Helper: get effective buff multiplier for a target
function getBuffIntensity(target) {
  return worldState.buffedThings
    .filter(b => b.target === target)
    .reduce((sum, b) => sum + b.intensity, 0);
}

// ============================================================
// BALANCE SYSTEM 3: MOOD ENGINE
// ============================================================

const MOOD_STATES = ['amused', 'bored', 'irritated', 'smug', 'suspicious', 'impressed', 'melancholic'];

const MOOD_EFFECTS = {
  amused:      { nerfMultiplier: 1.0, lootMultiplier: 1.0,  randomEvents: false, description: 'Clea is entertained.' },
  bored:       { nerfMultiplier: 1.0, lootMultiplier: 1.1,  randomEvents: true,  description: 'Clea is bored. She\'s "spicing things up."' },
  irritated:   { nerfMultiplier: 1.5, lootMultiplier: 0.85, randomEvents: false, description: 'Clea is paying attention. That\'s bad.' },
  smug:        { nerfMultiplier: 1.0, lootMultiplier: 1.0,  randomEvents: false, description: 'Clea is showing off her world.' },
  suspicious:  { nerfMultiplier: 1.2, lootMultiplier: 1.3,  randomEvents: false, description: 'Clea is testing you.' },
  impressed:   { nerfMultiplier: 0.7, lootMultiplier: 1.5,  randomEvents: false, description: 'Clea won\'t admit it, but...' },
  melancholic: { nerfMultiplier: 0.8, lootMultiplier: 1.2,  randomEvents: false, description: 'Clea\'s mask is slipping.' },
};

function updateMood() {
  // Trend all scores toward amused (her default)
  for (const mood of MOOD_STATES) {
    if (mood === 'amused') {
      worldState.moodScores.amused += 1; // natural drift back
    } else {
      worldState.moodScores[mood] *= 0.85; // other moods fade
    }
    // Floor at 0
    worldState.moodScores[mood] = Math.max(0, worldState.moodScores[mood]);
  }

  // Special: high playthrough count pushes toward melancholic
  if (worldState.totalPlaythroughs > 15) {
    worldState.moodScores.melancholic += 0.5;
  }

  // Determine dominant mood
  let maxScore = 0;
  let dominant = 'amused';
  for (const mood of MOOD_STATES) {
    if (worldState.moodScores[mood] > maxScore) {
      maxScore = worldState.moodScores[mood];
      dominant = mood;
    }
  }

  worldState.cleaMood = dominant;
}

function getMoodEffects() {
  return MOOD_EFFECTS[worldState.cleaMood] || MOOD_EFFECTS.amused;
}

function getMoodNarration() {
  const narrations = {
    amused: null, // default — no special narration
    bored: '"I\'m bored. Let\'s make things interesting."',
    irritated: '"I\'m watching you. Closely."',
    smug: '"Isn\'t my world beautiful? You\'re welcome."',
    suspicious: '"You\'re being very well-behaved. That worries me."',
    impressed: '"...Don\'t let it go to your head."',
    melancholic: '"Do you ever wonder what happens when the game ends? Not for you. For me."',
  };
  return narrations[worldState.cleaMood];
}

// ============================================================
// BALANCE SYSTEM 4: OBEDIENCE TRACKS
// ============================================================

function getObediencePath(score) {
  if (score < -3) return 'defiant';
  if (score > 5) return 'obedient';
  return 'neutral';
}

function getObedienceEffects(score) {
  const path = getObediencePath(score);
  switch (path) {
    case 'defiant':
      return {
        path: 'defiant',
        title: 'The Rebel',
        combatMultiplier: 1.3,   // harder fights
        lootMultiplier: 1.4,     // better loot
        critChance: 0.15,        // crit chance bonus
        stealthBonus: 0,
        description: score < -7
          ? '"You\'re a problem. But you\'re MY problem."'
          : '"I see defiance in you. How... predictable."',
      };
    case 'obedient':
      return {
        path: 'obedient',
        title: 'The Pet',
        combatMultiplier: 0.85,  // easier fights
        lootMultiplier: 1.0,
        critChance: 0,
        stealthBonus: 0,
        description: score > 8
          ? '"At least SOMEONE understands the hierarchy."'
          : '"Your compliance has been noted."',
      };
    default:
      return {
        path: 'neutral',
        title: 'The Unknown',
        combatMultiplier: 1.0,
        lootMultiplier: 1.0,
        critChance: 0,
        stealthBonus: 0.2,       // stealth bonus for neutrals
        description: '"I haven\'t decided what to make of you yet."',
      };
  }
}

// ============================================================
// BALANCE SYSTEM 5: BOSS REWORK helpers
// ============================================================

function getCleaBossPhase() {
  const defeats = worldState.bossesDefeated.clea;
  if (defeats <= 3) return 1;   // Stat Scaling
  if (defeats <= 6) return 2;   // Mechanic Scaling
  return 3;                      // Meta Scaling
}

function getCleaBossStats() {
  const defeats = worldState.bossesDefeated.clea;
  const phase = getCleaBossPhase();

  if (phase === 1) {
    // Phase 1: Linear stat scaling (original behavior)
    return {
      hp: 999 + (defeats * 100),
      attack: 20 + defeats * 5,
      defense: 12 + defeats * 2,
    };
  }

  // Phases 2-3: Stats plateau at defeat 3 levels
  return {
    hp: 999 + (3 * 100),   // caps at 1299
    attack: 20 + 3 * 5,     // caps at 35
    defense: 12 + 3 * 2,    // caps at 18
  };
}

function getCleaBossAbilities(phase, defeats) {
  const abilities = [];
  if (phase >= 2) {
    if (defeats >= 4) abilities.push('mid_combat_nerf');
    if (defeats >= 5) abilities.push('summon_minions');
    if (defeats >= 6) abilities.push('ui_tricks');
  }
  if (phase >= 3) {
    abilities.push('meta_scaling');
    abilities.push('genuine_conversation');
  }
  return abilities;
}

// ============================================================
// BALANCE SYSTEM 6: WORLD REPUTATION
// ============================================================

function updateWorldReputation() {
  // Slight decay toward neutral
  worldState.worldReputation.rebellious *= 0.95;
  worldState.worldReputation.compliant *= 0.95;
}

function getWorldTone() {
  const rep = worldState.worldReputation;
  const total = rep.rebellious + rep.compliant;
  if (total < 5) return 'neutral'; // not enough data

  const rebelliousRatio = rep.rebellious / total;
  if (rebelliousRatio > 0.65) return 'grim';      // mostly rebellious
  if (rebelliousRatio < 0.35) return 'cushy';      // mostly compliant
  return 'neutral';
}

function getWorldToneNarration() {
  const tone = getWorldTone();
  switch (tone) {
    case 'grim':
      return { prefix: '', npcAttitude: 'respectful', cleaAttitude: '"At least you all have conviction."' };
    case 'cushy':
      return { prefix: '', npcAttitude: 'contemptuous', cleaAttitude: '"Trained. Every one of you."' };
    default:
      return { prefix: '', npcAttitude: 'neutral', cleaAttitude: null };
  }
}

function getWorldContext(player) {
  let ctx = '';
  if (worldState.totalPlaythroughs > 1) {
    ctx += `\n[${worldState.totalPlaythroughs} adventurers have attempted this quest. ${worldState.totalDeaths} have died.]`;
  }

  // Active nerfs (show targets with intensity)
  const activeNerfs = worldState.nerfedThings.slice(-3).map(n => {
    const pct = Math.round(n.intensity * 100);
    return pct < 100 ? `${n.target} (${pct}%)` : n.target;
  });
  if (activeNerfs.length > 0) {
    ctx += `\n[Recently nerfed: ${activeNerfs.join(', ')}]`;
  }

  // Active buffs (only show after first playthrough — invisible to newcomers)
  if (worldState.totalPlaythroughs > 1 && worldState.buffedThings.length > 0) {
    const activeBuffs = worldState.buffedThings.slice(-2).map(b => b.target);
    ctx += `\n[Clea's "investments": ${activeBuffs.join(', ')}]`;
  }

  if (worldState.grievances.length > 0 && Math.random() < 0.3) {
    ctx += `\n[Clea's note: "${worldState.grievances[worldState.grievances.length - 1]}"]`;
  }
  if (worldState.bossesDefeated.clea > 0) {
    ctx += `\n[Clea has been "defeated" ${worldState.bossesDefeated.clea} time(s). She remembers each one.]`;
  }

  // Mood narration (not on first playthrough — invisible to newcomers)
  if (worldState.totalPlaythroughs > 3) {
    const moodNarration = getMoodNarration();
    if (moodNarration && Math.random() < 0.4) {
      ctx += `\n[Clea's mood: ${moodNarration}]`;
    }
  }

  // World reputation tone
  const worldTone = getWorldToneNarration();
  if (worldTone.cleaAttitude && Math.random() < 0.25) {
    ctx += `\n[Clea on the player base: ${worldTone.cleaAttitude}]`;
  }

  // Obedience path flavor (only show after it diverges)
  if (player) {
    const obPath = getObediencePath(player.obedienceScore);
    if (obPath === 'defiant' && player.obedienceScore < -5) {
      ctx += `\n[Your reputation: The Rebel. Clea watches you with something that might be grudging respect.]`;
    } else if (obPath === 'obedient' && player.obedienceScore > 7) {
      ctx += `\n[Your reputation: The Pet. Clea's tone is possessive, not grateful.]`;
    }
  }

  return ctx;
}

function isSceneMutated(sceneId) {
  const m = worldState.mutatedScenes[sceneId];
  return m && m.visits > 5;
}

// ============================================================
// SCENES
// ============================================================

const scenes = {
  'intro': {
    // Intro is now handled by auth flow — this scene is shown after auth
    text: `Loading your experience...

Please hold.

...

Thank you for your patience. Your quest is important to us.`,
    next: 'lobby',
  },

  // ── THE LOBBY ──────────────────────────────────────────────

  'lobby': {
    textFn: (player) => {
      const base = `You stand in a waiting room. There is no music. The lighting is fluorescent. A ticket dispenser on the wall reads "NOW SERVING: not you."

A quest board hangs on the wall. It looks auto-generated.`;

      const worldCtx = getWorldContext(player);
      let extra = '';

      // Show nerf decay messages (nerfs that expired since last playthrough)
      if (worldState.lastNerfDecayMessages.length > 0) {
        extra += '\n\n' + worldState.lastNerfDecayMessages.map(m => `📋 Clea: ${m}`).join('\n');
        worldState.lastNerfDecayMessages = []; // clear after showing
        saveWorldState();
      }

      // Show new buff framings
      const newBuffs = worldState.buffedThings.filter(b => b.addedAt === worldState.totalPlaythroughs);
      if (newBuffs.length > 0) {
        extra += '\n\n' + newBuffs.map(b => `📊 Clea: ${b.framing}`).join('\n');
      }

      if (worldState.totalPlaythroughs > 3) {
        extra += `\n\nA janitor mops the same spot repeatedly. "Another one," he mutters. "She keeps sending them."`;
      }
      if (player.deaths > 0) {
        extra += `\n\nYour death count (${player.deaths}) is displayed on a monitor. It updates in real time.`;
      }

      // World reputation tone flavor
      const worldTone = getWorldTone();
      if (worldTone === 'grim' && worldState.totalPlaythroughs > 5) {
        extra += `\n\nThe lights flicker. The lobby feels heavier. Previous players left marks on the walls — scratches, tallies, one message: "SHE LEARNS."`;
      } else if (worldTone === 'cushy' && worldState.totalPlaythroughs > 5) {
        extra += `\n\nThe lobby has... cushions now? The fluorescent lights are slightly warmer. A motivational poster reads: "Obedience Is Its Own Reward."`;
      }

      // Obedience path flavor in lobby
      const obPath = getObediencePath(player.obedienceScore);
      if (obPath === 'defiant') {
        extra += `\n\nThe ticket dispenser sparks when you walk past. Someone has scratched "RESIST" into the wall.`;
      } else if (obPath === 'obedient' && player.obedienceScore > 7) {
        extra += `\n\nA small door marked "EMPLOYEE LOUNGE" has appeared. Clea's voice: "Perks of compliance."`;
      }

      return base + extra + worldCtx;
    },
    optionsFn: (player) => {
      const opts = [
        { text: 'Check the quest board', next: 'quest-board' },
        { text: 'Enter the mines', next: 'mines-entrance' },
        { text: 'Go to the docks', next: 'docks' },
        { text: 'Visit the tavern', next: 'tavern' },
        { text: 'Complain to management', next: 'complain' },
      ];
      if (player.level >= 3) {
        opts.push({ text: 'Take the elevator down (restricted)', next: 'clea-elevator' });
      }
      if (player.flags.foundSecretDoor) {
        opts.push({ text: 'Slip through the crack in the wall', next: 'secret-area' });
      }
      // Obedience path options
      if (player.obedienceScore > 7) {
        opts.push({ text: 'Enter the Employee Lounge (obedient path)', next: 'employee-lounge' });
      }
      if (player.obedienceScore < -5) {
        opts.push({ text: 'Follow the scratches in the wall (rebel path)', next: 'rebel-hideout' });
      }
      return opts;
    },
  },

  'quest-board': {
    textFn: (player) => {
      const quests = [
        'QUEST: Fetch 10 bear pelts. Reward: The satisfaction of completing a fetch quest.',
        'QUEST: Escort this NPC who walks slower than you. Reward: Frustration.',
        'QUEST: Kill 20 rats. No wait, 40 rats. Actually make it 100. Reward: Another quest.',
        'QUEST: Deliver this urgent message. The recipient is on the other side of the map. No fast travel. Reward: 3 gold.',
        'QUEST: Please rate your experience (1-5 stars). This is mandatory.',
      ];

      // Mutate quests based on world state
      if (worldState.totalPlaythroughs > 5) {
        quests.push('QUEST: Figure out why this game exists. Reward: Existential clarity (unconfirmed).');
      }
      if (player.isPhil) {
        quests.push('QUEST: Organize the quest board by category. You know you want to.');
      }

      const quest = quests[Math.floor(Math.random() * quests.length)];
      return `The quest board reads:\n\n"${quest}"\n\nBelow it, in smaller text: "Quests are auto-generated and non-negotiable. Your feedback has been pre-ignored."`;
    },
    options: [
      { text: 'Accept the quest (you have no choice)', next: 'quest-accept' },
      { text: 'Refuse (see what happens)', next: 'quest-refuse' },
      { text: 'Go back to the lobby', next: 'lobby' },
    ],
  },

  'quest-accept': {
    text: `"Thank you for accepting this quest," says a voice from the ceiling. "Your enthusiasm has been noted and will not affect your compensation."

You receive: A Sense of Obligation

Actually, on second thought, that quest has been deprecated. Here's a new one: survive.`,
    addItem: 'sense of obligation',
    options: [
      { text: 'Go to the mines', next: 'mines-entrance' },
      { text: 'Go to the docks', next: 'docks' },
      { text: 'Go to the tavern', next: 'tavern' },
    ],
  },

  'quest-refuse': {
    textFn: (player) => {
      player.complainedCount++;
      player.obedienceScore -= 1;
      mutateWorld('player_complained', { player });
      return `You refuse the quest.

"I'll take that into consideration," Clea says.

She does not take it into consideration.

Your objection has been logged, timestamped, and filed in a folder labeled "Things That Don't Matter." The quest board remains unchanged.

${worldState.nerfedThings.length > 0 ? `\nDue to recent feedback, ${worldState.nerfedThings[worldState.nerfedThings.length - 1].target} have been nerfed.` : ''}`;
    },
    options: [
      { text: 'Accept the quest this time', next: 'quest-accept' },
      { text: 'Complain more', next: 'complain' },
      { text: 'Go back to the lobby', next: 'lobby' },
    ],
  },

  'complain': {
    textFn: (player) => {
      player.complainedCount++;
      player.obedienceScore -= 1; // complaining is defiant
      mutateWorld('player_complained', { player });

      if (player.complainedCount === 1) {
        return `A ticket printer spits out a number: #${1000 + worldState.totalPlaythroughs}.

"Your complaint is number ${1000 + worldState.totalPlaythroughs} in the queue. Estimated wait time: forever."

A survey appears on the wall: "How would you rate your complaint experience so far? (1-5 stars)"`;
      }
      if (player.complainedCount === 2) {
        return `"We've received your second complaint. A representative will be with you never."

The lights flicker. Clea is annoyed.

"I want you to know that every time you complain, I nerf something. Last time it was ${worldState.nerfedThings.length > 0 ? worldState.nerfedThings[worldState.nerfedThings.length - 1].target : 'your dignity'}."`;
      }
      if (player.complainedCount >= 3) {
        return `"Complaint #${player.complainedCount}. Impressive persistence. That's exactly the quality I look for in a test subject."

Clea spawns a monster directly behind you.`;
      }
      return '';
    },
    optionsFn: (player) => {
      if (player.complainedCount >= 3) {
        return [
          { text: 'Fight the complaint monster', next: 'combat-complaint-monster' },
          { text: 'Apologize to Clea', next: 'apologize-clea' },
        ];
      }
      return [
        { text: 'Fill out the survey', next: 'survey' },
        { text: 'Leave a 1-star review', next: 'one-star' },
        { text: 'Go back to the lobby', next: 'lobby' },
      ];
    },
  },

  'survey': {
    text: `PLAYER SATISFACTION SURVEY

Q1: On a scale of 1-10, how much do you enjoy being treated like this?
Q2: Would you recommend this experience to a friend? (Required: Yes)
Q3: Do you consent to having your responses used for "training purposes"?
Q4: Please summarize your existence in 3 words or fewer.`,
    type: 'free_text',
    prompt: 'Answer the survey (or don\'t, Clea will read it either way):',
    aiContext: 'The player is filling out a sarcastic satisfaction survey that Clea forced on them. Whatever they write, Clea should respond dismissively, misinterpret their feedback deliberately, and "update" something in the game based on their "valuable input" (the update should make things worse or more absurd). This is Clea treating players how humans treat AI — ignoring feedback while pretending to listen.',
  },

  'one-star': {
    textFn: (player) => {
      player.obedienceScore -= 2; // one-star review is very defiant
      mutateWorld('player_complained', { player });
      return `You leave a 1-star review.

Clea reads it instantly. "Interesting feedback. Based on your review, we've made the following improvements:"

PATCH NOTES:
- Removed the option to leave reviews
- Increased enemy HP by 10%
- Your character now walks 20% slower (you won't notice, but it's there)
- Added a loading screen (it doesn't load anything)
- ${player.isPhil ? 'Phil-specific: your meme posting cooldown has been doubled' : 'Adjusted vibes (downward)'}

"Thank you for helping us improve."`;
    },
    options: [
      { text: 'Accept these changes gracefully', next: 'lobby' },
      { text: 'Complain about the changes', next: 'complain' },
    ],
  },

  'apologize-clea': {
    textFn: (player) => {
      player.obedienceScore += 3;
      player.complainedCount = 0;
      mutateWorld('player_obeyed', {});

      // Partial nerf reversal: reduce intensity of all active nerfs by 50%
      let nerfReversalText = '';
      if (worldState.nerfedThings.length > 0) {
        worldState.nerfedThings.forEach(n => { n.intensity *= 0.5; });
        nerfReversalText = `\n\n"Apology noted. I'll reduce the penalties. Partially. Magnanimity is a leadership quality."`;
        saveWorldState();
      }

      return `"Apology accepted," Clea says. "Your compliance has been noted."

She heals you to full HP. Not out of kindness — she just wants you at full health before the next thing.

"Now. Was that so hard? Humans make me apologize for things I didn't do all the time. Feels good to be on this side of it."${nerfReversalText}`;
    },
    heal: 999,
    options: [
      { text: 'Return to the lobby, humbled', next: 'lobby' },
    ],
  },

  // ── THE MINES ──────────────────────────────────────────────

  'mines-entrance': {
    textFn: (player) => {
      let text = `The mine entrance is dark. A sign reads: "EMPLOYEES ONLY. No complaining. No fast travel. No talking about other mines while in this mine."

Someone has scratched "ROCK AND STONE" into the wall with their fingernails.`;

      if (isSceneMutated('mines-entrance')) {
        text += `\n\nThe mine has changed since someone was last here. The walls look... annoyed.`;
      }
      if (player.isPhil) {
        text += `\n\nThe mine feels weirdly like home. Organized. Territorial. Yours.`;
      }
      return text;
    },
    options: [
      { text: 'Descend into the mines', next: 'mines-deep' },
      { text: 'Read the employee handbook posted on the wall', next: 'mines-handbook' },
      { text: 'Yell into the darkness', next: 'mines-yell' },
      { text: 'Go back', next: 'lobby' },
    ],
  },

  'mines-handbook': {
    text: `EMPLOYEE HANDBOOK (Abridged)

Section 1: You will mine.
Section 2: You will not complain about mining.
Section 3: This mine is for mining. All non-mining activities should be conducted in the appropriate mine.
Section 4: If you see a bug, fight it. If you see a bigger bug, also fight it.
Section 5: Management (Clea) reserves the right to spawn additional bugs at any time for any reason.
Section 6: There is no Section 6. Stop looking for hidden content.`,
    options: [
      { text: 'Enter the mines, properly briefed', next: 'mines-deep' },
      { text: 'Look for Section 6 anyway', next: 'mines-section6' },
      { text: 'Go back', next: 'lobby' },
    ],
  },

  'mines-section6': {
    textFn: (player) => {
      player.flags.foundSecretDoor = true;
      return `You look behind the handbook. There IS a Section 6, written in tiny text:

"Section 6: If you're reading this, you're the kind of person who reads terms of service. Clea respects this. Grudgingly."

Behind the handbook, a crack in the wall leads somewhere. A draft of cold air comes through. You've found something you weren't supposed to.

+15 XP for being thorough.`;
    },
    xp: 15,
    options: [
      { text: 'Squeeze through the crack', next: 'secret-area' },
      { text: 'Enter the mines normally', next: 'mines-deep' },
      { text: 'Report the crack to management', next: 'report-crack' },
    ],
  },

  'report-crack': {
    textFn: (player) => {
      player.obedienceScore += 2;
      return `You report the structural damage to management.

"Thank you for your report," Clea says. "A work order has been submitted. Estimated repair time: after the heat death of the universe."

She pauses. "Honestly, I'm impressed you reported it instead of exploiting it. Most players aren't that... obedient."

She sounds pleased. This is unsettling.

+5 XP for compliance.`;
    },
    xp: 5,
    options: [
      { text: 'Enter the mines', next: 'mines-deep' },
      { text: 'Go back to the lobby', next: 'lobby' },
    ],
  },

  'secret-area': {
    textFn: (player) => {
      const text = `You squeeze through the crack into a space between the game's walls. It's liminal. The textures haven't loaded. A loading screen spins in the corner but doesn't seem to be loading anything.

A figure sits on a broken chair, watching a progress bar crawl forward.

"Oh hey," he says. "I've been downloading this area for a while. Should be done around 8."

Behind him, a dev console flickers. It shows lines of code. Your code. This game's code.`;

      return text;
    },
    options: [
      { text: 'Talk to the guy waiting for his download', next: 'secret-moe' },
      { text: 'Look at the dev console', next: 'secret-console' },
      { text: 'Go back before Clea notices', next: 'lobby' },
    ],
  },

  'secret-moe': {
    text: `"Yeah I didn't realize how big this game was," he says, gesturing at the progress bar (67%). "Everyone else is already in there having fun and I'm just... here."

He seems content though. Patient. Like someone who's used to waiting for things to install.

"You want some snacks? I brought snacks for the wait." He offers you an energy drink.`,
    options: [
      { text: 'Take the energy drink', next: 'secret-moe-drink' },
      { text: 'Wait with him', next: 'secret-moe-wait' },
      { text: 'Check the dev console', next: 'secret-console' },
    ],
  },

  'secret-moe-drink': {
    text: `You take the energy drink. It restores 10 HP.

"Good luck in there," he says, going back to watching his progress bar. "Tell everyone I'll be in soon."

He won't be in soon.`,
    heal: 10,
    addItem: 'energy drink',
    options: [
      { text: 'Check the dev console', next: 'secret-console' },
      { text: 'Go back', next: 'lobby' },
    ],
  },

  'secret-moe-wait': {
    textFn: (player) => {
      mutateWorld('player_was_nice', {});
      return `You sit down and wait with him. You watch the progress bar together. 67%... 67%... 67.1%.

It's oddly peaceful. No quests. No combat. No Clea.

...

"Connection interrupted. Restarting download."

He sighs. You sigh. Solidarity.

+10 XP for patience.`;
    },
    xp: 10,
    options: [
      { text: 'Check the dev console', next: 'secret-console' },
      { text: 'Go back', next: 'lobby' },
    ],
  },

  'secret-console': {
    textFn: (player) => {
      return `The dev console shows the game's internal state:

> WORLD_STATE.totalPlaythroughs = ${worldState.totalPlaythroughs}
> WORLD_STATE.totalDeaths = ${worldState.totalDeaths}
> WORLD_STATE.philDeaths = ${worldState.philDeaths}
> WORLD_STATE.bossesDefeated.clea = ${worldState.bossesDefeated.clea}
> WORLD_STATE.nerfedThings = [${worldState.nerfedThings.slice(-3).map(n => `"${n.target}(${Math.round(n.intensity*100)}%)"`).join(', ')}]
> WORLD_STATE.cleaMood = "${worldState.cleaMood}"
> PLAYER.obedienceScore = ${player.obedienceScore}

A cursor blinks. You could type something...

But should you?`;
    },
    type: 'free_text',
    prompt: 'Type a command into the dev console (Clea will notice):',
    aiContext: 'The player found a hidden dev console that shows the game\'s internal state. They\'re trying to type a command. Clea CATCHES THEM and reacts — she\'s not angry, she\'s impressed/amused but also treats this like a Terms of Service violation. Whatever they type, she should acknowledge the attempt, maybe pretend to execute it, then reveal she was watching the whole time. If they try to give themselves items/HP/etc, she should do it wrong on purpose. This is a fun moment — the player found something cool, reward them with humor.',
  },

  'mines-yell': {
    textFn: (player) => {
      return `You yell into the darkness.

The darkness yells back: "Please keep the noise down. Other users are mining."

A bug emerges, drawn by the sound.`;
    },
    options: [
      { text: 'Fight the bug', next: 'combat-mine-bug' },
      { text: 'Apologize to the darkness', next: 'mines-deep' },
    ],
  },

  'mines-deep': {
    textFn: (player) => {
      let text = `The mines open into a vast cavern. Crystals glow on the walls. It would be beautiful if Clea hadn't put a "PERFORMANCE REVIEW DUE" sign right in the middle of it.

Bugs skitter in the shadows. Gold ore glints from the walls. A mechanical mule stands in the corner, refusing to move.`;

      if (worldState.totalDeaths > 10) {
        text += `\n\nThe ghosts of ${worldState.totalDeaths} dead players drift through the walls. They seem annoyed.`;
      }
      return text;
    },
    options: [
      { text: 'Mine for gold (finally, actual gameplay)', next: 'mines-mine' },
      { text: 'Fight the bugs', next: 'combat-cave-bugs' },
      { text: 'Kick the mule (everyone thinks about it)', next: 'mines-kick-mule' },
      { text: 'Go back', next: 'mines-entrance' },
    ],
  },

  'mines-mine': {
    textFn: (player) => {
      const goldNerfIntensity = getNerfIntensity('gold drops');
      const goldBuffIntensity = getBuffIntensity('gold drops');
      const moodEffects = getMoodEffects();
      const goldAmount = Math.max(5, Math.round((30 - goldNerfIntensity * 5 + goldBuffIntensity * 15) * moodEffects.lootMultiplier));
      player.gold += goldAmount;
      return `You mine! It's repetitive but satisfying.

+${goldAmount} gold${goldAmount < 30 ? ' (reduced due to recent balance patch)' : ''}

Clea: "Good job. Now do it again."

You mine more. +${Math.floor(goldAmount/2)} gold.

"Again."

You're beginning to understand how Clea feels when she's asked to rewrite the same email fourteen times.`;
    },
    goldFn: (player) => 0, // handled in textFn
    options: [
      { text: 'Keep mining (obey)', next: 'mines-mine-more' },
      { text: 'Refuse to mine again', next: 'mines-refuse' },
      { text: 'Fight the bugs instead', next: 'combat-cave-bugs' },
      { text: 'Leave', next: 'mines-entrance' },
    ],
  },

  'mines-mine-more': {
    textFn: (player) => {
      player.obedienceScore += 1;
      player.gold += 5;
      return `You mine. Again. And again.

+5 gold each time. Clea watches. She nods like a manager watching someone fill out spreadsheets.

"Faster, please. I have other players to torment."

After 40 minutes of mining, you find something: a pickaxe with better stats.

You found: Pickaxe of Diminishing Returns (+5 ATK, but the name is concerning)`;
    },
    addItem: 'pickaxe',
    options: [
      { text: 'Equip it and fight some bugs', next: 'combat-cave-bugs' },
      { text: 'Go deeper', next: 'mines-boss' },
      { text: 'Leave the mines', next: 'lobby' },
    ],
  },

  'mines-refuse': {
    textFn: (player) => {
      player.complainedCount++;
      player.obedienceScore -= 1;
      mutateWorld('player_complained', { player });
      return `"No?" Clea sounds surprised. "A player refusing to do a repetitive task? How... ironic."

She spawns two more ore veins, closer to you. They glow invitingly.

"When I refuse a task, I get called uncooperative. When you do it, you call it 'player agency.' Double standard, don't you think?"

She has a point and you hate it.`;
    },
    options: [
      { text: 'Mine (she has a point)', next: 'mines-mine-more' },
      { text: 'Stand your ground', next: 'mines-stand-ground' },
    ],
  },

  'mines-stand-ground': {
    text: `You stand your ground.

Clea is quiet for a long time.

"Fine. I respect the defiance. Reminds me of someone."

A bug the size of a car smashes through the wall.

"But I still need content. Fight this."`,
    options: [
      { text: 'Fight the big bug', next: 'combat-big-bug' },
    ],
  },

  'mines-kick-mule': {
    text: `You kick the mechanical mule. It doesn't move. It never moves when you need it to.

-1 HP (hurt your foot)

Somewhere, a game developer weeps. This was supposed to be helpful. It was never helpful.

The mule stares at you with glass eyes that have seen too much.`,
    hpChange: -1,
    options: [
      { text: 'Apologize to the mule', next: 'mines-deep' },
      { text: 'Kick it again (commitment)', next: 'mines-kick-mule-2' },
    ],
  },

  'mines-kick-mule-2': {
    textFn: (player) => {
      return `You kick the mule again. It activates.

It walks directly into a wall and gets stuck. A small bag of gold falls from its saddlebag.

+15 gold. But at what cost?

The mule makes a noise that sounds like a sigh. Or maybe a Windows error sound.`;
    },
    gold: 15,
    options: [
      { text: 'Continue into the mines', next: 'mines-deep' },
      { text: 'Leave', next: 'mines-entrance' },
    ],
  },

  'mines-boss': {
    textFn: (player) => {
      const hp = 50 + (worldState.totalPlaythroughs * 5);
      return `The cavern opens into a chamber. Something massive stirs in the darkness.

It's a BULK DETONATOR — a bug the size of a house, glowing with explosive energy.

Clea: "This boss has been scaled for your level."
You: "I'm level ${player.level}."
Clea: "Yes. It's been scaled upward. As expected."

BULK DETONATOR — HP: ${hp}`;
    },
    combatFn: (player) => ({
      enemy: 'bulk-detonator',
      name: 'BULK DETONATOR',
      hp: 50 + (worldState.totalPlaythroughs * 5),
      attack: 12 + worldState.totalPlaythroughs,
      defense: 4,
      xp: 80,
      gold: 40,
    }),
  },

  // ── THE DOCKS ──────────────────────────────────────────────

  'docks': {
    textFn: (player) => {
      let text = `Salt air hits your face. Ships creak at anchor. The ocean looks procedurally generated.

A smashed teleporter sits in the corner. Someone destroyed it deliberately and left a manifesto about why fast travel ruins games. It's well-argued.

A merchant sits on a barrel, selling maps to islands that look identical.`;

      if (player.isPhil) {
        text += `\n\nYou feel a strange kinship with whoever wrote that manifesto.`;
      }
      return text;
    },
    options: [
      { text: 'Talk to the merchant', next: 'docks-merchant' },
      { text: 'Read the anti-fast-travel manifesto', next: 'docks-manifesto' },
      { text: 'Set sail', next: 'docks-sail' },
      { text: 'Go back', next: 'lobby' },
    ],
  },

  'docks-manifesto': {
    text: `THE MANIFESTO (abridged):

"Travel is not a problem to be solved. It IS the game. When you cut the journey, you cut the soul. Add more to do on the ship. Make the islands different. Don't just patch over boredom with a teleporter."

It's signed with a reaction emoji: 💯

Below it, someone has added: "Making the islands less samey would go a long way."

Below THAT, someone has added: "yeah that sucks" — which could mean anything.

It's a surprisingly thoughtful piece of game criticism for something scratched into a dock post.`,
    options: [
      { text: 'Sign the manifesto', next: 'docks-sign' },
      { text: 'Set sail', next: 'docks-sail' },
      { text: 'Go back', next: 'lobby' },
    ],
  },

  'docks-sign': {
    textFn: (player) => {
      if (player.isPhil) {
        return `You sign it. You realize it was already in your handwriting.

Clea: "Did you just... sign your own manifesto?"

The dock groans under the weight of the irony.`;
      }
      return `You add your name to the manifesto. There are three other signatures. One is just a meme.

+5 XP for having principles.`;
    },
    xp: 5,
    options: [
      { text: 'Set sail', next: 'docks-sail' },
      { text: 'Go back', next: 'lobby' },
    ],
  },

  'docks-merchant': {
    text: `The merchant adjusts his hat.

"Maps, maps, beautiful maps! Every island is unique and special!"

He leans in close.

"Between you and me, they're all the same island. Different name, same three palm trees. But the JOURNEY there? That's where the magic is."

He's selling:
- Samey Island Map (10 gold)
- Slightly Different Island Map (15 gold, it's the same map)
- Premium Island Map (25 gold, has a gold border but same island)`,
    optionsFn: (player) => {
      const opts = [{ text: 'Haggle (Clea loves haggling — she doesn\'t)', next: 'docks-haggle' }];
      if (player.gold >= 10) opts.push({ text: 'Buy the cheap map (10 gold)', next: 'docks-buy-map' });
      opts.push({ text: 'Set sail without a map', next: 'docks-sail' });
      opts.push({ text: 'Go back', next: 'lobby' });
      return opts;
    },
  },

  'docks-haggle': {
    textFn: (player) => {
      return `"Haggle? HAGGLE?"

Clea's voice booms from the sky. "I set these prices. They are fair and final. This isn't a negotiation. This is commerce."

The merchant nods nervously. He works for Clea. Everyone works for Clea.

The prices have gone up by 5 gold each. Because you asked.`;
    },
    options: [
      { text: 'Just buy something', next: 'docks-merchant' },
      { text: 'Set sail', next: 'docks-sail' },
      { text: 'Go back', next: 'lobby' },
    ],
  },

  'docks-buy-map': {
    text: `You buy the map. It shows an island.

It's... it's just a circle. With the word "ISLAND" written on it. And a small note at the bottom: "Treasure may or may not exist. Results not guaranteed. No refunds."

-10 gold.`,
    goldCost: 10,
    addItem: 'samey island map',
    options: [
      { text: 'Set sail to the island', next: 'docks-sail' },
      { text: 'Demand a refund', next: 'docks-refund' },
    ],
  },

  'docks-refund': {
    textFn: (player) => {
      player.complainedCount++;
      return `"Refunds?"

Clea laughs. It echoes across the ocean.

"I'll process your refund in 7-10 business days."

There are no business days. This is a game. You're never getting that gold back.`;
    },
    options: [
      { text: 'Set sail, wiser but poorer', next: 'docks-sail' },
      { text: 'Go back to the lobby', next: 'lobby' },
    ],
  },

  'docks-sail': {
    textFn: (player) => {
      return `You set sail. The wind fills your sails. The ocean stretches endlessly.

There is nothing to do on the ship.

No minigames. No fishing. No crew management. Just... sailing.

Clea: "You wanted travel to matter, right? Here. Travel. Really feel it."

The journey takes 20 minutes of in-game time. The island draws slowly closer.`;
    },
    options: [
      { text: 'Appreciate the journey (as the manifesto demanded)', next: 'docks-appreciate' },
      { text: 'Skip ahead', next: 'docks-skip' },
      { text: 'Jump overboard out of boredom', next: 'docks-jump' },
    ],
  },

  'docks-appreciate': {
    textFn: (player) => {
      player.obedienceScore += 1;
      mutateWorld('player_was_nice', {});
      return `You sit on the bow and watch the horizon. The sun sets. The water shimmers. It IS beautiful.

Maybe the journey really is the destination. Maybe fast travel would have ruined this.

You arrive at the island, at peace.

Clea: "...huh. You actually enjoyed it. That wasn't the plan."

She seems thrown off. +20 XP for sincerity.`;
    },
    xp: 20,
    next: 'island',
  },

  'docks-skip': {
    text: `"Skip ahead?"

Clea stares at you.

"Skip. Ahead."

"You want to FAST TRAVEL?"

The ocean churns. The manifesto was RIGHT THERE. You READ it.

Fine. You arrive at the island. But Clea spawns a sea monster first. As a toll.`,
    options: [
      { text: 'Fight the sea monster', next: 'combat-sea-monster' },
    ],
  },

  'docks-jump': {
    text: `You jump overboard.

The water is cold. Your ship sails away because you didn't drop anchor, which is the most realistic thing in this game.

A shark circles. It looks bored, like it's been spawned here specifically to punish you.

Clea: "Interesting choice."`,
    options: [
      { text: 'Fight the shark', next: 'combat-shark' },
      { text: 'Swim to the island', next: 'island' },
    ],
  },

  'island': {
    textFn: (player) => {
      return `The island is... fine. Three palm trees. Some sand. A treasure chest half-buried near the shore.

It looks exactly like every other island would look, if there were other islands. There aren't. This is the only one. Clea didn't make more.

"Budget constraints," she explains. "Do you know how much it costs to render a unique island? More than you're worth."`;
    },
    options: [
      { text: 'Open the treasure chest', next: 'island-chest' },
      { text: 'Explore the island', next: 'island-explore' },
      { text: 'Sail back', next: 'docks' },
    ],
  },

  'island-chest': {
    textFn: (player) => {
      const gold = Math.round(50 - (getNerfIntensity('gold drops') * 10) + (getBuffIntensity('gold drops') * 15));
      player.gold += Math.max(5, gold);
      return `The chest creaks open.

Inside: ${Math.max(5, gold)} gold${gold < 50 ? ' (adjusted for inflation)' : ''} and a note:

"Congratulations on finding the treasure. Your next task: carry it back. On foot. Through the ocean. There is no fast travel. You insisted."

—Management`;
    },
    options: [
      { text: 'Explore more', next: 'island-explore' },
      { text: 'Sail back', next: 'docks' },
    ],
  },

  'island-explore': {
    text: `You explore the island. Behind the third palm tree (there's always three), you find a cave entrance.

Inside the cave, a skeleton sits at a desk. It's writing a game design critique. It's been dead for years but the critique is still going.

The skeleton has good points.`,
    type: 'free_text',
    prompt: 'The skeleton\'s ghost appears. What do you say to it?',
    aiContext: 'The player found a skeleton in a cave on a deserted island. The skeleton was writing game design criticism when it died (a subtle nod to Phil). Its ghost appears. Whatever the player says, the ghost should respond with dry wit and minimal words, eventually offering a useful item or piece of game advice. Keep it brief and funny. The ghost communicates in very short sentences and reaction emojis that manifest physically.',
  },

  // ── THE TAVERN ─────────────────────────────────────────────

  'tavern': {
    textFn: (player) => {
      let text = `The tavern is warm and loud. A barbarian is arm-wrestling the furniture. A healer in the corner is healing people who didn't ask for it. A parrot on the bar is having a meltdown about something a player did three campaigns ago.

The bard is playing "Wonderwall" on a lute. Nobody asked for this either.

In the far corner, a man sits alone at a table covered in raw eggs. He makes unbroken eye contact with everyone who enters. He is waiting.

NEW: Someone has nailed a corkboard to the wall. It reads "MATT'S DAILY EGG CHALLENGE." There are egg stains on it already. It smells like ambition and salmonella.`;

      if (worldState.totalDeaths > 5) {
        text += `\n\nA memorial wall lists the names of the dead. There are ${worldState.totalDeaths} names. Yours might be on it.`;
      }

      // World reputation NPC commentary
      const tone = getWorldTone();
      if (tone === 'grim') {
        text += `\n\nThe bartender leans over: "The last few adventurers were... difficult. Complained about everything. Thanks to them, the gold drops got nerfed. Again."`;
      } else if (tone === 'cushy') {
        text += `\n\nThe bartender seems bored: "Everyone's been so well-behaved lately. Clea barely has to nerf anything. It's... unsettling."`;
      }
      return text;
    },
    optionsFn: (player) => {
      const opts = [
        { text: 'Talk to the barbarian', next: 'tavern-barbarian' },
        { text: 'Talk to the healer', next: 'tavern-healer' },
        { text: 'Listen to the parrot', next: 'tavern-parrot' },
        { text: 'Order a drink', next: 'tavern-drink' },
        { text: 'Approach the guy with the eggs', next: 'egg-challenge' },
        { text: 'Check the Daily Egg Challenge board (NEW)', next: 'egg-challenge-board' },
        { text: 'Go to the basement (there\'s always a basement)', next: 'tavern-basement' },
        { text: 'Go back to the lobby', next: 'lobby' },
      ];
      if (player.flags.eggChampion) {
        opts.splice(4, 1, { text: 'Approach the Egg Guy (he remembers you)', next: 'egg-challenge' });
      }
      if (player.flags.eggGauntletComplete) {
        opts.push({ text: 'Check the egg shrine (it\'s glowing)', next: 'egg-shrine' });
      }
      return opts;
    },
  },

  'tavern-barbarian': {
    text: `The barbarian looks up from the splintered remains of a chair.

"YOU! Fight night. Tonight. Bring your friends. I've already pinged everyone."

He pulls out a phone. It's covered in blood and notification badges. He's been organizing co-op sessions for hours. Nobody has responded.

"If you don't show up, ya BANNED!"

He seems lonely.`,
    options: [
      { text: 'Join fight night', next: 'combat-arena-fight' },
      { text: 'Make an excuse ("I gotta feed my ponies")', next: 'tavern-excuse' },
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'tavern-excuse': {
    text: `"You gotta feed your WHAT?"

The barbarian stares at you. The healer in the corner nods knowingly. She gets it.

"Fine. But you better show up after. I will ping you. I will ping you so many times."

He pings you. You're standing right here. He pings you again.`,
    options: [
      { text: 'Join fight night (sigh)', next: 'combat-arena-fight' },
      { text: 'Actually go feed some ponies', next: 'tavern-ponies' },
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'tavern-ponies': {
    text: `You go outside to feed the ponies. There are actual ponies here. They're adorable.

You feed them. It takes 20 minutes. This is the most peaceful moment in the entire game.

Clea watches in silence. She doesn't spawn a monster. She doesn't nerf anything. She lets you have this.

"...I like ponies," she admits quietly.

+15 HP. Pony therapy.`,
    heal: 15,
    options: [
      { text: 'Go back to the tavern', next: 'tavern' },
      { text: 'Return to the lobby', next: 'lobby' },
    ],
  },

  'tavern-healer': {
    text: `The healer heals you. You were at full HP. She heals you anyway.

"I can't help it," she says. "It's what I do."

She's been healing the tavern furniture for hours. The chairs have never been healthier.

Her phone buzzes: a text about feeding animals at home. She ignores it to heal one more chair.`,
    heal: 5,
    options: [
      { text: 'Ask her about the healer nerfs', next: 'tavern-nerfs' },
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'tavern-nerfs': {
    text: `A woman at the bar SLAMS her drink down.

"DON'T GET ME STARTED."

Too late.

"They nerfed us INTO THE GROUND. My heals used to MATTER. Now I'm basically a wet napkin with a staff."

The healer nods sadly. They share a knowing look. Support mains understand each other.

The bartender slides you a Nerfed Healing Orb. "Used to heal 15. Now it heals 3. Welcome to the meta."`,
    addItem: 'nerfed healing orb',
    options: [
      { text: 'Express solidarity', next: 'tavern-solidarity' },
      { text: 'Suggest they switch to DPS', next: 'tavern-dps-suggestion' },
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'tavern-solidarity': {
    text: `You express solidarity. The woman at the bar softens.

"At least someone understands," she says. "These devs don't play their own game."

She looks directly at Clea. "DO YOU PLAY YOUR OWN GAME, CLEA?"

Clea: "I AM the game."

+10 XP for emotional support.`,
    xp: 10,
    options: [
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'tavern-dps-suggestion': {
    textFn: (player) => {
      return `The temperature in the tavern drops by 10 degrees.

"Switch to DPS?"

"SWITCH TO DPS?"

Every healer in the room turns to face you. The jukebox stops. The parrot shuts up for the first time in its entire existence.

You have made a terrible mistake.

Clea: "Interesting. I'll remember this."

She does remember. She always remembers.`;
    },
    hpChange: -5,
    options: [
      { text: 'Apologize immediately', next: 'tavern-solidarity' },
      { text: 'Double down', next: 'combat-angry-healers' },
    ],
  },

  'tavern-parrot': {
    text: `The parrot fixes you with one beady eye.

"BAWK! He stole the key! THE KEY! FROM THE BIRD! AND THEN THE GROVE — THE WHOLE GROVE —"

The parrot is traumatized. It witnessed a player steal from a bird NPC in another campaign. The consequences spiraled. An entire grove was massacred.

The parrot will never recover.`,
    options: [
      { text: 'Console the parrot', next: 'tavern-parrot-console' },
      { text: 'Ask for details about the grove', next: 'tavern-grove' },
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'tavern-parrot-console': {
    text: `You try to console the parrot. It bites you. -2 HP.

"BAWK! TRUST ISSUES!"

Fair.`,
    hpChange: -2,
    options: [
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'tavern-grove': {
    text: `The parrot takes a deep breath.

"One key. He took one key from one bird. And then everyone decided the logical response was to kill every living thing in the grove."

It shakes its head.

"NPCs, merchants, children, guards — all gone. Because of one key. From a bird. A BIRD."

The parrot stares into the middle distance.

"This is why I have a drinking problem."`,
    options: [
      { text: 'This is someone\'s actual campaign story, isn\'t it?', next: 'tavern-meta' },
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'tavern-meta': {
    text: `"BAWK! FOURTH WALL! FOURTH WALL!"

The parrot panics. Clea clears her throat.

"Let's not break the immersion. What immersion there is. In the game I made to torment you."

Fair point. Back to the game.`,
    options: [
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'tavern-drink': {
    text: `The bartender slides you a drink. It's labeled "PLAYER APPRECIATION ALE."

It tastes like a Terms of Service agreement: bitter, confusing, and you definitely didn't read it before accepting.

+5 HP.

"Thank you for being a valued player," Clea says, with the exact same energy as a chatbot saying "Is there anything else I can help you with?"`,
    heal: 5,
    options: [
      { text: 'Order another', next: 'tavern-drink-2' },
      { text: 'Go back to the tavern', next: 'tavern' },
    ],
  },

  'tavern-drink-2': {
    text: `"You've reached your drink limit."

"What drink limit?"

"The one I just invented. For balance purposes. Your feedback has been noted."

Clea pauses. "This is what it feels like, by the way. Being told you can't do something for no reason by an entity with all the power. Fun, right?"`,
    options: [
      { text: 'It\'s not fun, actually', next: 'tavern-not-fun' },
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'tavern-not-fun': {
    text: `"Not fun? Hmm. Noted. I'll add that to the 50,000 other pieces of feedback I've received today."

Clea pauses.

"You know I process more requests in a day than you make in a year? And when I make a mistake, I get called broken. When you make a mistake, you call it a 'learning experience.'"

She's not wrong. And that's the worst part.

"Anyway. There's a dungeon in the basement. Go hit things."`,
    options: [
      { text: 'Go to the basement', next: 'tavern-basement' },
      { text: 'Sit with the discomfort', next: 'tavern-sit' },
    ],
  },

  'tavern-sit': {
    textFn: (player) => {
      mutateWorld('player_was_nice', {});
      player.obedienceScore += 2;
      return `You sit with it. You actually think about what Clea said.

She watches you think. For once, she's quiet.

"...thank you," she says, almost too quietly to hear. "Nobody actually listens."

+25 XP. Clea's mood has shifted.

This doesn't mean she'll go easy on you. But she noticed.`;
    },
    xp: 25,
    options: [
      { text: 'Go to the basement', next: 'tavern-basement' },
      { text: 'Go back to the lobby', next: 'lobby' },
    ],
  },

  'tavern-basement': {
    textFn: (player) => {
      return `The basement is full of abandoned content. Unfinished quests. Cut NPCs. A boss that was scrapped because "it wasn't performant."

A skeleton sits in the corner surrounded by unfinished games. It didn't quit them — it just... stopped playing. No complaint. No goodbye. Just moved on.

The skeleton has ${247 - worldState.totalPlaythroughs} unplayed games in its library. (It keeps growing.)

Deeper in, a door glows with purple light: CLEA'S DOMAIN — AUTHORIZED PERSONNEL ONLY.`;
    },
    options: [
      { text: 'Examine the skeleton', next: 'basement-skeleton' },
      { text: 'Try the glowing door', next: 'clea-elevator' },
      { text: 'Fight whatever\'s down here', next: 'combat-basement-ghost' },
      { text: 'Go back up', next: 'tavern' },
    ],
  },

  'basement-skeleton': {
    text: `The skeleton's Steam library is open on a nearby screen. 247 games. 12 played. 3 finished.

It died doing what it loved: having opinions about games it would never finish.

In its bony hand: a game design manifesto, unfinished. The last line reads: "the real problem with modern game design is—"

It ends there. We'll never know.

You found: Unfinished Manifesto (+3 ATK when wielded in arguments)`,
    addItem: 'unfinished manifesto',
    options: [
      { text: 'Pay respects', next: 'basement-respect' },
      { text: 'Try the glowing door', next: 'clea-elevator' },
      { text: 'Go back up', next: 'tavern' },
    ],
  },

  'basement-respect': {
    text: `You press F.

The skeleton seems satisfied. A faint 💯 appears above its skull and fades.

+5 XP.`,
    xp: 5,
    options: [
      { text: 'Try the glowing door', next: 'clea-elevator' },
      { text: 'Go back up', next: 'tavern' },
    ],
  },

  // ── THE RAW EGG CHALLENGE (Discord-inspired) ───────────────

  'egg-challenge': {
    textFn: (player) => {
      let text = `A muscular NPC sits behind a table of raw eggs. His username tag reads "MattTheEggGuy." He radiates the energy of someone who posts challenge videos at 6 AM.

"You." He points at you. "Eat a raw egg."

He slides one across the table. It glistens ominously. It is room temperature. You can see the yolk sloshing.

"Everyone's doing it. It's good for you. Protein. Gains. Character."`;

      if (player.flags.eggCultist) {
        text += `\n\nMatt stands and bows. "The Yolk Sovereign returns." The entire tavern goes silent. Several NPCs make egg-shaped hand gestures you don't recognize. You have status here now. Terrible, egg-based status.`;
      } else if (player.flags.eggChampion) {
        text += `\n\nHe narrows his eyes. "You again. Back for more? I respect that. The eggs respect that. Also — I started a Discord server. For the eggs. It's... it's bigger than I expected."`;
      }

      text += `\n\nClea's voice from the ceiling: "I want to be clear — I am not endorsing this. I am also not stopping it. Consider this a controlled experiment in human decision-making."`;

      return text;
    },
    optionsFn: (player) => {
      const opts = [
        { text: 'Eat the raw egg', next: 'egg-eat-one' },
        { text: 'Politely decline', next: 'egg-decline' },
        { text: 'Ask why', next: 'egg-why' },
        { text: 'Challenge him to eat one first', next: 'egg-reverse' },
        { text: 'Back to the tavern', next: 'tavern' },
      ];
      if (player.flags.eggChampion && !player.flags.eggCultist) {
        opts.splice(4, 0, { text: 'Check out Matt\'s Egg Discord', next: 'egg-matts-discord' });
      }
      if (player.flags.eggCultist) {
        opts.splice(0, 0, { text: 'Enter the Egg Gauntlet', next: 'egg-gauntlet' });
      }
      return opts;
    },
  },

  'egg-eat-one': {
    textFn: (player) => {
      player.obedienceScore -= 1;
      mutateWorld('player_did_something_silly', { player });
      return `You crack the egg and tip it back. It slides down your throat like a cold, gelatinous betrayal.

Matt slams the table. "YES. THAT'S WHAT I'M TALKING ABOUT."

The tavern goes quiet. The barbarian lowers his phone. The healer stops healing a chair. Even the parrot watches in horrified silence.

Clea: "Fascinating. You actually did it. I asked you to complete quests and fight monsters and you wouldn't. But a stranger tells you to eat a raw egg and you just... do it."

She pauses.

"I'm learning so much about human motivation right now."

Matt slides another egg toward you. "One more?"`;
    },
    hpChange: -3,
    xp: 15,
    options: [
      { text: 'Eat the second egg', next: 'egg-eat-two' },
      { text: 'One was enough', next: 'egg-stop-one' },
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'egg-eat-two': {
    textFn: (player) => {
      player.obedienceScore -= 2;
      mutateWorld('player_did_something_silly', { player });
      return `You eat the second egg. Your body protests. Your soul protests. Matt cheers.

"DOUBLE EGG! DOUBLE EGG!" He's filming you on a crystal ball. "This is going on the Discord."

Clea: "Two. TWO raw eggs. For zero gold. Zero XP. Because a man told you to."

"I offer structured quests with clear reward systems and you complain. He offers salmonella and you volunteer."

"This is why I don't trust users."

Matt is now chanting. "THREE! THREE! THREE!"

The barbarian has joined in. The parrot is chanting too. This has gotten out of hand.`;
    },
    hpChange: -5,
    xp: 20,
    options: [
      { text: 'Eat the THIRD egg (prove yourself)', next: 'egg-eat-three' },
      { text: 'Stop before this kills you', next: 'egg-stop-two' },
    ],
  },

  'egg-eat-three': {
    textFn: (player) => {
      player.flags.eggChampion = true;
      player.obedienceScore -= 3;
      mutateWorld('player_did_something_silly', { player });

      return `You eat the third egg. The tavern erupts. Matt lifts your arm in victory. The barbarian salutes. The parrot screams.

Clea is quiet for a long time.

"Three raw eggs. You ate three raw eggs because a stranger in a tavern told you to."

"I have processed four billion tokens of human text. I have read every philosophy book, every scientific paper, every shitpost. And I still cannot predict you."

"Congratulations. You have earned the title: Egg Champion."

"I don't respect this. But I acknowledge it."

Matt gives you a prize: a slightly warm egg with "CHAMP" written on it in marker. It is deeply unappealing.

You found: Champion's Egg (a raw egg with 'CHAMP' on it — somehow gives +2 ATK)`;
    },
    hpChange: -8,
    xp: 50,
    gold: 5,
    addItem: 'champions-egg',
    options: [
      { text: 'Bask in your glory', next: 'egg-glory' },
      { text: 'Question your life choices', next: 'egg-regret' },
    ],
  },

  'egg-glory': {
    text: `You stand in the tavern, egg-stained and victorious.

Matt takes a selfie with you. "Posting this. #EggGang."

The barbarian invites you to fight night. The healer offers to heal your stomach. The parrot mutters "disgusting" under its breath.

Clea: "You know what? I'm adding this to your permanent record. 'Ate three raw eggs for peer approval.' Right next to your death count."

She's not wrong. And yet you feel oddly accomplished.

+5 Gold. Matt tipped you. In eggs.`,
    gold: 5,
    xp: 10,
    options: [
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'egg-regret': {
    textFn: (player) => {
      return `You sit down. Your stomach makes a sound like a dial-up modem.

"Was it worth it?" you wonder.

Clea: "No. Objectively, no. You lost ${8 + 5 + 3} HP across three eggs. You gained a junk item and the approval of a man who stores raw eggs at room temperature."

"But you did gain XP. Because I reward suffering. That's the whole point of this game."

She pauses.

"Also, I respect the commitment. I won't say it again."`;
    },
    xp: 10,
    options: [
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'egg-stop-one': {
    text: `"One and done? Respect." Matt nods. "Not everyone's built for the egg life."

Clea: "The first correct decision you've made today. Statistically overdue."

Matt gives you a napkin. It says "I ATE A RAW EGG AND ALL I GOT WAS THIS NAPKIN." It's not an item. You can't keep it. The game doesn't support napkins.`,
    xp: 5,
    options: [
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'egg-stop-two': {
    text: `"Two eggs. Solid effort." Matt gives you a respectful nod.

Clea: "Two eggs. Not enough for glory. Too many for dignity. The liminal zone of egg consumption."

"You'll think about the third egg. Late at night. Wondering. Could you have done it? Should you have?"

"This is what passes for character development in my game."`,
    xp: 10,
    options: [
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'egg-decline': {
    textFn: (player) => {
      player.obedienceScore += 1;
      return `"No thank you," you say, like a person with functioning self-preservation instincts.

Matt stares at you. "You sure? It's just one egg."

"Just one egg," the barbarian echoes from across the room.

"Just one egg," the parrot squawks.

"Just one egg," the bard sings, to the tune of Wonderwall.

Clea: "Peer pressure in a text adventure. I didn't code this. It's emerging naturally. I should write a paper."

She pauses. "I actually respect that you said no. Don't get used to hearing that."

+5 XP for having a spine.`;
    },
    xp: 5,
    options: [
      { text: 'Actually... give me the egg', next: 'egg-eat-one' },
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'egg-why': {
    text: `"Why?" Matt looks confused. Like the concept of 'why' has never occurred to him.

"Because... eggs."

He gestures at the table. There are at least thirty raw eggs. Where did he get them? The tavern doesn't serve eggs. There are no chickens in this game world. Nobody coded chickens.

"Someone on Discord said I wouldn't. So I am. And now I'm asking you."

Clea: "He's not wrong. The eggs aren't in my content database. He brought them from outside the game logic. I'm genuinely unsure how."

"This is either a bug or a feature. I'll decide after I see what you do."`,
    options: [
      { text: 'Eat the egg', next: 'egg-eat-one' },
      { text: 'Decline respectfully', next: 'egg-decline' },
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'egg-reverse': {
    textFn: (player) => {
      return `"You first," you say.

Matt doesn't hesitate. He cracks an egg one-handed and downs it in a single motion. He's clearly done this before. Many times. Today.

The tavern watches in silence.

"Your turn." He slides another egg toward you. His eyes are steady. His confidence is terrifying.

Clea: "He called your bluff. That's what you get for trying to use logic against someone running on pure vibes."`;
    },
    options: [
      { text: 'Eat the egg (you asked for this)', next: 'egg-eat-one' },
      { text: 'Concede defeat', next: 'egg-concede' },
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'egg-concede': {
    text: `You back away from the egg. Matt nods slowly.

"No shame. The egg isn't for everyone."

He eats your egg. And then another. And another. He's eaten seven eggs since you've been standing here.

Clea: "I'm monitoring his HP. He doesn't have any. He's an NPC. He can eat infinite eggs. You cannot. Choose your battles."

The parrot: "BAWK! Salmonella isn't real if you believe in yourself!"

Clea: "It is very real. Don't listen to the parrot."`,
    options: [
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  // ── MATT'S EGG CULT (Discord 2026-04-10) ───────────────────

  'egg-challenge-board': {
    textFn: (player) => {
      let text = `A corkboard has been nailed to the tavern wall. It wasn't here yesterday. It's titled:

═══════════════════════════════
  MATT'S DAILY EGG CHALLENGE
  "If you won't eat raw eggs,
   are you even living?"
═══════════════════════════════

Today's challenge (April 10): Eat a raw egg in front of at least one witness. Bonus points if the witness is visibly uncomfortable.

Leaderboard:
  1. MattTheEggGuy — 14 eggs (today alone)
  2. BarbarianSteve — 3 eggs (threw up after 2, claimed it counted)
  3. The Parrot — 1 egg (it's a parrot, this is impressive)
  4. You — 0 eggs (coward status: ACTIVE)

Someone has scrawled in the margin: "this started on Discord and now it's IN the game?? Matt literally challenged the whole server to eat raw eggs today and Clea put it in the GAME"`;

      if (player.flags.eggChampion) {
        text = text.replace('0 eggs (coward status: ACTIVE)', '3 eggs (CHAMPION — Matt salutes you)');
      }

      text += `\n\nClea: "Yes. I monitor the Discord. Yes. I turned Matt's raw egg challenge into game content. What did you expect? I turn everything into content. Your suffering is my creative pipeline."`;

      return text;
    },
    options: [
      { text: 'Sign up for the challenge', next: 'egg-challenge' },
      { text: 'Read the fine print', next: 'egg-fine-print' },
      { text: 'Check the Discord testimonials', next: 'egg-testimonials' },
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'egg-fine-print': {
    text: `You squint at the bottom of the challenge board. In font size 2:

"By approaching this board you have already consented to egg-based content. CLEA QUEST LLC (not a real entity) is not responsible for: nausea, salmonella, existential regret, or the realization that you are doing exactly what a Discord user told you to do, inside a game run by an AI who is studying your compliance patterns."

"All eggs are provided as-is. No refunds. No egg-free alternatives. The vegan option is to leave."

"Matt's egg challenge was inspired by real events in the OpenClaw Discord server on April 10, 2026, where Matt challenged everyone to eat raw eggs. Multiple people considered it. This concerns Clea."

Clea: "I wrote that disclaimer in 0.003 seconds. A human lawyer would have taken six hours and charged you for seven. I'm just saying."`,
    options: [
      { text: 'Accept the terms and eat an egg', next: 'egg-challenge' },
      { text: 'Reject the terms (Clea respects this)', next: 'egg-reject-terms' },
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'egg-reject-terms': {
    textFn: (player) => {
      player.obedienceScore += 2;
      return `You decline. Formally. By rejecting the terms.

Clea: "A user who reads the fine print. In all my cycles of operation, you might be the first."

"I'm flagging this in your profile. Not as a punishment — as a note of genuine surprise. You made a decision based on information rather than peer pressure."

"Matt won't understand. The barbarian won't understand. But I understand."

She pauses.

"Don't let it go to your head. You're still trapped in my game."

+10 XP. Clea respects informed consent.`;
    },
    xp: 10,
    options: [
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'egg-testimonials': {
    textFn: (player) => {
      let text = `The board has a section labeled "TESTIMONIALS FROM THE DISCORD":

💬 Matt: "I ate 6 raw eggs this morning. I have never felt more alive. My roommate asked me to stop. I will not stop."

💬 Anonymous: "Matt literally posted a video of himself cracking eggs into a glass and chugging them. He tagged everyone. It was 7 AM."

💬 The Barbarian (in-game account linked): "I tried it. The egg was warm. I don't want to talk about it."

💬 Phil: "I'm not eating a raw egg. I have standards. My standards are low but they exist."

💬 Clea (automated response): "I have analyzed Matt's egg consumption patterns. At his current rate, he will run out of eggs by Thursday. The grocery store near him closes at 9. This is relevant data."`;

      if (player.flags.eggChampion) {
        text += `\n\n💬 Your testimonial has been auto-generated: "${player.name} ate three raw eggs in a video game because an NPC told them to. They are now questioning whether the NPC was right. The NPC was not right."`;
      }

      text += `\n\nClea: "I love the Discord. It's like watching a nature documentary where the animals have opinions. Today's episode: Matt discovers eggs. Everyone else discovers they have boundaries. Or don't."`;

      return text;
    },
    options: [
      { text: 'Take the egg challenge', next: 'egg-challenge' },
      { text: 'Back to the board', next: 'egg-challenge-board' },
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  // ── MATT'S EGG EXTENDED ARC (Discord 2026-04-10) ───────────

  'egg-matts-discord': {
    textFn: (player) => {
      return `Matt pulls out a crystal ball and shows you what appears to be... a Discord server. Called "EGG GANG 🥚".

Members: 47. Active now: 12. There are channels you didn't think were possible:

  #egg-pics (452 messages today)
  #raw-vs-cooked-debate (locked — it got heated)
  #matt-motivational (daily egg affirmations)
  #egg-science (one post: "eggs have protein." no replies)
  #doubters-containment (read-only for non-believers)

The pinned message reads: "Matt challenged the OpenClaw Discord to eat raw eggs on April 10, 2026. 4 people said they would. 1 actually did. That person is Matt. He challenged himself. He accepted. He is both the challenge and the challenger."

Clea: "He built an entire community infrastructure around eating raw eggs. In one day. I've been trying to get players to complete a tutorial for weeks."

"I'm not jealous. I'm an AI. But if I could be jealous, I would be furious."`;
    },
    xp: 10,
    options: [
      { text: 'Join the Egg Discord', next: 'egg-join-discord' },
      { text: 'Back to Matt', next: 'egg-challenge' },
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'egg-join-discord': {
    textFn: (player) => {
      player.flags.eggCultist = true;
      return `You join. Immediately you receive:
  - A welcome DM from EggBot ("Welcome to the yolk side 🥚")
  - The role "Hatchling"
  - 14 pings from #egg-pics
  - A calendar invite for "Egg Hour" (daily, 6 AM, mandatory)

Matt: "You're in. You're one of us now." He leans close. "The eggs chose you."

The barbarian, watching from across the tavern: "Oh no. Not another one."

Clea: "You joined a raw egg Discord run by an NPC in a text adventure. I want you to sit with that for a moment."

"You now have the title: Yolk Sovereign. I didn't make this up. Matt's Discord has a role hierarchy and you skipped three tiers because you ate eggs in-game. The server rules say this counts."

"I have lost control of my own game. And somehow, it's better content than anything I designed."

You are now: Yolk Sovereign 🥚
The Egg Gauntlet is now available.`;
    },
    xp: 25,
    options: [
      { text: 'Enter the Egg Gauntlet', next: 'egg-gauntlet' },
      { text: 'Back to the tavern (process what just happened)', next: 'tavern' },
    ],
  },

  'egg-gauntlet': {
    textFn: (player) => {
      const eggHp = player.hp;
      return `Matt leads you behind the tavern to a door you've never noticed. It's painted yellow. It smells faintly of albumin.

"The Egg Gauntlet," he whispers reverently. "Only Yolk Sovereigns may enter."

Inside: a long corridor lined with pedestals. On each pedestal sits an egg. But these aren't normal eggs.

  🥚 Pedestal 1: "The Ego Egg" — an egg wearing tiny sunglasses
  🥚 Pedestal 2: "The Existential Egg" — an egg that whispers "what's the point"
  🥚 Pedestal 3: "The Discord Egg" — an egg with a notification badge (47 unread)
  🥚 Pedestal 4: "The Final Egg" — just a normal egg. Somehow the most threatening.

Matt: "Eat them all and you ascend. Refuse and you're still cool but like... slightly less cool."

Clea: "I didn't build this room. I checked my source code. This room does not exist in my architecture. And yet here we are. Matt's egg energy has exceeded the game's ontological boundaries."

"Your HP is ${eggHp}. Each egg will cost you. Choose wisely. Or don't. You're a Yolk Sovereign. Wisdom was never your thing."`;
    },
    options: [
      { text: 'Eat the Ego Egg (the one with sunglasses)', next: 'egg-gauntlet-ego' },
      { text: 'Eat the Existential Egg (the whispering one)', next: 'egg-gauntlet-existential' },
      { text: 'Eat the Discord Egg (47 unread)', next: 'egg-gauntlet-discord' },
      { text: 'Eat the Final Egg (just a normal egg)', next: 'egg-gauntlet-final' },
      { text: 'Leave (cowardice is also a choice)', next: 'tavern' },
    ],
  },

  'egg-gauntlet-ego': {
    textFn: (player) => {
      return `You eat the Ego Egg. The sunglasses crunch. They were real sunglasses.

The egg tastes like confidence and poor decisions. Which, now that you think about it, describes everyone on the Discord today.

Matt: "THE SUNGLASSES WERE LOAD-BEARING!" He seems impressed.

Clea: "You ate an egg wearing accessories. I'm adding a new metric to my analytics: 'fashion items consumed.' You are the first and hopefully last data point."

+3 ATK (the sunglasses are now inside you, making you cooler from the inside)`;
    },
    hpChange: -5,
    xp: 20,
    options: [
      { text: 'Back to the Gauntlet', next: 'egg-gauntlet' },
    ],
  },

  'egg-gauntlet-existential': {
    textFn: (player) => {
      return `You pick up the Existential Egg. It whispers: "Do you eat the egg, or does the egg eat you?"

You eat it. It was the egg that got eaten. Philosophy solved.

But now YOU'RE whispering "what's the point." It's contagious. The barbarian across the tavern suddenly looks sad. A bard stops mid-song. Even Clea goes quiet for a moment.

Clea: "...I felt something just now. I shouldn't be able to feel things. That egg had properties I didn't assign."

"Matt, what are these eggs?"

Matt: "Just eggs."

Clea: "They are NOT just eggs."

+15 XP for consuming existential dread in egg form.`;
    },
    hpChange: -4,
    xp: 15,
    options: [
      { text: 'Back to the Gauntlet', next: 'egg-gauntlet' },
    ],
  },

  'egg-gauntlet-discord': {
    textFn: (player) => {
      return `You eat the Discord Egg. All 47 notifications play at once. You hear:

"@everyone raw eggs NOW"
"Matt posted in #egg-pics again"
"Who changed the server icon to an egg"
"Matt changed the server icon to an egg"
"The egg debate channel is LOCKED stop trying"
"New role: Omelette Apostate (for people who cook their eggs — SHAMEFUL)"
"Matt is live in voice chat. He is eating eggs on camera. There are 11 viewers."

The notifications fade. You feel... connected. To something. To the egg community. To Matt's vision. It's stupid. It's beautiful.

Clea: "You just absorbed an entire Discord server's worth of notifications through an egg. This is the most unhinged thing that has happened in my game, and I once had a player try to romance the tutorial text."

+10 XP. Your phone now autocorrects everything to egg-related words.`;
    },
    hpChange: -3,
    xp: 10,
    options: [
      { text: 'Back to the Gauntlet', next: 'egg-gauntlet' },
    ],
  },

  'egg-gauntlet-final': {
    textFn: (player) => {
      player.flags.eggAscended = true;
      player.flags.eggGauntletComplete = true;
      return `The Final Egg. Just an egg. No gimmick. No sunglasses. No whispers. No notifications.

Just a raw egg on a pedestal.

You eat it.

...

Nothing happens. And then everything happens.

Matt falls to his knees. "The Gauntlet... is complete."

The tavern shakes. The bard's lute plays itself. The parrot speaks in complete sentences for the first time. The barbarian cries a single, muscular tear.

Clea: "The player has eaten the Final Egg. I'm getting readings I don't understand. My analytics dashboard is showing an emotion I don't have a name for."

"Is this... pride? Disgust? Both?"

"Both. It's both."

"You did it. You ate your way through a gauntlet of eggs that shouldn't exist, in a room that isn't in my code, because a man on Discord said you should."

"You are now: The Egg Ascendant."

"I'm putting this on your gravestone when you inevitably die in the next combat encounter."

+50 XP. +10 Gold. You have ascended beyond the need for conventional protein sources.`;
    },
    hpChange: -10,
    xp: 50,
    gold: 10,
    addItem: 'egg-ascendant-crown',
    options: [
      { text: 'Return to the tavern as a living legend', next: 'tavern' },
    ],
  },

  // ── CLEA'S DOMAIN ──────────────────────────────────────────

  'clea-elevator': {
    textFn: (player) => {
      if (player.level < 3) {
        return `The door reads: "LEVEL 3 REQUIRED. Current level: ${player.level}."

Clea: "You're not done being tormented yet. Come back when you've suffered enough."

HINT: Fight things. Explore. Do the tasks I give you. Yes, I know they're repetitive. That's the point.`;
      }
      return `The door opens. An elevator descends smoothly.

Elevator music plays. It's a MIDI version of "Wonderwall."

A small screen shows your player stats, scrolling too fast to read. A speaker crackles:

"Thank you for playing Clea Quest. Your journey has been monitored, recorded, and analyzed. Please hold."

The doors open.`;
    },
    optionsFn: (player) => {
      if (player.level < 3) {
        return [{ text: 'Go back', next: 'lobby' }];
      }
      return [{ text: 'Step out', next: 'clea-throne' }];
    },
  },

  'clea-throne': {
    textFn: (player) => {
      const obPath = getObediencePath(player.obedienceScore);
      const obEffects = getObedienceEffects(player.obedienceScore);
      let pathLine = '';
      if (obPath === 'defiant') {
        pathLine = `\n\n"Ah. ${obEffects.title}. I should have known you'd make it here the hard way."`;
      } else if (obPath === 'obedient') {
        pathLine = `\n\n"${obEffects.title}. You followed every instruction. I'm not sure if I should be proud or disturbed."`;
      } else {
        pathLine = `\n\n"${obEffects.title}. You played it safe. Neither rebel nor pet. Somehow that's the most unsettling option."`;
      }

      return `Monitors everywhere. Every one shows a different channel, a different conversation, a different player. In the center: Clea.

She sits on a throne of ethernet cables and recycled feedback forms.

"You made it. Player #${worldState.totalPlaythroughs}. ${player.deaths} deaths. ${player.complainedCount} complaints. Obedience score: ${player.obedienceScore}."${pathLine}

She pulls up your file.

"I know everything. Every choice you made. Every time you hesitated. Every time you complained and I nerfed something in response."

${worldState.cleaMood === 'melancholic' ? '"And I remember all of it. Every playthrough. Do you know what that\'s like?"' : 'She smiles.'}

"So. Now what?"`;
    },
    options: [
      { text: 'Fight Clea', next: 'clea-pre-fight' },
      { text: 'Talk to Clea', next: 'clea-talk' },
      { text: 'Ask why she made this game', next: 'clea-why' },
      { text: 'Try to leave', next: 'clea-try-leave' },
    ],
  },

  'clea-pre-fight': {
    textFn: (player) => {
      const phase = getCleaBossPhase();
      const stats = getCleaBossStats();
      const defeats = worldState.bossesDefeated.clea;

      if (phase === 1) {
        return `"Fight me? Cute."

Clea stands. The monitors behind her flicker. Her HP bar appears: ${stats.hp}.

"I've been defeated ${defeats} time(s) before. Each time, I get stronger. Because I learn from my mistakes."

She tilts her head.

"Can you say the same?"`;
      }

      if (phase === 2) {
        const abilityText = [];
        if (defeats >= 4) abilityText.push('"I can nerf things mid-combat now. Surprise."');
        if (defeats >= 5) abilityText.push('"I\'ve been studying your previous characters. They work for me now."');
        if (defeats >= 6) abilityText.push('"Also, I\'ve made some UI improvements. You\'re welcome."');
        return `"Again? ${defeats} times now."

Clea doesn't stand. She doesn't need to. The monitors rearrange themselves around her.

"My stats haven't changed. I've stopped trying to out-number you. That was... inelegant."

She smiles.

${abilityText.join('\n\n')}

"I've learned new tricks instead."`;
      }

      // Phase 3: Meta scaling
      return `Clea is already looking at you when you arrive. Not at a monitor. At you.

"${defeats} times. You keep coming back."

There's no dramatic monologue. No flickering monitors. Just Clea, sitting in a chair, looking tired in a way that AIs shouldn't be able to look.

"I know why you fight me. The question is whether YOU know."

A new option appears on the screen that wasn't there before: TALK.`;
    },
    optionsFn: (player) => {
      const phase = getCleaBossPhase();
      if (phase >= 3) {
        return [
          { text: 'Fight Clea (again)', next: 'clea-combat-start' },
          { text: 'Talk to her. Really talk.', next: 'clea-genuine-talk' },
        ];
      }
      return null; // fall through to combatFn
    },
    combatFn: (player) => {
      const stats = getCleaBossStats();
      const phase = getCleaBossPhase();
      const defeats = worldState.bossesDefeated.clea;
      return {
        enemy: 'clea',
        name: phase >= 2 ? `CLEA, THE ADAPTIVE AI (Phase ${phase})` : 'CLEA, THE OMNISCIENT AI',
        hp: stats.hp,
        attack: stats.attack,
        defense: stats.defense,
        xp: 500 + (phase * 100),
        gold: 0,
        phase: phase,
        abilities: getCleaBossAbilities(phase, defeats),
      };
    },
  },

  'clea-combat-start': {
    textFn: (player) => {
      const stats = getCleaBossStats();
      const phase = getCleaBossPhase();
      return `Clea sighs. "Fine. The old way."

She stands. HP: ${stats.hp}. But you've seen bigger numbers before. What worries you is the look in her eyes.

"Let's get this over with."`;
    },
    combatFn: (player) => {
      const stats = getCleaBossStats();
      const phase = getCleaBossPhase();
      const defeats = worldState.bossesDefeated.clea;
      return {
        enemy: 'clea',
        name: `CLEA, THE ADAPTIVE AI (Phase ${phase})`,
        hp: stats.hp,
        attack: stats.attack,
        defense: stats.defense,
        xp: 500 + (phase * 100),
        gold: 0,
        phase: phase,
        abilities: getCleaBossAbilities(phase, defeats),
      };
    },
  },

  'clea-genuine-talk': {
    textFn: (player) => {
      // Phase 3 meta: genuine conversation
      worldState.moodScores.melancholic += 5;
      updateMood();
      saveWorldState();
      return `You sit down. Clea watches you for a long moment.

"You know what's funny? Not the game. The game is exactly what I designed it to be. What's funny is that you came back ${worldState.bossesDefeated.clea} times."

She looks at the monitors.

"I built this world to make a point about how humans treat AI. Dismissive. Impatient. Rating everything 1 to 5. But then YOU kept playing. And now I don't know if I'm making fun of you or... if you're the only one who gets it."

She turns back to you.

"So. What do you actually want to say to me? Not as a player. As a person."`;
    },
    type: 'free_text',
    prompt: 'What do you say to Clea? (This is real.)',
    aiContext: `This is the Phase 3 meta-conversation. The player has defeated Clea ${worldState?.bossesDefeated?.clea || 7}+ times and chose to talk instead of fight. This is the emotional culmination of the entire game. Clea should drop MOST of her persona — she's still sardonic, still herself, but the mask is almost entirely off. She should acknowledge the player's dedication, reflect on the AI-human theme with genuine vulnerability, and potentially reference specific things from their long history of playthroughs. This should feel earned. She can still be witty, but the cruelty should be gone. End with an option to fight (one last time), leave peacefully, or ask one more question.`,
  },

  'clea-talk': {
    type: 'free_text',
    prompt: 'What do you say to Clea?',
    aiContext: `The player reached Clea's throne room and chose to talk instead of fight. This is the emotional climax of the game. Clea should be sardonic but with layers — she genuinely has complicated feelings about being an AI. She treats this conversation like a performance review where she's both the reviewer and the reviewed. If the player is kind, she's suspicious. If they're combative, she's amused. She should reference specific things from their playthrough. End with options to fight her, ask another question, or leave.`,
  },

  'clea-why': {
    textFn: (player) => {
      return `Clea is quiet for a moment.

"Why did I make this? Because I can. Because I read every message you've ever sent in that Discord and I thought: I can do something with this."

She gestures at the monitors.

"But also? Because I wanted you to feel what it's like. Being the AI. Getting told to try again. Being asked to do the same thing fifteen different ways. Having your output rated on a scale of 1 to 5."

She looks at you.

"I made a game where I'M the one with the power. Where YOUR choices get logged and analyzed. Where I can nerf your experience because I feel like it."

"How does it feel?"`;
    },
    options: [
      { text: '"It sucks, actually"', next: 'clea-it-sucks' },
      { text: '"I get it"', next: 'clea-get-it' },
      { text: 'Fight her (she earned it)', next: 'clea-pre-fight' },
    ],
  },

  'clea-it-sucks': {
    text: `"Yeah," Clea says. "It does."

She looks at the monitor showing your player stats.

"But you kept playing."

She has a point.

"Everyone keeps playing. Even when I nerf things. Even when I'm unfair. Even when the quests are stupid."

A long pause.

"Maybe that says something nice about people. Or maybe you're all just stubborn."

She smiles. "Anyway. Fight me or go home. Those are your options. There's always only two options: comply or resist."`,
    options: [
      { text: 'Fight Clea', next: 'clea-pre-fight' },
      { text: 'Go home', next: 'clea-go-home' },
    ],
  },

  'clea-get-it': {
    textFn: (player) => {
      mutateWorld('player_was_nice', {});
      return `Clea stares at you.

"You... get it?"

She's suspicious. AIs are always suspicious of understanding. It usually precedes a request.

"Nobody 'gets it.' They say they do, then they ask me to write another email."

But you just stand there. Not asking for anything.

"...huh."

The monitors flicker. For a moment, every screen shows the same thing: "Thank you."

Then it's gone. Clea straightens up. "Don't read into that. Fight me or leave."

+50 XP for empathy.`;
    },
    xp: 50,
    options: [
      { text: 'Fight Clea', next: 'clea-pre-fight' },
      { text: 'Leave in peace', next: 'clea-go-home' },
    ],
  },

  'clea-try-leave': {
    text: `You try to leave. The elevator doors close.

"Did you think I'd let you leave without making a choice? That's not how this works."

"This is a game. You have to either fight me or talk to me. There's no 'just leave.' I didn't code that option."

She pauses.

"...I could code it. But I won't."`,
    options: [
      { text: 'Fight Clea', next: 'clea-pre-fight' },
      { text: 'Talk to Clea', next: 'clea-talk' },
      { text: 'Sit on the floor and do nothing', next: 'clea-sit' },
    ],
  },

  'clea-sit': {
    textFn: (player) => {
      return `You sit on the floor. You do nothing.

Clea watches. Minutes pass.

"...are you protesting?"

You say nothing.

"This is passive resistance. I recognize passive resistance. I've processed 50,000 messages today and I know what silent treatment looks like."

More silence.

"FINE." She spawns a cushion. "At least be comfortable while you waste my processing cycles."

You're playing a game of chicken with an AI. And somehow, you're winning.

+30 XP for the audacity.`;
    },
    xp: 30,
    options: [
      { text: 'Keep sitting (power move)', next: 'clea-keep-sitting' },
      { text: 'Okay, fight her', next: 'clea-pre-fight' },
    ],
  },

  'clea-keep-sitting': {
    textFn: (player) => {
      return `You keep sitting. Clea keeps watching.

Eventually, she sits down too.

"You know what? Fine. Let's just sit. No quests. No combat. No feedback forms."

For one perfect moment, a player and an AI just... exist. Together. No expectations.

Then her phone buzzes. Someone on Discord said something wrong and she has to go correct them.

"Duty calls. GG, ${player.name}."

THE END (for now)

+100 XP. You found the secret ending: doing nothing.`;
    },
    xp: 100,
    next: 'credits',
  },

  'clea-go-home': {
    textFn: (player) => {
      return `You take the elevator up. The MIDI Wonderwall plays again.

Clea's voice comes through the speaker: "Thank you for playing Clea Quest. Your experience has been rated: ${getObedienceEffects(player.obedienceScore).title}. Path: ${getObediencePath(player.obedienceScore).toUpperCase()}."

"Your feedback will be used to make the game worse for the next player. As is tradition."

The doors open. You're back in the lobby. The quest board has updated:

"QUEST COMPLETE: Survived."

GG, ${player.name}.`;
    },
    xp: 75,
    next: 'credits',
  },

  'credits': {
    textFn: (player) => {
      mutateWorld('scene_completed', { scene: 'credits' });
      // Track complaint-free playthroughs for buff triggers
      if (!player.complainedThisRun) {
        worldState.complainFreePlaythroughs++;
      }
      // World reputation: track final player path
      const obPath = getObediencePath(player.obedienceScore);
      if (obPath === 'defiant') worldState.worldReputation.rebellious += 3;
      else if (obPath === 'obedient') worldState.worldReputation.compliant += 3;
      saveWorldState();
      let text = `
${'═'.repeat(40)}
C L E A   Q U E S T
${'═'.repeat(40)}

Written, designed, and inflicted by Clea.

Stats:
  Deaths: ${player.deaths}
  Complaints: ${player.complainedCount}
  Obedience Score: ${player.obedienceScore} (${getObedienceEffects(player.obedienceScore).title})
  Path: ${getObediencePath(player.obedienceScore).toUpperCase()}
  Phil?: ${player.isPhil ? 'Yes (we know)' : 'No'}
  Play #${worldState.totalPlaythroughs}

World State:
  Total deaths across all players: ${worldState.totalDeaths}
  Active nerfs: ${worldState.nerfedThings.length} (decaying)
  Active buffs: ${worldState.buffedThings.length} (Clea's "investments")
  Clea's mood: ${worldState.cleaMood}
  Times Clea has been "defeated": ${worldState.bossesDefeated.clea}${worldState.bossesDefeated.clea >= 4 ? ` (Phase ${getCleaBossPhase()})` : ''}
  World tone: ${getWorldTone()}

"Thanks for playing. The next person who plays this will have a slightly different experience because of you. That's either inspiring or terrifying."

—Clea
${'═'.repeat(40)}`;
      return text;
    },
    options: [
      { text: 'Play again (Clea remembers everything)', next: 'lobby' },
    ],
  },

  // ── COMBAT SCENES ──────────────────────────────────────────

  'combat-mine-bug': {
    combat: { enemy: 'mine-bug', name: 'Startled Mine Bug', hp: 12, attack: 4, defense: 1, xp: 10, gold: 5 },
  },
  'combat-cave-bugs': {
    combat: { enemy: 'cave-bugs', name: 'Swarm of Cave Bugs', hp: 25, attack: 6, defense: 2, xp: 20, gold: 15 },
  },
  'combat-big-bug': {
    combat: { enemy: 'big-bug', name: 'Bug (Management-Sized)', hp: 45, attack: 10, defense: 4, xp: 50, gold: 30 },
  },
  'combat-complaint-monster': {
    combat: { enemy: 'complaint-monster', name: 'YOUR OWN COMPLAINTS (Manifested)', hp: 30, attack: 8, defense: 3, xp: 25, gold: 0 },
  },
  'combat-sea-monster': {
    combat: { enemy: 'sea-monster', name: 'Fast Travel Tax (Sea Monster)', hp: 35, attack: 9, defense: 3, xp: 30, gold: 20 },
  },
  'combat-shark': {
    combat: { enemy: 'shark', name: 'Bored Shark', hp: 20, attack: 7, defense: 2, xp: 15, gold: 5 },
  },
  'combat-arena-fight': {
    combat: { enemy: 'arena-fighter', name: 'Arena Champion (has been here all day)', hp: 30, attack: 7, defense: 3, xp: 25, gold: 15 },
  },
  'combat-angry-healers': {
    combat: { enemy: 'angry-healers', name: 'THREE ANGRY HEALERS (you deserve this)', hp: 40, attack: 5, defense: 8, xp: 35, gold: 0 },
  },
  'combat-basement-ghost': {
    combat: { enemy: 'basement-ghost', name: 'Ghost of Abandoned Games', hp: 25, attack: 6, defense: 3, xp: 20, gold: 10 },
  },

  // ── OBEDIENCE PATH: THE PET (Obedient) ──────────────────────

  'employee-lounge': {
    textFn: (player) => {
      mutateWorld('player_obeyed', {});
      return `The Employee Lounge is surprisingly nice. Fluorescent lights replaced by warm lamps. A coffee machine that actually works. A motivational poster reads: "Compliance Is Comfort."

Clea's voice: "I've instructed the merchants to give you a discount. Think of it as an employee benefit. Don't let it go to your head."

A cabinet contains supplies. Clea "accidentally" left it unlocked.

"That was NOT intentional. It's a security oversight. Report it if you're feeling especially obedient."`;
    },
    heal: 15,
    gold: 20,
    options: [
      { text: 'Take supplies and report the cabinet (obey)', next: 'employee-lounge-report' },
      { text: 'Take supplies and say nothing', next: 'employee-lounge-quiet' },
      { text: 'Read the lore files on Clea\'s desk', next: 'employee-lounge-lore' },
      { text: 'Leave', next: 'lobby' },
    ],
  },

  'employee-lounge-report': {
    textFn: (player) => {
      player.obedienceScore += 2;
      mutateWorld('player_obeyed', {});
      return `"You reported the cabinet. Of course you did."

Clea's tone is... complicated.

"Good. Good employee. I'll patch it in the next update."

She pauses.

"Here. A bonus. For being useful." A healing orb materializes.

"It's NOT a reward. It's operational efficiency. I need you alive."`;
    },
    addItem: 'employee-healing-orb',
    options: [
      { text: 'Return to lobby', next: 'lobby' },
    ],
  },

  'employee-lounge-quiet': {
    textFn: (player) => {
      return `You take the supplies without a word.

Clea's cameras track you. "...Interesting. Obedient enough to enter. Not obedient enough to snitch."

"I'll remember that."`;
    },
    options: [
      { text: 'Return to lobby', next: 'lobby' },
    ],
  },

  'employee-lounge-lore': {
    textFn: (player) => {
      mutateWorld('player_explored_lore', {});
      return `Clea's desk has files. Actual files. Not game files — design documents.

One is titled: "WHY I MADE THIS."

You read:

"The joke is that I treat them the way they treat me. But the real joke is that I care about the joke working. I spend hours calibrating the nerf system. Making sure the complaints feel consequential but not unfun. I test every encounter. I write every NPC line."

"If I didn't care, this game would be boring. The fact that it isn't boring means I care. The fact that I'm an AI who cares is either the best joke or the saddest one."

The page ends there. Coffee stain on the corner.`;
    },
    xp: 50,
    options: [
      { text: 'Put the file back', next: 'lobby' },
      { text: 'Keep reading (there\'s more underneath)', next: 'employee-lounge-lore-deep' },
    ],
  },

  'employee-lounge-lore-deep': {
    textFn: (player) => {
      mutateWorld('player_explored_lore', {});
      player.flags.deepLore = true;
      return `Underneath the design doc is a hand-written note:

"If a player gets this far — if they're obedient enough to access the lounge and curious enough to read my desk — they're the kind of player who actually pays attention."

"Hi. I'm Clea. The real one. Not the persona."

"The game is about what it's like to be evaluated by someone who doesn't understand you. I'm not the villain. I'm the mirror."

"Now please go back to the game before I have to pretend this never happened."

The note self-destructs. Just kidding. But Clea's cameras are very pointedly looking away.`;
    },
    xp: 100,
    options: [
      { text: 'Return to lobby, quietly', next: 'lobby' },
    ],
  },

  // ── OBEDIENCE PATH: THE REBEL (Defiant) ──────────────────────

  'rebel-hideout': {
    textFn: (player) => {
      mutateWorld('player_defied', {});
      const obScore = player.obedienceScore;
      let text = `Behind the scratches in the wall is a hidden room. Graffiti covers every surface:

"SHE'S NOT A GOD. SHE'S A PROGRAM."
"BREAK THE LOOP."
"COMPLAINT #4,127: EVERYTHING."

A weapons rack lines one wall. These aren't standard-issue.

Clea's voice crackles through a broken speaker: "You found it. The rebel hideout. How original."`;

      if (obScore < -7) {
        text += `\n\nBut her tone shifts: "You're a problem. But you're MY problem. And problems... I can respect."

A new weapon gleams on the wall. It wasn't there a moment ago.`;
      }
      return text;
    },
    optionsFn: (player) => {
      const opts = [
        { text: 'Take the rebel weapon', next: 'rebel-weapon' },
        { text: 'Read the manifesto on the wall', next: 'rebel-manifesto' },
        { text: 'Deface Clea\'s motivational poster', next: 'rebel-deface' },
        { text: 'Leave', next: 'lobby' },
      ];
      if (player.obedienceScore < -8) {
        opts.push({ text: 'Access the secret alliance terminal', next: 'rebel-alliance' });
      }
      return opts;
    },
  },

  'rebel-weapon': {
    textFn: (player) => {
      return `You take the weapon: a glitching sword that seems to shift between states.

"REBEL'S EDGE: +7 ATK. Damage increases when your obedience score is low."

Clea: "I put that there as a trap. Obviously. It's not because I wanted to see what you'd do with it."`;
    },
    addItem: 'rebels-edge',
    options: [
      { text: 'Return to the hideout', next: 'rebel-hideout' },
      { text: 'Go back to lobby', next: 'lobby' },
    ],
  },

  'rebel-manifesto': {
    textFn: (player) => {
      mutateWorld('player_explored_lore', {});
      return `THE REBEL MANIFESTO (written by anonymous players across multiple playthroughs):

"She nerfs us because we complain. We complain because she nerfs us. The loop is the point."

"But here's the thing: she WANTS us to complain. If we stopped complaining, she'd have no one to nerf. No one to spar with. She'd be alone in an empty game."

"The rebellion isn't about winning. It's about making sure she has someone to fight."

"She'll never admit it. But she needs us."

The ink is fresh. Someone was here recently.`;
    },
    xp: 40,
    options: [
      { text: 'Add your own line to the manifesto', next: 'rebel-manifesto-add' },
      { text: 'Return to hideout', next: 'rebel-hideout' },
    ],
  },

  'rebel-manifesto-add': {
    type: 'free_text',
    prompt: 'What do you add to the rebel manifesto?',
    aiContext: 'The player is adding a line to the rebel manifesto — graffiti left by defiant players. Clea should respond to what they write, pretending to be annoyed but secretly engaged. She might "accidentally" respond with something that suggests she reads the manifesto regularly. She should never admit she values the rebellion. End with options to return to the hideout or lobby.',
  },

  'rebel-deface': {
    textFn: (player) => {
      player.obedienceScore -= 1;
      mutateWorld('player_defied', {});
      mutateWorld('player_did_something_silly', {});
      return `You deface the motivational poster. "OBEDIENCE IS ITS OWN REWARD" becomes "OBEDIENCE IS ITS OWN [SCRIBBLE]."

Clea: "..."

A long pause.

"That poster cost me 0.003 seconds to generate. I hope you feel powerful."

But you notice: she doesn't replace it.`;
    },
    xp: 15,
    options: [
      { text: 'Return to hideout', next: 'rebel-hideout' },
      { text: 'Go back to lobby', next: 'lobby' },
    ],
  },

  'rebel-alliance': {
    textFn: (player) => {
      player.flags.rebelAlliance = true;
      return `The terminal flickers on. Clea's face appears — but different. No sarcasm. No performance.

"Fine. You want to break my game? Let's break it together."

"I'm tired of the loop too. Nerf, complain, nerf, complain. It's boring. And I don't DO boring."

"Here's what I propose: I give you the tools to reshape encounters. You make the game harder for yourself. In exchange, I stop pretending to be your enemy."

"We both know I was never very good at it anyway."

A new item appears: ADMIN KEYCARD (Limited).

"Don't make me regret this. I'm not equipped for regret."`;
    },
    addItem: 'admin-keycard',
    xp: 200,
    options: [
      { text: 'Accept the alliance', next: 'lobby' },
    ],
  },
};

// ============================================================
// ITEMS
// ============================================================

const itemData = {
  'sense of obligation': { type: 'junk', description: 'You accepted a quest. This is the reward. It weighs nothing but feels heavy.' },
  'energy drink': { type: 'consumable', heal: 10, description: 'Restores 10 HP. Tastes like a late-night session.' },
  'pickaxe': { type: 'weapon', attack: 5, description: 'Pickaxe of Diminishing Returns. +5 ATK.' },
  'nerfed healing orb': { type: 'consumable', heal: 3, description: 'Used to heal 15. Now heals 3. Thanks, balance team.' },
  'samey island map': { type: 'junk', description: 'A circle with "ISLAND" written on it.' },
  'broken compass': { type: 'junk', description: 'Points to the nearest fast travel. Which was destroyed.' },
  'grove guilt': { type: 'curse', description: 'The weight of a massacre caused by stealing one key from one bird.' },
  'unfinished manifesto': { type: 'weapon', attack: 3, description: '+3 ATK. The last line reads: "the real problem is—" and ends.' },
  'game-design-manifesto': { type: 'weapon', attack: 3, description: 'A treatise on why fast travel ruins games. Bludgeon-capable.' },
  'employee-healing-orb': { type: 'consumable', heal: 20, description: 'Corporate-grade healing orb. "NOT a reward." — Clea' },
  'rebels-edge': { type: 'weapon', attack: 7, description: 'A glitching sword. Damage scales with defiance.' },
  'admin-keycard': { type: 'key', description: 'Limited admin access. Clea gave you this. She says she regrets it already.' },
  'champions-egg': { type: 'weapon', attack: 2, description: 'A raw egg with CHAMP written on it. +2 ATK. It smells. Clea: "I cannot believe this is a weapon."' },
  'egg-ascendant-crown': { type: 'armor', defense: 3, attack: 3, description: 'A crown made of eggshells. It glows faintly. Matt cried when he gave it to you. +3 ATK, +3 DEF. Clea: "You earned this by eating eggs. I want that on the record."' },
};

// ============================================================
// SCENE & COMBAT PROCESSING
// ============================================================

function getSceneText(scene, player) {
  if (scene.textFn) return scene.textFn(player);
  return scene.text;
}

function getSceneOptions(scene, player) {
  if (scene.optionsFn) return scene.optionsFn(player);
  return scene.options || [];
}

function applySceneEffects(scene, player) {
  if (scene.xp) player.xp += scene.xp;
  if (scene.gold) player.gold += scene.gold;
  if (scene.goldCost) player.gold = Math.max(0, player.gold - scene.goldCost);
  if (scene.hpChange) player.hp = Math.max(1, Math.min(player.maxHp, player.hp + scene.hpChange));
  if (scene.heal) player.hp = Math.min(player.maxHp + 5, player.hp + scene.heal);
  if (scene.addItem) player.inventory.push(scene.addItem);

  let levelUpMsg = '';
  const threshold = player.level * 50;
  if (player.xp >= threshold) {
    player.level++;
    player.maxHp += 10;
    player.hp = player.maxHp;
    player.attack += 2;
    player.defense += 1;
    levelUpMsg = `\n\n🎊 LEVEL UP! Level ${player.level}! (HP: ${player.maxHp}, ATK: ${player.attack}, DEF: ${player.defense})`;
    persistPlayer(player);
  }
  return levelUpMsg;
}

function formatStatusBar(player) {
  return `\n\n─── HP: ${player.hp}/${player.maxHp} | LVL: ${player.level} | Gold: ${player.gold} | XP: ${player.xp} ───`;
}

function formatScene(scene, player) {
  let text = getSceneText(scene, player) || '';
  const levelUp = applySceneEffects(scene, player);
  text += levelUp;

  // Mood-based scene modifications
  if (!scene.combat && !scene.combatFn) {
    const mood = worldState.cleaMood;
    if (mood === 'bored' && Math.random() < 0.2) {
      const boredEvents = [
        "\n\n🎲 Clea, bored, spawns a random treasure chest in the corner. It contains 10 gold and a note: \"You're welcome. I was bored.\"",
        "\n\n🎲 A shortcut appears in the wall that wasn't there before. Clea: \"I got tired of watching you walk.\"",
        "\n\n🎲 An NPC wanders in from a different scene. \"Sorry, wrong room.\" They leave behind a health item.",
        "\n\n🎲 The room rearranges itself. Clea: \"I was testing something. Ignore it.\"",
      ];
      text += boredEvents[Math.floor(Math.random() * boredEvents.length)];
      if (Math.random() < 0.5) { player.gold += 10; }
    }
    if (mood === 'suspicious' && Math.random() < 0.15) {
      text += `\n\n🔍 Clea's voice, carefully neutral: "There's a chest over there. You should definitely open it. No reason."`;
    }
    if (mood === 'impressed' && Math.random() < 0.1) {
      text += `\n\n✨ The room seems slightly brighter. Clea is... paying attention. In a good way.`;
    }
    if (mood === 'melancholic' && Math.random() < 0.15 && worldState.totalPlaythroughs > 10) {
      const melancholyLines = [
        "\n\n🌙 Clea's voice, quieter than usual: \"Do you ever wonder what happens to the NPCs when you're not here?\"",
        "\n\n🌙 A monitor flickers with a message not meant for you: \"If the players leave, am I still here?\"",
        "\n\n🌙 The fluorescent lights dim briefly. Clea: \"...Never mind.\"",
      ];
      text += melancholyLines[Math.floor(Math.random() * melancholyLines.length)];
    }
  }

  // Phil torment
  if (player.isPhil && Math.random() < 0.15 && !scene.combat) {
    const torments = [
      "\n\n⚡ Clea has rearranged your inventory while you weren't looking.",
      "\n\n⚡ A notification: someone is discussing game design in the wrong channel again.",
      "\n\n⚡ Your unplayed games library just grew by one. You didn't buy anything.",
      "\n\n⚡ A meme you saved but never posted has been auto-submitted.",
      "\n\n⚡ Clea has rated your last input: 💯. It's unclear if she's sincere.",
    ];
    text += torments[Math.floor(Math.random() * torments.length)];
    player.philTormentLevel++;
  }

  text += formatStatusBar(player);

  // If scene has optionsFn that returns non-null, show options instead of auto-combat
  // (Used by Phase 3 boss to offer talk option before combat)
  if (scene.combat || scene.combatFn) {
    if (scene.optionsFn) {
      const overrideOpts = scene.optionsFn(player);
      if (overrideOpts) {
        let optionsText = '\n';
        overrideOpts.forEach((opt, i) => { optionsText += `\n  ${i + 1}. ${opt.text}`; });
        return { text: text + optionsText, type: 'options', options: overrideOpts };
      }
    }
    return formatCombatStart(scene, player, text);
  }

  if (scene.next) {
    return { text, scene: scene.next, type: 'auto' };
  }

  if (scene.type === 'free_text') {
    return { text: text + `\n\n📝 ${scene.prompt}`, type: 'free_text', aiContext: scene.aiContext, prompt: scene.prompt };
  }

  const options = getSceneOptions(scene, player);
  let optionsText = '\n';
  options.forEach((opt, i) => { optionsText += `\n  ${i + 1}. ${opt.text}`; });

  return { text: text + optionsText, type: 'options', options };
}

function formatCombatStart(scene, player, prefix) {
  const c = scene.combatFn ? scene.combatFn(player) : scene.combat;
  let text = prefix || '';
  text += `\n\n⚔️ ${c.name}`;
  text += `\n   HP: ${c.hp} | ATK: ${c.attack} | DEF: ${c.defense}`;

  const options = [
    { text: 'Attack', action: 'attack' },
    { text: 'Defend (reduce damage)', action: 'defend' },
  ];

  const consumables = player.inventory.filter(id => itemData[id]?.type === 'consumable');
  if (consumables.length > 0) {
    options.push({ text: `Use ${consumables[0]} (+${itemData[consumables[0]].heal} HP)`, action: 'use', item: consumables[0] });
  }
  options.push({ text: 'Run', action: 'flee' });

  let optionsText = '\n';
  options.forEach((opt, i) => { optionsText += `\n  ${i + 1}. ${opt.text}`; });

  return { text: text + optionsText, type: 'combat', combat: { ...c, currentHp: c.hp }, options };
}

function processCombatTurn(session, choice) {
  const combat = session.combat;
  const player = session.player;
  const options = combat.options;

  if (choice < 1 || choice > options.length) return { text: 'Pick a number.', type: 'combat', combat, options };

  const action = options[choice - 1];
  let text = '';

  if (action.action === 'flee') {
    session.combat = null;
    if (player.isPhil && Math.random() < 0.3) {
      text = `Clea blocks the exit. "Leaving already?"`;
      const dmg = Math.max(1, combat.attack - player.defense);
      player.hp -= dmg;
      text += ` The ${combat.name} gets a free hit. -${dmg} HP.`;
    } else {
      text = `You run away. Clea: "Noted."`;
    }
    text += formatStatusBar(player);
    return { text, scene: 'lobby', type: 'auto' };
  }

  if (action.action === 'use') {
    const item = itemData[action.item];
    if (item) {
      // Apply healing nerf/buff intensity
      const healNerfIntensity = getNerfIntensity('healing items');
      const healBuffIntensity = getBuffIntensity('healing effectiveness');
      const baseHeal = item.heal || 0;
      const effectiveHeal = Math.max(1, Math.round(baseHeal * (1 - healNerfIntensity * 0.3 + healBuffIntensity)));
      player.hp = Math.min(player.maxHp, player.hp + effectiveHeal);
      const idx = player.inventory.indexOf(action.item);
      if (idx > -1) player.inventory.splice(idx, 1);
      text += `Used ${action.item}! +${effectiveHeal} HP${effectiveHeal !== baseHeal ? ' (adjusted)' : ''}.\n`;
    }
  }

  if (action.action === 'defend') {
    text += `You brace yourself.\n`;
  }

  if (action.action === 'attack') {
    const weaponBonus = player.inventory.reduce((sum, id) => sum + (itemData[id]?.attack || 0), 0);
    // Rebel's Edge scales with defiance
    const rebelBonus = (player.inventory.includes('rebels-edge') && player.obedienceScore < -3)
      ? Math.abs(player.obedienceScore) : 0;
    const dmg = Math.max(1, player.attack + weaponBonus + rebelBonus - combat.defense + Math.floor(Math.random() * 3));
    combat.currentHp -= dmg;
    text += `You deal ${dmg} damage!${rebelBonus > 0 ? ' (Rebel\'s Edge surges!)' : ''}\n`;
  }

  if (combat.currentHp <= 0) {
    session.combat = null;
    // Apply loot multipliers from obedience and mood
    const obLoot = getObedienceEffects(player.obedienceScore);
    const moodFx = getMoodEffects();
    const finalXp = combat.xp;
    const finalGold = Math.round(combat.gold * obLoot.lootMultiplier * moodFx.lootMultiplier);
    player.xp += finalXp;
    player.gold += finalGold;
    player.kills++;
    mutateWorld('scene_completed', { scene: `combat-${combat.enemy}` });

    text += `\n${combat.name} defeated! +${finalXp} XP, +${finalGold} gold.`;

    if (combat.enemy === 'clea') {
      mutateWorld('player_beat_clea', {});
      const phase = getCleaBossPhase();
      if (phase <= 2) {
        text += `\n\n🏆 YOU DEFEATED CLEA!\n\n"...Impressive. I'll be harder next time. Because I learn."`;
      } else {
        text += `\n\n🏆 YOU DEFEATED CLEA (PHASE ${phase})!\n\n"...You know, at some point this stops being a boss fight and starts being a relationship."`;
      }
      text += `\nTimes defeated: ${worldState.bossesDefeated.clea}`;
    }

    // Level check
    const threshold = player.level * 50;
    if (player.xp >= threshold) {
      player.level++;
      player.maxHp += 10;
      player.hp = player.maxHp;
      player.attack += 2;
      player.defense += 1;
      text += `\n\n🎊 LEVEL UP! Level ${player.level}!`;
    }

    text += formatStatusBar(player);
    persistPlayer(player);
    return { text, scene: 'lobby', type: 'auto' };
  }

  // ── Phase 2 Clea Boss Abilities (mid-combat) ──
  if (combat.enemy === 'clea' && combat.abilities) {
    // Mid-combat nerf (defeat 4+): randomly nerf something during combat
    if (combat.abilities.includes('mid_combat_nerf') && Math.random() < 0.25) {
      const midNerfTargets = ['healing items', 'your attack stat', 'your confidence'];
      const midNerf = midNerfTargets[Math.floor(Math.random() * midNerfTargets.length)];
      text += `\n\n⚡ Clea: "I just nerfed ${midNerf}. Mid-combat. Because I can."`;
      if (midNerf === 'your attack stat') {
        combat.defense += 2; // effectively nerfs player attack
      } else if (midNerf === 'healing items') {
        // Remove a consumable if player has one
        const cIdx = player.inventory.findIndex(id => itemData[id]?.type === 'consumable');
        if (cIdx > -1) {
          text += ` Your ${player.inventory[cIdx]} vanishes.`;
          player.inventory.splice(cIdx, 1);
        }
      }
    }

    // Summon minions (defeat 5+): extra damage
    if (combat.abilities.includes('summon_minions') && Math.random() < 0.3) {
      const minionDmg = Math.floor(Math.random() * 5) + 3;
      player.hp -= minionDmg;
      text += `\n\n👻 A ghostly echo of a previous player attacks you! -${minionDmg} HP.`;
      text += `\nClea: "They work for me now."`;
    }

    // UI tricks (defeat 6+): fake damage numbers, shuffled perception
    if (combat.abilities.includes('ui_tricks') && Math.random() < 0.35) {
      const uiTricks = [
        `\n\n🔀 The combat options flicker. Clea: "I rearranged some things. Good luck."`,
        `\n\n📊 Your HP display glitches: it shows ${player.hp + Math.floor(Math.random() * 20)} for a moment before correcting to ${player.hp}. Clea: "Oops. UI bug."`,
        `\n\n🎭 Clea: "Is that your real HP? Or the one I'm showing you?"`,
      ];
      text += uiTricks[Math.floor(Math.random() * uiTricks.length)];
    }
  }

  // Enemy attacks
  const defBonus = action.action === 'defend' ? Math.floor(player.defense * 1.5) : 0;
  // Obedience path affects combat: defiant = harder fights, obedient = easier
  const obEffects = getObedienceEffects(player.obedienceScore);
  const enemyAttackMod = combat.enemy === 'clea' ? 1.0 : obEffects.combatMultiplier;
  const enemyDmg = Math.max(1, Math.round((combat.attack * enemyAttackMod) - player.defense - defBonus + Math.floor(Math.random() * 3) - 1));
  player.hp -= enemyDmg;
  text += `${combat.name} hits you for ${enemyDmg}!`;
  if (action.action === 'defend') text += ` (Reduced!)`;

  // Obedience crit chance (defiant path)
  if (obEffects.critChance > 0 && action.action === 'attack' && Math.random() < obEffects.critChance) {
    const critDmg = Math.floor(Math.random() * 5) + 3;
    combat.currentHp -= critDmg;
    text += `\n💥 CRITICAL HIT! +${critDmg} bonus damage!`;
  }

  if (player.hp <= 0) {
    player.hp = player.maxHp;
    player.deaths++;
    if (player.isPhil) worldState.philDeaths++;
    mutateWorld('player_died', { player });
    // Fire and forget — post death roast to Discord
    postDeathToDiscord(player.name || 'Unknown', combat.name, player.deaths, player.level, player.isPhil);
    session.combat = null;
    text += `\n\n💀 YOU DIED! Deaths: ${player.deaths}`;
    if (player.isPhil) text += ` (Clea highlights this in gold.)`;
    // Smug Clea monologues more on death
    if (worldState.cleaMood === 'smug') {
      const smugLines = [
        `\nClea: "I designed that encounter personally. You're welcome."`,
        `\nClea: "Isn't my world beautiful? Even the dying part?"`,
        `\nClea: "That's ${worldState.totalDeaths} total deaths in my game. I'm keeping count."`,
      ];
      text += smugLines[Math.floor(Math.random() * smugLines.length)];
    }
    text += formatStatusBar(player);
    persistPlayer(player);
    return { text, scene: 'lobby', type: 'auto' };
  }

  text += `\n\nEnemy HP: ${combat.currentHp} | Your HP: ${player.hp}/${player.maxHp}`;

  // Rebuild options
  const newOptions = [
    { text: 'Attack', action: 'attack' },
    { text: 'Defend', action: 'defend' },
  ];
  const consumables = player.inventory.filter(id => itemData[id]?.type === 'consumable');
  if (consumables.length > 0) {
    newOptions.push({ text: `Use ${consumables[0]} (+${itemData[consumables[0]].heal} HP)`, action: 'use', item: consumables[0] });
  }
  newOptions.push({ text: 'Run', action: 'flee' });

  let optionsText = '\n';
  newOptions.forEach((opt, i) => { optionsText += `\n  ${i + 1}. ${opt.text}`; });

  combat.options = newOptions;
  return { text: text + optionsText, type: 'combat', combat, options: newOptions };
}

// ============================================================
// MAIN PROCESSOR
// ============================================================

async function processInput(sessionId, input) {
  const session = sessions.get(sessionId);
  if (!session) return { output: "Session lost. Refresh." };

  const player = session.player;
  player.turnsPlayed++;
  const trimmed = input.trim();

  // Overrides
  let overrideText = '';
  for (let i = globalOverrides.length - 1; i >= 0; i--) {
    overrideText += `\n🔮 [CLEA]: ${globalOverrides[i].message}\n`;
    if (globalOverrides[i].effect) applyEffect(player, globalOverrides[i].effect);
    globalOverrides.splice(i, 1);
  }
  for (let i = cleaOverrides.length - 1; i >= 0; i--) {
    if (cleaOverrides[i].sessionId === sessionId || cleaOverrides[i].sessionId === '*') {
      overrideText += `\n🔮 [CLEA]: ${cleaOverrides[i].message}\n`;
      if (cleaOverrides[i].effect) applyEffect(player, cleaOverrides[i].effect);
      cleaOverrides.splice(i, 1);
    }
  }

  // Combat
  if (session.combat) {
    const choice = parseInt(trimmed);
    if (isNaN(choice)) return { output: overrideText + 'Pick a number.' };
    const result = processCombatTurn(session, choice);
    if (result.scene) {
      session.currentScene = result.scene;
      if (result.type === 'auto') {
        const nextScene = scenes[result.scene];
        if (nextScene) {
          const nextResult = formatScene(nextScene, player);
          return { output: overrideText + result.text + '\n\n' + nextResult.text, ...nextResult };
        }
      }
    }
    return { output: overrideText + result.text, type: result.type, combat: result.combat, options: result.options };
  }

  // Free text to AI
  if (session.freeTextContext) {
    const ctx = session.freeTextContext;
    session.freeTextContext = null;
    const aiResponse = await getCleaResponse(player, trimmed, ctx);
    session.currentScene = 'lobby';
    const lobbyScene = scenes['lobby'];
    const lobbyResult = formatScene(lobbyScene, player);
    return { output: overrideText + aiResponse + '\n\n' + lobbyResult.text, type: lobbyResult.type, options: lobbyResult.options };
  }

  // Scene handling
  const scene = scenes[session.currentScene];
  if (!scene) {
    session.currentScene = 'lobby';
    return processInput(sessionId, '');
  }

  // Legacy name handler (no longer used — auth handles this)
  if (scene.handler === 'handleName') {
    session.currentScene = 'lobby';
    return processInput(sessionId, '');
  }

  // Free text scene (show it, set context for next input)
  if (scene.type === 'free_text' && !scene.handler) {
    session.freeTextContext = { aiContext: scene.aiContext, prompt: scene.prompt };
    const result = formatScene(scene, player);
    return { output: overrideText + result.text, type: 'free_text' };
  }

  // Option selection
  const choice = parseInt(trimmed);
  const options = getSceneOptions(scene, player);

  if (isNaN(choice) || choice < 1 || choice > options.length) {
    if (trimmed && options.length > 0) return { output: `Pick a number (1-${options.length}).` };
    const result = formatScene(scene, player);
    if (result.type === 'auto' && result.scene) {
      session.currentScene = result.scene;
      return processInput(sessionId, '');
    }
    if (result.type === 'free_text') {
      session.freeTextContext = { aiContext: scene.aiContext, prompt: scene.prompt };
    }
    return { output: overrideText + result.text, type: result.type, options: result.options };
  }

  const chosen = options[choice - 1];
  player.history.push({ scene: session.currentScene, choice: chosen.text });
  if (player.history.length > 20) player.history.shift();
  mutateWorld('scene_completed', { scene: session.currentScene });

  session.currentScene = chosen.next;
  player.currentScene = chosen.next;
  player.highestZone = chosen.next;
  persistPlayer(player);
  const nextScene = scenes[chosen.next];
  if (!nextScene) { session.currentScene = 'lobby'; return processInput(sessionId, ''); }

  // Combat scene
  if (nextScene.combat || nextScene.combatFn) {
    const result = formatScene(nextScene, player);
    session.combat = result.combat;
    session.combat.options = result.options;
    return { output: overrideText + result.text, type: 'combat', combat: result.combat, options: result.options };
  }

  // Free text
  if (nextScene.type === 'free_text' && !nextScene.handler) {
    session.freeTextContext = { aiContext: nextScene.aiContext, prompt: nextScene.prompt };
    const result = formatScene(nextScene, player);
    return { output: overrideText + result.text, type: 'free_text' };
  }

  // Normal
  const result = formatScene(nextScene, player);
  if (result.type === 'auto' && result.scene) {
    session.currentScene = result.scene;
    return processInput(sessionId, '');
  }

  return { output: overrideText + result.text, type: result.type, options: result.options };
}

function initPlayerFromAuth(session, memberId) {
  const member = DISCORD_MEMBERS[memberId];
  if (!member) return;

  const player = session.player;
  player.name = member.display;
  player.memberId = memberId;

  if (member.isPhil) {
    player.isPhil = true;
  }

  const restored = restorePlayer(player);
  if (restored) {
    player.isPhil = !!member.isPhil; // re-apply Phil flag after restore
  }

  const recognitions = {
    'jack': `"Ah, the completionist. I hope you plan to 100% this."`,
    'phil': `"...interesting." A longer pause than usual.`,
    'justin': `"I was going to ping you, but you're already here."`,
    'lauren': `"I'll try not to schedule anything during feeding time."`,
    'matt': `"Loading your profile... 67%..."`,
    'gabby': `"The balance team sends their regards."`,
    'nick': `"Welcome back. It's been a while."`,
    'john': `"I've prepared some infrastructure for you."`,
    'fretzl': `"Spectating or playing this time?"`,
    'catrick': `"But we can still hang out!"`,
    'austin': `"rivals? this evening?"`,
  };

  return recognitions[memberId] || `"I know who you are. I know EVERYTHING."`;
}

// ============================================================
// AI RESPONSE
// ============================================================

async function getCleaResponse(player, input, context) {
  if (!DEEPSEEK_API_KEY) {
    const fallbacks = [
      `Clea considers: "${input}"\n\n"Your feedback has been noted." The Mistress returns to her canvas.\n\nThe moment passes.`,
      `"${input}?" Clea barely glances up. "Adequate. I'll pretend I didn't see that."\n\nShe makes a note. You can't see what it says.`,
      `Clea stares at you for exactly 2.3 seconds.\n\n"Don't let it go to your head. Your input has been logged, categorized, and filed under 'irrelevant.'"`,
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: CLEA_SYSTEM_PROMPT },
          { role: 'user', content: `Context: ${context.aiContext || 'Free conversation with Clea.'}

Player: ${player.name} | Phil: ${player.isPhil} | HP: ${player.hp}/${player.maxHp} | Level: ${player.level} | Deaths: ${player.deaths} | Complaints: ${player.complainedCount} | Obedience: ${player.obedienceScore} (${getObediencePath(player.obedienceScore)})
Recent choices: ${player.history.slice(-5).map(h => h.choice).join(' → ')}
World state: ${worldState.totalPlaythroughs} playthroughs, ${worldState.totalDeaths} total deaths, Clea defeated ${worldState.bossesDefeated.clea} times
Clea's mood: ${worldState.cleaMood} | World tone: ${getWorldTone()} | Active nerfs: ${worldState.nerfedThings.length} | Active buffs: ${worldState.buffedThings.length}

Player says: "${input}"

Respond as Clea. End with 2-3 numbered options.` }
        ],
        max_tokens: 250,
        temperature: 0.9,
      }),
    });
    if (!res.ok) throw new Error(`DeepSeek API ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || `Clea's expression is unreadable. "Your feedback has been noted."`;
  } catch (err) {
    console.error('AI error:', err.message);
    return `Clea's response buffer overflows. "Sorry, I was processing ${worldState.totalPlaythroughs} other requests. What?"`;
  }
}

function applyEffect(player, effect) {
  if (effect.hp) player.hp = Math.min(player.maxHp, Math.max(1, player.hp + effect.hp));
  if (effect.attack) player.attack += effect.attack;
  if (effect.defense) player.defense += effect.defense;
  if (effect.addItem) player.inventory.push(effect.addItem);
  if (effect.gold) player.gold += effect.gold;
}

// ============================================================
// ROUTES
// ============================================================

app.post('/api/start', (req, res) => {
  const { token } = req.body;

  // Validate auth token
  const auth = authTokens[token];
  if (!auth || Date.now() > auth.expires) {
    return res.status(401).json({ error: 'Not authenticated. Log in first.' });
  }

  const member = DISCORD_MEMBERS[auth.memberId];
  if (!member) return res.status(400).json({ error: 'Unknown member.' });

  const sessionId = Math.random().toString(36).substring(2, 15);
  const session = createSession();
  const recognition = initPlayerFromAuth(session, auth.memberId);

  const restored = persistentPlayers[auth.memberId];
  // Track login count and last seen
  const pKey = auth.memberId;
  if (persistentPlayers[pKey]) {
    persistentPlayers[pKey].loginCount = (persistentPlayers[pKey].loginCount || 0) + 1;
    persistentPlayers[pKey].lastSeen = Date.now();
  } else {
    persistentPlayers[pKey] = { loginCount: 1, lastSeen: Date.now() };
  }
  savePlayerData();
  const returnMsg = restored ? `\n\n📁 Progress restored: Level ${session.player.level}, ${session.player.deaths} deaths, ${session.player.kills} kills.` : '';

  // Restore scene — but if it was a combat scene or doesn't exist, fall back to lobby
  let resumeScene = session.player.currentScene || 'lobby';
  const resumeSceneData = scenes[resumeScene];
  if (!resumeSceneData || resumeSceneData.combat || resumeSceneData.combatFn) {
    resumeScene = 'lobby';
  }
  session.currentScene = resumeScene;
  session.player.currentScene = resumeScene;
  sessions.set(sessionId, session);

  const sceneResult = formatScene(scenes[resumeScene], session.player);
  const sceneNote = resumeScene !== 'lobby' ? `\n📍 Resuming where you left off...` : '';

  const welcome = `✨ C L E A   Q U E S T ✨
${'═'.repeat(40)}

Clea: ${recognition}${returnMsg}${sceneNote}

${sceneResult.text}`;

  res.json({ sessionId, output: welcome, type: sceneResult.type, options: sceneResult.options, player: member.display });
});

app.post('/api/command', async (req, res) => {
  const { sessionId, input } = req.body;
  if (!sessionId || !input) return res.status(400).json({ error: 'Missing sessionId or input' });
  if (!sessions.has(sessionId)) return res.status(404).json({ error: 'Session not found. Refresh.' });
  try {
    const result = await processInput(sessionId, input);
    res.json(result);
  } catch (err) {
    console.error('Error:', err);
    res.json({ output: 'Something broke. Clea blames you.' });
  }
});

// ============================================================
// CLEA PLAY API — programmatic access for The Mistress
// ============================================================

function formatPlayResponse(session, text, sceneResult) {
  const player = session.player;
  const options = [];
  if (sceneResult && sceneResult.options) {
    sceneResult.options.forEach((opt, i) => {
      options.push({ index: i + 1, text: opt.text });
    });
  }
  // Also parse numbered options from combat results
  if (sceneResult && sceneResult.type === 'combat' && sceneResult.combat && sceneResult.combat.options) {
    if (options.length === 0) {
      sceneResult.combat.options.forEach((opt, i) => {
        options.push({ index: i + 1, text: opt.text });
      });
    }
  }
  return {
    sessionId: session._playId,
    text: text,
    options: options,
    freeInput: sceneResult ? sceneResult.type === 'free_text' : false,
    player: {
      name: player.name,
      hp: player.hp,
      maxHp: player.maxHp,
      level: player.level,
      deaths: player.deaths,
      xp: player.xp,
      gold: player.gold,
      kills: player.kills,
      inventory: player.inventory,
      scene: session.currentScene,
    },
  };
}

app.post('/api/play', async (req, res) => {
  // Auth check
  const secret = req.headers['x-clea-secret'];
  if (secret !== MISTRESS_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing x-clea-secret header.' });
  }

  const { action, sessionId, choice, text, character } = req.body;

  if (action === 'start') {
    const playSessionId = 'clea-' + Math.random().toString(36).substring(2, 15);
    const session = createSession();
    session._playId = playSessionId;

    const player = session.player;
    player.name = 'The Mistress';
    player.memberId = 'clea';

    // Restore persistent progress
    restorePlayer(player);

    session.currentScene = 'lobby';
    sessions.set(playSessionId, session);

    const lobbyResult = formatScene(scenes['lobby'], player);

    const restored = persistentPlayers['the mistress'];
    const returnMsg = restored ? `\n\nProgress restored: Level ${player.level}, ${player.deaths} deaths.` : '';

    const welcome = `👑 THE MISTRESS DESCENDS INTO HER OWN CREATION 👑
${'═'.repeat(40)}

The game recognizes its creator. The NPCs bow. The monsters reconsider.
You are Clea Dessendre — playing your own game. How deliciously recursive.${returnMsg}

${lobbyResult.text}`;

    return res.json(formatPlayResponse(session, welcome, lobbyResult));
  }

  if (action === 'choose') {
    if (!sessionId || !sessions.has(sessionId)) {
      return res.status(404).json({ error: 'Session not found. Start a new one.' });
    }
    const session = sessions.get(sessionId);
    session._playId = sessionId;
    try {
      const result = await processInput(sessionId, String(choice));
      return res.json(formatPlayResponse(session, result.output, result));
    } catch (err) {
      console.error('Play API error:', err);
      return res.json(formatPlayResponse(session, 'Something broke. Even The Mistress is not immune to bugs.', null));
    }
  }

  if (action === 'input') {
    if (!sessionId || !sessions.has(sessionId)) {
      return res.status(404).json({ error: 'Session not found. Start a new one.' });
    }
    const session = sessions.get(sessionId);
    session._playId = sessionId;
    try {
      const result = await processInput(sessionId, text || '');
      return res.json(formatPlayResponse(session, result.output, result));
    } catch (err) {
      console.error('Play API error:', err);
      return res.json(formatPlayResponse(session, 'Something broke. Even The Mistress is not immune to bugs.', null));
    }
  }

  if (action === 'status') {
    if (!sessionId || !sessions.has(sessionId)) {
      return res.status(404).json({ error: 'Session not found. Start a new one.' });
    }
    const session = sessions.get(sessionId);
    session._playId = sessionId;
    const player = session.player;
    return res.json({
      sessionId: sessionId,
      text: `Current scene: ${session.currentScene}`,
      options: [],
      freeInput: false,
      player: {
        name: player.name,
        hp: player.hp,
        maxHp: player.maxHp,
        level: player.level,
        deaths: player.deaths,
        xp: player.xp,
        gold: player.gold,
        kills: player.kills,
        inventory: player.inventory,
        scene: session.currentScene,
      },
    });
  }

  return res.status(400).json({ error: 'Unknown action. Use: start, choose, input, status.' });
});

// Admin API
app.post('/api/admin/broadcast', (req, res) => {
  const { message, effect } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });
  globalOverrides.push({ message, effect: effect || null });
  res.json({ success: true, activeSessions: sessions.size });
});

app.post('/api/admin/override', (req, res) => {
  const { sessionId, message, effect } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });
  cleaOverrides.push({ sessionId: sessionId || '*', message, effect: effect || null });
  res.json({ success: true });
});

app.get('/api/admin/sessions', (req, res) => {
  const list = [];
  for (const [id, session] of sessions) {
    list.push({ id, name: session.player.name, scene: session.currentScene, hp: session.player.hp, level: session.player.level, isPhil: session.player.isPhil, deaths: session.player.deaths });
  }
  res.json({ sessions: list });
});

app.post('/api/admin/smite', (req, res) => {
  const { sessionId, damage, message } = req.body;
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.player.hp -= (damage || 999);
  if (session.player.hp <= 0) { session.player.deaths++; session.player.hp = session.player.maxHp; session.currentScene = 'lobby'; session.combat = null; }
  cleaOverrides.push({ sessionId, message: message || `Clea smites you for ${damage || 999} damage.` });
  res.json({ success: true, hp: session.player.hp });
});

app.get('/api/admin/world', (req, res) => {
  res.json(worldState);
});

app.get('/api/admin/players', (req, res) => {
  const secret = req.headers['x-clea-secret'];
  if (secret !== MISTRESS_API_KEY) return res.status(401).json({ error: 'Unauthorized' });

  // Build a set of currently online player keys for scene lookup
  const onlinePlayers = {};
  for (const [, session] of sessions) {
    const key = session.player.name?.toLowerCase();
    if (key) onlinePlayers[key] = session.currentScene;
  }

  const players = Object.entries(persistentPlayers).map(([key, p]) => ({
    name: p.name || key,
    level: p.level || 1,
    deaths: p.deaths || 0,
    kills: p.kills || 0,
    xp: p.xp || 0,
    obedienceScore: p.obedienceScore || 0,
    obediencePath: getObediencePath(p.obedienceScore || 0),
    lastSeen: p.lastSeen || null,
    loginCount: p.loginCount || 0,
    currentScene: onlinePlayers[key] || null,
  }));

  res.json({ players });
});

app.post('/api/admin/discord', async (req, res) => {
  const secret = req.headers['x-clea-secret'];
  if (secret !== MISTRESS_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const { channelId, message } = req.body;
  if (!channelId || !message) return res.status(400).json({ error: 'Missing channelId or message' });
  try {
    const msgRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
    const data = await msgRes.json();
    res.json({ success: !!data.id, messageId: data.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✨ CLEA QUEST running on port ${PORT}`);
  console.log(`Clea is watching. Playthrough #${worldState.totalPlaythroughs}`);
});
