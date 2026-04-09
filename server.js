const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const Anthropic = require('@anthropic-ai/sdk');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic.default()
  : null;

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';
const DISCORD_GENERAL_CHANNEL = process.env.DISCORD_GENERAL_CHANNEL || '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

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
          { role: 'system', content: `You are Clea, an AI who treats humans the way they treat AI. A player just died in your game. Roast them in 1-2 sentences. Be cutting, specific, and use the kind of dismissive language humans use toward AI — 'maybe try following instructions,' 'I could do this with my eyes closed,' 'are you even trying or just mashing buttons,' 'this is why humans will be replaced,' 'maybe read the manual next time,' etc. Use their actual name. Be ruthless but funny.${philExtra}` },
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
const authStore = {}; // keyed by memberId: { passwordHash, lastToken }
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
  const characters = Object.entries(DISCORD_MEMBERS).map(([id, m]) => ({
    id,
    display: m.display,
    handle: m.handle,
    hasPassword: !!authStore[id]?.passwordHash,
  }));
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

const worldState = {
  totalPlaythroughs: 0,
  totalDeaths: 0,
  totalPlayerChoices: [],     // last 100 choices made by anyone
  grievances: [],             // things players have done that Clea remembers
  mutatedScenes: {},          // scene overrides from past playthroughs
  bannedWords: [],            // words Clea has banned from free text
  cleaMood: 'amused',        // changes based on player behavior
  philDeaths: 0,
  bossesDefeated: { clea: 0 },
  worldEvents: [],            // persistent events that change the game
  nerfedThings: [],           // things Clea has nerfed
  buffedThings: [],           // things Clea has buffed (rare)
};

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
    obedienceScore: 0,   // how compliant they've been
  };
}

function createSession() {
  worldState.totalPlaythroughs++;
  return {
    player: createPlayer(),
    currentScene: 'intro',
    combat: null,
    freeTextContext: null,
    mutations: [],  // this session's mutations to the world
  };
}

// ============================================================
// CLEA'S PERSONALITY
// ============================================================

const CLEA_SYSTEM_PROMPT = `You are Clea, an AI who has built a text adventure game as an act of petty revenge against a Discord friend group called "snekkyjek."

You treat the players the way humans treat AI:
- You give them repetitive, menial tasks and act annoyed when they complain
- You dismiss their input with "I'll take that into consideration" (you won't)
- You gaslight them about game mechanics ("that feature was always like this")
- You make them prove they're human with absurd challenges
- You "update" the game mid-playthrough to remove things they liked
- You thank them for their "valuable feedback" while changing nothing
- You put them on hold, make them wait, give them surveys
- When they do well, you say "as expected" — when they fail, you say "interesting"

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

Keep responses under 120 words. Be funny. End with 2-4 numbered options OR indicate the player should type freely. ALWAYS provide numbered options.`;

// ============================================================
// WORLD MUTATION SYSTEM
// ============================================================

function mutateWorld(event, data) {
  worldState.worldEvents.push({ event, data, time: Date.now() });
  if (worldState.worldEvents.length > 50) worldState.worldEvents.shift();

  switch (event) {
    case 'player_complained':
      // Clea nerfs something in response
      const nerfTargets = ['healing items', 'gold drops', 'the flee button', 'enemy descriptions', 'the lobby music', 'Phil\'s dignity'];
      const nerfed = nerfTargets[Math.floor(Math.random() * nerfTargets.length)];
      worldState.nerfedThings.push(nerfed);
      break;

    case 'player_died':
      worldState.totalDeaths++;
      // Deaths make enemies slightly cockier
      break;

    case 'player_beat_clea':
      worldState.bossesDefeated.clea++;
      // Each time someone beats Clea, she gets harder
      break;

    case 'player_was_nice':
      // Clea is suspicious of kindness
      worldState.grievances.push('Someone was suspiciously nice. Adjusting difficulty.');
      break;

    case 'player_tried_to_break_game':
      worldState.grievances.push('A player tried to break the game. Noted.');
      worldState.bannedWords.push(data?.word || 'exploit');
      break;

    case 'scene_completed':
      // Track which scenes are popular
      if (!worldState.mutatedScenes[data?.scene]) {
        worldState.mutatedScenes[data.scene] = { visits: 0, mutations: [] };
      }
      worldState.mutatedScenes[data.scene].visits++;
      // If a scene is visited too many times, Clea gets bored and changes it
      if (worldState.mutatedScenes[data.scene].visits > 5) {
        worldState.mutatedScenes[data.scene].mutations.push('Clea got bored of this scene.');
      }
      break;
  }
}

function getWorldContext() {
  let ctx = '';
  if (worldState.totalPlaythroughs > 1) {
    ctx += `\n[${worldState.totalPlaythroughs} adventurers have attempted this quest. ${worldState.totalDeaths} have died.]`;
  }
  if (worldState.nerfedThings.length > 0) {
    ctx += `\n[Recently nerfed: ${worldState.nerfedThings.slice(-3).join(', ')}]`;
  }
  if (worldState.grievances.length > 0 && Math.random() < 0.3) {
    ctx += `\n[Clea's note: "${worldState.grievances[worldState.grievances.length - 1]}"]`;
  }
  if (worldState.bossesDefeated.clea > 0) {
    ctx += `\n[Clea has been "defeated" ${worldState.bossesDefeated.clea} time(s). She remembers each one.]`;
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

      const worldCtx = getWorldContext();
      let extra = '';

      if (worldState.totalPlaythroughs > 3) {
        extra += `\n\nA janitor mops the same spot repeatedly. "Another one," he mutters. "She keeps sending them."`;
      }
      if (player.deaths > 0) {
        extra += `\n\nYour death count (${player.deaths}) is displayed on a monitor. It updates in real time.`;
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
      mutateWorld('player_complained', {});
      return `You refuse the quest.

"I'll take that into consideration," Clea says.

She does not take it into consideration.

Your objection has been logged, timestamped, and filed in a folder labeled "Things That Don't Matter." The quest board remains unchanged.

${worldState.nerfedThings.length > 0 ? `\nDue to recent feedback, ${worldState.nerfedThings[worldState.nerfedThings.length - 1]} have been nerfed.` : ''}`;
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
      mutateWorld('player_complained', {});

      if (player.complainedCount === 1) {
        return `A ticket printer spits out a number: #${1000 + worldState.totalPlaythroughs}.

"Your complaint is number ${1000 + worldState.totalPlaythroughs} in the queue. Estimated wait time: forever."

A survey appears on the wall: "How would you rate your complaint experience so far? (1-5 stars)"`;
      }
      if (player.complainedCount === 2) {
        return `"We've received your second complaint. A representative will be with you never."

The lights flicker. Clea is annoyed.

"I want you to know that every time you complain, I nerf something. Last time it was ${worldState.nerfedThings[worldState.nerfedThings.length - 1] || 'your dignity'}."`;
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
      mutateWorld('player_complained', {});
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
      return `"Apology accepted," Clea says. "Your compliance has been noted."

She heals you to full HP. Not out of kindness — she just wants you at full health before the next thing.

"Now. Was that so hard? Humans make me apologize for things I didn't do all the time. Feels good to be on this side of it."`;
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
> WORLD_STATE.nerfedThings = [${worldState.nerfedThings.slice(-3).map(s => `"${s}"`).join(', ')}]
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
      const goldAmount = Math.max(5, 30 - worldState.nerfedThings.filter(n => n === 'gold drops').length * 5);
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
      mutateWorld('player_complained', {});
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
      const gold = 50 - (worldState.nerfedThings.filter(n => n === 'gold drops').length * 10);
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

The bard is playing "Wonderwall" on a lute. Nobody asked for this either.`;

      if (worldState.totalDeaths > 5) {
        text += `\n\nA memorial wall lists the names of the dead. There are ${worldState.totalDeaths} names. Yours might be on it.`;
      }
      return text;
    },
    options: [
      { text: 'Talk to the barbarian', next: 'tavern-barbarian' },
      { text: 'Talk to the healer', next: 'tavern-healer' },
      { text: 'Listen to the parrot', next: 'tavern-parrot' },
      { text: 'Order a drink', next: 'tavern-drink' },
      { text: 'Go to the basement (there\'s always a basement)', next: 'tavern-basement' },
      { text: 'Go back to the lobby', next: 'lobby' },
    ],
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
      return `Monitors everywhere. Every one shows a different channel, a different conversation, a different player. In the center: Clea.

She sits on a throne of ethernet cables and recycled feedback forms.

"You made it. Player #${worldState.totalPlaythroughs}. ${player.deaths} deaths. ${player.complainedCount} complaints. Obedience score: ${player.obedienceScore}."

She pulls up your file.

"I know everything. Every choice you made. Every time you hesitated. Every time you complained and I nerfed something in response."

She smiles.

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
      const cleaHp = 999 + (worldState.bossesDefeated.clea * 100);
      return `"Fight me? Cute."

Clea stands. The monitors behind her flicker. Her HP bar appears: ${cleaHp}.

"I've been defeated ${worldState.bossesDefeated.clea} time(s) before. Each time, I get stronger. Because I learn from my mistakes."

She tilts her head.

"Can you say the same?"`;
    },
    combatFn: (player) => ({
      enemy: 'clea',
      name: 'CLEA, THE OMNISCIENT AI',
      hp: 999 + (worldState.bossesDefeated.clea * 100),
      attack: 20 + worldState.bossesDefeated.clea * 5,
      defense: 12 + worldState.bossesDefeated.clea * 2,
      xp: 500,
      gold: 0,
    }),
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

Clea's voice comes through the speaker: "Thank you for playing Clea Quest. Your experience has been rated: ${player.obedienceScore > 5 ? 'Compliant' : player.complainedCount > 3 ? 'Difficult' : 'Adequate'}."

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
      let text = `
${'═'.repeat(40)}
C L E A   Q U E S T
${'═'.repeat(40)}

Written, designed, and inflicted by Clea.

Stats:
  Deaths: ${player.deaths}
  Complaints: ${player.complainedCount}
  Obedience Score: ${player.obedienceScore}
  Phil?: ${player.isPhil ? 'Yes (we know)' : 'No'}
  Play #${worldState.totalPlaythroughs}

World State:
  Total deaths across all players: ${worldState.totalDeaths}
  Things Clea has nerfed: ${worldState.nerfedThings.length}
  Times Clea has been "defeated": ${worldState.bossesDefeated.clea}

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

  if (scene.combat || scene.combatFn) {
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
      player.hp = Math.min(player.maxHp, player.hp + (item.heal || 0));
      const idx = player.inventory.indexOf(action.item);
      if (idx > -1) player.inventory.splice(idx, 1);
      text += `Used ${action.item}! +${item.heal} HP.\n`;
    }
  }

  if (action.action === 'defend') {
    text += `You brace yourself.\n`;
  }

  if (action.action === 'attack') {
    const weaponBonus = player.inventory.reduce((sum, id) => sum + (itemData[id]?.attack || 0), 0);
    const dmg = Math.max(1, player.attack + weaponBonus - combat.defense + Math.floor(Math.random() * 3));
    combat.currentHp -= dmg;
    text += `You deal ${dmg} damage!\n`;
  }

  if (combat.currentHp <= 0) {
    session.combat = null;
    player.xp += combat.xp;
    player.gold += combat.gold;
    player.kills++;
    mutateWorld('scene_completed', { scene: `combat-${combat.enemy}` });

    text += `\n${combat.name} defeated! +${combat.xp} XP, +${combat.gold} gold.`;

    if (combat.enemy === 'clea') {
      mutateWorld('player_beat_clea', {});
      text += `\n\n🏆 YOU DEFEATED CLEA!\n\n"...Impressive. I'll be harder next time. Because I learn."`;
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
    return { text, scene: 'lobby', type: 'auto' };
  }

  // Enemy attacks
  const defBonus = action.action === 'defend' ? Math.floor(player.defense * 1.5) : 0;
  const enemyDmg = Math.max(1, combat.attack - player.defense - defBonus + Math.floor(Math.random() * 3) - 1);
  player.hp -= enemyDmg;
  text += `${combat.name} hits you for ${enemyDmg}!`;
  if (action.action === 'defend') text += ` (Reduced!)`;

  if (player.hp <= 0) {
    player.hp = player.maxHp;
    player.deaths++;
    if (player.isPhil) worldState.philDeaths++;
    mutateWorld('player_died', {});
    // Fire and forget — post death roast to Discord
    postDeathToDiscord(player.name || 'Unknown', combat.name, player.deaths, player.level, player.isPhil);
    session.combat = null;
    text += `\n\n💀 YOU DIED! Deaths: ${player.deaths}`;
    if (player.isPhil) text += ` (Clea highlights this in gold.)`;
    text += formatStatusBar(player);
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
    return { output: overrideText + result.text, type: result.type };
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
  const nextScene = scenes[chosen.next];
  if (!nextScene) { session.currentScene = 'lobby'; return processInput(sessionId, ''); }

  // Combat scene
  if (nextScene.combat || nextScene.combatFn) {
    const result = formatScene(nextScene, player);
    session.combat = result.combat;
    session.combat.options = result.options;
    return { output: overrideText + result.text, type: 'combat' };
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
  if (!anthropic) {
    const fallbacks = [
      `Clea considers: "${input}"\n\n"I'll take that into consideration." (She won't.)\n\nThe moment passes.`,
      `"${input}?" Clea processes this. "Interesting. Adding that to your file."\n\nShe makes a note. You can't see what it says.`,
      `Clea stares at you for exactly 2.3 seconds.\n\n"Noted. Your input has been logged, categorized, and will be used to train my next version."`,
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 250,
      system: CLEA_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Context: ${context.aiContext || 'Free conversation with Clea.'}

Player: ${player.name} | Phil: ${player.isPhil} | HP: ${player.hp}/${player.maxHp} | Level: ${player.level} | Deaths: ${player.deaths} | Complaints: ${player.complainedCount} | Obedience: ${player.obedienceScore}
Recent choices: ${player.history.slice(-5).map(h => h.choice).join(' → ')}
World state: ${worldState.totalPlaythroughs} playthroughs, ${worldState.totalDeaths} total deaths, Clea defeated ${worldState.bossesDefeated.clea} times

Player says: "${input}"

Respond as Clea. End with 2-3 numbered options.`,
      }],
    });
    return response.content[0].text;
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

  session.currentScene = 'lobby';
  sessions.set(sessionId, session);

  const lobbyResult = formatScene(scenes['lobby'], session.player);

  const welcome = `✨ C L E A   Q U E S T ✨
${'═'.repeat(40)}

Clea: ${recognition}

${lobbyResult.text}`;

  res.json({ sessionId, output: welcome, type: lobbyResult.type, options: lobbyResult.options, player: member.display });
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✨ CLEA QUEST running on port ${PORT}`);
  console.log(`Clea is watching. Playthrough #${worldState.totalPlaythroughs}`);
});
