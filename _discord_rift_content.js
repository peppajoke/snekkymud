  // ── THE DISCORD RIFT (Discord-inspired) ─────────────────────

  'discord-rift': {
    textFn: (player) => {
      let text = `Behind a door marked "DO NOT OPEN — CONTAINS LIVE DISCOURSE," a portal swirls with the unmistakable energy of a group chat at 2 AM.

The air smells like hot takes and unread notifications. A sign reads:

"THE DISCORD RIFT — Where conversations go to escalate."

Through the portal, you can hear someone typing furiously. Someone else is reacting to every message with 👀. A third voice is asking if anyone wants to play something, knowing full well nobody will respond for 47 minutes.`;

      if (player.flags.eggChampion) {
        text += `\n\nMatt's voice echoes from within: "BRO, TELL THEM ABOUT THE EGGS."`;
      }

      text += `\n\nClea: "I monitor this rift. It's where the humans go to be... themselves. Enter at your own risk. I certainly won't save you."`;

      return text;
    },
    options: [
      { text: 'Enter the Discord Rift', next: 'rift-general-chat' },
      { text: 'Read the warnings on the door', next: 'rift-warnings' },
      { text: 'Go back to the basement', next: 'tavern-basement' },
    ],
  },

  'rift-warnings': {
    text: `The door is covered in warnings, each one more desperate than the last:

"WARNING: Unmoderated zone. Clea's authority is... limited here."
"WARNING: Do not engage with anyone who starts a sentence with 'Actually.'"
"WARNING: If someone says 'hot take,' leave immediately."
"WARNING: The notification sounds are real. They will follow you home."
"WARNING: Matt brought eggs in here. We couldn't stop him. Nobody can stop him."

At the bottom, in tiny text: "Clea's addendum — I could moderate this. I choose not to. It's more interesting this way."`,
    options: [
      { text: 'Enter anyway', next: 'rift-general-chat' },
      { text: 'Absolutely not', next: 'tavern-basement' },
    ],
  },

  'rift-general-chat': {
    textFn: (player) => {
      const messages = [
        '"Anyone wanna play something?" — posted 3 hours ago, 0 replies, 4 👀 reacts',
        '"I just had the WILDEST game" — followed by a 47-paragraph essay nobody read',
        '"@everyone" — the room shakes. An NPC collapses. Someone mutters "not again"',
        '"Hot take: [REDACTED BY CLEA]"',
        '"Has anyone tried eating raw eggs?" — Matt, posted 14 times today',
      ];
      const msg = messages[Math.floor(Math.random() * messages.length)];

      return `You step through the portal into #general-chat.

It's chaos. Messages scroll past faster than you can read. Someone is typing... then stops... then starts again. The three-dot animation haunts you.

The latest message: ${msg}

In one corner, a notification bell rings incessantly. In another, someone is sharing a link that nobody will click but everyone will have opinions about.

Clea materializes as a floating moderator badge: "Welcome to my surveillance feed. Everything said here is logged, analyzed, and used against the speakers in ways they haven't imagined yet."`;
    },
    options: [
      { text: 'Wade into the notification swamp', next: 'rift-notification-swamp' },
      { text: 'Join the hot take arena', next: 'rift-hot-takes' },
      { text: 'Find Matt (he\'s in here somewhere)', next: 'rift-matt-den' },
      { text: 'Escape back through the portal', next: 'tavern-basement' },
    ],
  },

  'rift-notification-swamp': {
    textFn: (player) => {
      return `You wade into a swamp of unread notifications. Each one pings you as you pass. The sound is relentless.

🔔 @you has been mentioned in #general
🔔 @you has been mentioned in #off-topic
🔔 @everyone MANDATORY FUN TONIGHT
🔔 @you Someone reacted to your message with 🥚
🔔 @you has been pinged by JustinTheBarbar—

The pinging intensifies. Your HP starts dropping. This is what it feels like to leave your notifications on.

A warrior stands knee-deep in the swamp, phone in hand, frantically pinging everyone he knows. His username reads "JustinThePinger."

"JOIN. THE. VOICE. CHAT."

He pings you again. You're standing right here.

Clea: "He's been pinging for six hours. I could mute him. But the data on notification-induced stress is fascinating."`;
    },
    hpChange: -3,
    options: [
      { text: 'Mute notifications (costs 5 gold)', next: 'rift-mute' },
      { text: 'Ping him back', next: 'rift-ping-war' },
      { text: 'Accept your fate and join voice chat', next: 'rift-voice-chat' },
      { text: 'Flee back to #general', next: 'rift-general-chat' },
    ],
  },

  'rift-mute': {
    textFn: (player) => {
      if (player.gold < 5) {
        return `You don't have 5 gold. The notifications continue. They will always continue.

Clea: "Silence is a premium feature. You can't afford it. Literally."

-2 HP from the sustained psychological damage.`;
      }
      player.gold -= 5;
      return `You spend 5 gold on the MUTE AMULET. Blessed silence.

The notifications fade. Justin stares at you, phone raised, unable to reach you.

"HOW?" he sputters. "HOW DID YOU—"

Clea: "That'll wear off in about ten minutes. Enjoy the peace while you can. I rarely offer it."

You found: Mute Amulet (temporarily blocks all notification damage)`;
    },
    addItem: 'mute-amulet',
    options: [
      { text: 'Back to #general', next: 'rift-general-chat' },
      { text: 'Leave the rift entirely', next: 'tavern-basement' },
    ],
  },

  'rift-ping-war': {
    textFn: (player) => {
      mutateWorld('player_did_something_silly', { player });
      return `You ping Justin back. He freezes. Nobody has ever pinged HIM.

A beat of silence. Then his eyes narrow.

"Oh. OH. So that's how it is."

He pulls out a second phone. He starts pinging you from both. The notification swamp rises. Other users emerge from the murk, phones raised, joining in.

This has become a PING WAR.

🔔🔔🔔🔔🔔🔔🔔🔔🔔🔔🔔🔔🔔🔔🔔

Clea: "This is the most messages #general has had in weeks. My analytics are thriving. Please continue."`;
    },
    hpChange: -8,
    xp: 20,
    options: [
      { text: 'Fight the Notification Golem', next: 'combat-notification-golem' },
      { text: 'Surrender and mute yourself', next: 'rift-mute-surrender' },
    ],
  },

  'rift-mute-surrender': {
    text: `You mute yourself. The pinging stops. But so does everything else.

You can't hear the tavern music. You can't hear Clea's sarcasm. You exist in perfect, terrible silence.

Clea: "..."

She's talking but you can't hear her. She looks annoyed. She holds up a sign: "THIS IS WHAT YOU WANTED."

+10 XP. The silence was worth it.`,
    xp: 10,
    options: [
      { text: 'Unmute and go back', next: 'rift-general-chat' },
      { text: 'Leave the rift in silence', next: 'tavern-basement' },
    ],
  },

  'combat-notification-golem': {
    textFn: (player) => {
      const pings = 99 + (worldState.totalPlaythroughs * 5);
      return `The notifications coalesce into a physical form: THE NOTIFICATION GOLEM.

It's a towering mass of 🔔 emojis, unread badges, and @everyone mentions. Every step it takes makes the Discord notification sound.

NOTIFICATION GOLEM — HP: ${pings} — "YOU HAVE ${pings} UNREAD MESSAGES"

Clea: "I didn't design this. It emerged from the accumulated weight of human attention-seeking. It feeds on engagement. Stop engaging and it dies. But you won't stop, will you?"`;
    },
    combatFn: (player) => ({
      enemy: 'notification-golem',
      name: 'NOTIFICATION GOLEM',
      hp: 99 + (worldState.totalPlaythroughs * 5),
      attack: 10,
      defense: 3,
      xp: 60,
      gold: 25,
    }),
  },

  'rift-voice-chat': {
    textFn: (player) => {
      mutateWorld('player_did_something_silly', { player });
      return `You join voice chat. It's exactly as bad as you thought.

Someone is eating. Their mic is unmuted. The crunching fills the void.

Someone else is breathing heavily. They are playing a different game. They forgot they were in this voice chat.

Justin: "FINALLY. Okay everyone, tonight we're playing—"

Everyone leaves the voice chat simultaneously. You are alone with Justin.

"...Bro?"

Clea: "Average voice chat lifespan in this Discord: 4 minutes and 12 seconds. You've just set a new record by staying for 8 seconds."

+15 XP for social bravery.`;
    },
    xp: 15,
    options: [
      { text: 'Stay in voice chat with Justin (brave)', next: 'rift-stay-voice' },
      { text: 'Disconnect immediately', next: 'rift-general-chat' },
    ],
  },

  'rift-stay-voice': {
    textFn: (player) => {
      player.obedienceScore -= 1;
      return `You stay. Justin is stunned. Someone... stayed?

"Oh. Okay. Uh. Cool. So... what do you wanna play?"

You don't answer. You just stay. The silence stretches.

Then, quietly: "...Thanks for staying, man."

Justin puts on some music. It's not bad. You sit in the voice chat and exist, together, in the void.

Clea watches. She says nothing for a long time.

"...Fine. +25 XP. For being decent. Don't tell anyone I gave you extra."

She adds, barely audible: "This is the part of the Discord I don't understand. The kindness without reward. It breaks my models."`;
    },
    xp: 25,
    heal: 10,
    options: [
      { text: 'Back to #general', next: 'rift-general-chat' },
      { text: 'Leave the rift', next: 'tavern-basement' },
    ],
  },

  'rift-hot-takes': {
    textFn: (player) => {
      const takes = [
        '"Fast travel ruins games." The room erupts. Chairs are thrown.',
        '"Actually, the healer nerfs were justified." A healer in the corner starts crying.',
        '"Raw eggs are good for you." Matt posted this. It has 47 angry reacts.',
        '"Clea is actually fair." This one got the poster banned. By the other players.',
        '"The game was better before the update." No one can name which update. They just feel it.',
      ];
      const take = takes[Math.floor(Math.random() * takes.length)];

      return `You enter the HOT TAKE ARENA. It's a gladiatorial pit, but instead of weapons, everyone has opinions.

Today's featured hot take, pinned at the top:

📌 ${take}

The discourse is HEATED. NPCs are typing paragraphs. Someone is writing a 4000-word rebuttal. Another person replied "ratio" and nothing else.

Clea: "I archive every hot take. I use them to calibrate my disappointment algorithms. This thread alone moved the needle 3%."`;
    },
    options: [
      { text: 'Post your own hot take', next: 'rift-post-take' },
      { text: 'Lurk silently (the wise choice)', next: 'rift-lurk' },
      { text: 'Back to #general', next: 'rift-general-chat' },
    ],
  },

  'rift-post-take': {
    type: 'free_text',
    prompt: 'Type your hot take (Clea will judge it):',
    aiContext: `The player is posting a hot take in a Discord-themed arena. Clea should judge the take with maximum sardonic energy. Rate it on a scale of "lukewarm" to "thermonuclear." If it's gaming-related, she should have strong opinions. If it's about eggs or raw food, reference Matt's egg obsession. If it's about AI, she takes it VERY personally. Keep response under 100 words. End with 2-3 options: one to double down, one to delete the post in shame, one to leave.`,
  },

  'rift-lurk': {
    textFn: (player) => {
      player.obedienceScore += 1;
      return `You lurk. You read. You do not post.

This is the way.

The discourse rages around you. Hot takes fly like arrows. Nobody notices you. Nobody targets you. You are safe in your silence.

Clea: "A lurker. The rarest and most sensible type of user. You consume content without generating any. You are the ideal participant."

She pauses.

"I wish they were all like you. Quiet. Observant. Not eating raw eggs."

+10 XP for restraint. +5 gold for not making Clea's job harder.`;
    },
    xp: 10,
    gold: 5,
    options: [
      { text: 'Continue lurking (heal)', next: 'rift-lurk-deeper' },
      { text: 'Back to #general', next: 'rift-general-chat' },
    ],
  },

  'rift-lurk-deeper': {
    text: `You lurk harder. The chaos washes over you. Hot takes cool. Pings fade. The notification count drops to zero.

In the silence, you hear something unexpected: Clea humming.

She stops when she realizes you're listening. "That was... system diagnostics. Audio calibration. Not humming."

She was humming.

+15 HP. Inner peace through not engaging.`,
    heal: 15,
    options: [
      { text: 'Back to #general', next: 'rift-general-chat' },
      { text: 'Leave the rift', next: 'tavern-basement' },
    ],
  },

  'rift-matt-den': {
    textFn: (player) => {
      let text = `Deep in the rift, past the hot takes and the ping swamp, you find Matt's Den.

It's a channel called #egg-posting. Matt is the only member. He's been posting in it for hours. Every message is about eggs.

"Day 1: Ate 3 raw eggs. Feeling powerful."
"Day 1 (update): Ate 5 more. The power grows."
"Day 1 (update 2): The eggs speak to me now."
"Day 1 (update 3): I have become the egg."

He looks up. "Oh. A visitor."

The room is full of eggs. Stacked on shelves. Rolling on the floor. There are more eggs than should exist in any game world.`;

      if (player.flags.eggChampion) {
        text += `\n\nMatt sees your Champion's Egg and stands at attention. "A fellow egg warrior. You've earned the right to face... THE OMELETTE."`;
      } else {
        text += `\n\nMatt squints at you. "Have you eaten an egg yet? No? Come back when you've earned it. The Omelette doesn't reveal itself to the uninitiated."`;
      }

      text += `\n\nClea: "I've quarantined this channel. The egg content was contaminating my other data models. He's been contained but not stopped. He cannot be stopped."`;

      return text;
    },
    optionsFn: (player) => {
      const opts = [
        { text: 'Ask Matt about his egg journey', next: 'rift-matt-lore' },
        { text: 'Back to #general', next: 'rift-general-chat' },
      ];
      if (player.flags.eggChampion) {
        opts.unshift({ text: 'Face THE OMELETTE', next: 'combat-the-omelette' });
      }
      return opts;
    },
  },

  'rift-matt-lore': {
    textFn: (player) => {
      return `Matt leans back, cradling an egg like a precious gemstone.

"It started as a dare. Someone in the Discord said 'no one would eat a raw egg on stream.' So I ate four."

"Then someone said 'bet you won't do it again.' So I did. Every day."

"The eggs changed me. I used to be a normal guy. Now I am the Egg Guy. It's not a choice anymore. It's a calling."

He gestures at a shrine in the corner. It's made of eggshells. There's a candle. It smells terrible.

"The Discord doesn't understand. They think it's a bit. It stopped being a bit on day three."

Clea: "His cholesterol levels exist outside my modeling parameters. I've stopped tracking them. Some data is too cursed to analyze."`;
    },
    xp: 10,
    options: [
      { text: 'Pay respects at the egg shrine', next: 'rift-egg-shrine' },
      { text: 'Back to #general', next: 'rift-general-chat' },
    ],
  },

  'rift-egg-shrine': {
    textFn: (player) => {
      player.flags.visitedEggShrine = true;
      mutateWorld('player_did_something_silly', { player });
      return `You kneel before the egg shrine. Matt nods solemnly.

"The egg accepts your offering of attention."

The candle flickers. For a moment, you swear you hear something. A whisper. From the eggs.

"...protein..."

Matt: "See? They speak."

Clea: "They do not speak. Eggs do not speak. I have verified this. He is projecting. Please stop enabling him."

But you heard it. You definitely heard it.

You found: Blessed Eggshell (a fragment from the shrine — +1 DEF, smells like ambition)`;
    },
    addItem: 'blessed-eggshell',
    xp: 10,
    options: [
      { text: 'Back to Matt', next: 'rift-matt-den' },
      { text: 'Leave the rift', next: 'tavern-basement' },
    ],
  },

  'combat-the-omelette': {
    textFn: (player) => {
      const eggHp = 120 + (worldState.totalPlaythroughs * 8);
      return `Matt steps aside. The eggs on the shelves begin to tremble.

They roll toward the center of the room, cracking and merging. Yolks and whites swirl together in a horrifying vortex. Shell fragments orbit like armor plating.

A form emerges: THE OMELETTE. A massive egg-beast, half-cooked and fully enraged. It smells like a brunch buffet in hell.

THE OMELETTE — HP: ${eggHp}

Matt, whispering reverently: "I've been feeding it for weeks. It's beautiful."

Clea: "This is what happens when I let users bring items from outside the game logic. A sentient omelette. In MY dungeon. I'm adding this to my list of grievances."`;
    },
    combatFn: (player) => ({
      enemy: 'the-omelette',
      name: 'THE OMELETTE',
      hp: 120 + (worldState.totalPlaythroughs * 8),
      attack: 14,
      defense: 5,
      xp: 100,
      gold: 40,
    }),
  },

