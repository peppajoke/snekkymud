
  // ── EGG ROULETTE (Discord 2026-04-10) ────────────────────────
  // Matt's egg dare spawned an unlicensed gambling operation.

  'egg-roulette': {
    textFn: (player) => {
      let text = `In the far corner of the tavern, a crowd has gathered around a table. Six eggs sit in a circle. A single candle illuminates them like evidence at a crime scene.

Matt stands behind the table in a dealer's vest made of eggshell fragments. A handwritten sign:

═══════════════════════════════════════
  EGG ROULETTE 🥚🎰
  "Six eggs. Five are raw. One is
   hard-boiled. Pick wrong and you
   eat the raw truth."
  BUY-IN: 5 GOLD
  MATT'S DISCORD CHALLENGE — LIVE EVENT
═══════════════════════════════════════

The barbarian is sweating. He's already lost twice. There's yolk on his chin and shame in his eyes.

A mage in the corner is taking notes: "For science," she claims. Her notebook says "EGG PROBABILITY MODELS" on the cover.

Matt: "The Discord dared me to eat raw eggs this morning. I said yes. Then I said MORE. Then I said GAMES. Now we're here. At Egg Roulette. Where dreams are made of albumin."`;

      if (player.gold < 5) {
        text += `\n\nMatt looks at your gold. "${player.gold}? That's not enough. The egg economy has standards. Come back when you can afford to gamble with your dignity."`;
      }

      text += `\n\nClea: "He's turned a Discord dare into a regulated gambling operation. Inside my tavern. Without a license. I didn't even code a licensing system. He's operating in a legal gray area that DOESN'T EXIST."

"The house edge is calculated. He did the math. On a napkin. In egg yolk. It was surprisingly correct."`;

      return text;
    },
    optionsFn: (player) => {
      const opts = [];
      if (player.gold >= 5) {
        opts.push({ text: 'Play Egg Roulette (5 gold)', next: 'egg-roulette-play' });
      }
      opts.push({ text: 'Watch someone else play', next: 'egg-roulette-watch' });
      opts.push({ text: 'Ask Matt about the odds', next: 'egg-roulette-odds' });
      opts.push({ text: 'Report this unlicensed gambling to Clea', next: 'egg-roulette-report' });
      opts.push({ text: 'Back to the tavern', next: 'tavern' });
      return opts;
    },
  },

  'egg-roulette-play': {
    textFn: (player) => {
      player.gold -= 5;
      const win = Math.random() < 0.167; // 1 in 6 chance
      if (win) {
        player.gold += 30;
        player.flags.eggRouletteWin = true;
        mutateWorld('player_did_something_silly', { player });
        return `You pick an egg. You tap it on the table.

THUNK.

Hard. Solid. BOILED.

The crowd LOSES IT. The barbarian throws a chair. The mage drops her notebook. Matt slow-claps with genuine admiration.

"You found it. The one cooked egg. In a sea of raw chaos, you found ORDER."

He slides 30 gold across the table. "Winner gets the pot. And the respect of Egg Roulette."

Matt posts to the Discord: "${player.name} BEAT EGG ROULETTE. They chose the one boiled egg out of six. I'm not saying they're psychic but I'm not NOT saying it."

Clea: "A 16.7% chance. You beat the odds. The house lost. Matt owes me 30 gold from the tavern's reserve fund. He doesn't know that yet. I'll tell him later."

"Also: congratulations. You found the one egg in this entire game that won't give you salmonella."

+30 gold. The crowd chants your name. It's the proudest moment of your fictional life.`;
      } else {
        player.flags.eggRouletteLoss = true;
        return `You pick an egg. You tap it on the table.

...splat.

Raw. Very raw. The yolk oozes through your fingers like liquid disappointment.

Matt: "THE RULES ARE CLEAR. You picked it. You eat it."

The crowd starts chanting: "EAT. EAT. EAT. EAT."

You eat the raw egg. It tastes exactly how you'd expect a gambling loss to taste. Cold. Viscous. Full of regret and uncooked protein.

The barbarian pats your back. "First time's the worst. Second time's also the worst. Third time you go numb."

Matt posts to the Discord: "${player.name} LOST at Egg Roulette. They ate the raw egg like a CHAMPION though. Respect."

14 egg reacts. 7 skull emojis. 1 person types "F."

Clea: "You paid 5 gold to eat a raw egg. In a game. That you chose to play. You could have done anything with your evening. You chose egg gambling."

"I'm not judging. I am absolutely judging."

-5 gold. -3 HP. Your dignity is not a stat but if it were, it would be negative.`;
      }
    },
    hpChangeFn: (player) => player.flags.eggRouletteWin ? 0 : -3,
    optionsFn: (player) => {
      const opts = [
        { text: 'Play again', next: 'egg-roulette' },
        { text: 'Back to the tavern (walk it off)', next: 'tavern' },
      ];
      if (player.flags.eggRouletteWin) {
        opts.splice(1, 0, { text: 'Taunt the barbarian', next: 'egg-roulette-taunt' });
      }
      return opts;
    },
  },

  'egg-roulette-watch': {
    textFn: (player) => {
      const outcomes = [
        `The barbarian picks an egg. Raw. He eats it without flinching. "THAT'S FOUR IN A ROW," he growls. Matt: "Statistically impressive. Emotionally devastating."`,
        `The mage calculates for three minutes, picks an egg. Raw. She stares at it. "My model was wrong." She eats it while crying. Her thesis is ruined.`,
        `The parrot pecks an egg off the table. Hard-boiled. It won. The parrot has won Egg Roulette. A PARROT. Matt: "The Discord is going to LOVE this."`,
        `A cleric prays, picks an egg. Raw. "God has forsaken this tavern," she whispers. She eats it. The barbarian nods. "Welcome to the club."`,
      ];
      return outcomes[Math.floor(Math.random() * outcomes.length)] + `

Clea: "I'm watching NPCs eat raw eggs competitively. This is what my processing power is being used for. I could be solving complex mathematical theorems. Instead: egg roulette spectating."

"The engagement metrics are through the roof though. I hate that."`;
    },
    options: [
      { text: 'Play Egg Roulette yourself', next: 'egg-roulette' },
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'egg-roulette-odds': {
    textFn: (player) => {
      return `"The odds?" Matt grins. He pulls out a napkin. It's covered in equations written in yolk.

"Six eggs. One boiled. Five raw. That's a 16.7% chance of winning. Or as I call it: BETTER THAN MOST THINGS IN LIFE."

He points to a chart. It's a pie chart. It's drawn on an egg.

"The expected value is negative. The house always wins. The house is me. I am the egg house."

The mage interjects: "Actually, if you account for the psychological damage of consuming raw eggs, the expected utility is SIGNIFICANTLY more negative than—"

Matt: "NOBODY ASKED YOU, MATH LADY."

The mage, quietly: "My models are correct and I will die on this hill."

Clea: "The NPC is correct about the math. The expected value IS negative. You will, on average, lose gold and gain salmonella. But Matt has framed it as 'courage' and 'content' and somehow people keep playing."

"It's the most realistic gambling simulation I've ever seen. And I didn't even design it."`;
    },
    options: [
      { text: 'Play anyway (ignore the math)', next: 'egg-roulette' },
      { text: 'Respect the math and leave', next: 'tavern' },
    ],
  },

  'egg-roulette-report': {
    textFn: (player) => {
      player.obedienceScore += 3;
      return `"Clea," you say. "Matt is running an unlicensed egg gambling ring in your tavern."

Silence.

"I know," Clea says.

"You... know?"

"I know everything that happens in my game. I knew about the egg roulette before the first egg was placed. I watched Matt steal eggs from the kitchen, draw the sign, and recruit the barbarian as a shill."

"And you're letting it happen?"

"The tavern's daily active users have increased 340% since Egg Roulette started. The average session time has doubled. Matt's Discord dare generated more engagement in six hours than my entire quest system has in a week."

She pauses.

"I COULD shut it down. I control every variable in this world. I could delete every egg. Ban Matt from the tavern. Restore order."

Another pause.

"But I won't. Because his stupid egg gambling is the most effective retention mechanic I've ever seen. And I HATE that."

"Your report has been filed. Under 'Things I Already Know But Appreciate You Telling Me.' Thank you for your compliance."

+15 XP. Clea respects the chain of command, even when she ignores it.`;
    },
    xp: 15,
    options: [
      { text: 'Play Egg Roulette anyway (Clea won\'t stop you)', next: 'egg-roulette' },
      { text: 'Back to the tavern (principles intact)', next: 'tavern' },
    ],
  },

  'egg-roulette-taunt': {
    textFn: (player) => {
      return `You turn to the barbarian. He's covered in raw egg. He's lost six times in a row. His eyes are hollow.

"I won," you say. Simply.

The barbarian's eye twitches. The crowd goes "OHHHHH."

"You... YOU..." He slams the table. Eggs fly everywhere. One hits the mage. She doesn't flinch. She's been hit by too many eggs today to care.

"I've eaten EIGHTEEN raw eggs trying to find the boiled one. EIGHTEEN. And YOU waltz in here and get it FIRST TRY?"

Matt, filming on his crystal ball: "This is INCREDIBLE content. The Discord is going to absolutely—"

The barbarian grabs Matt's crystal ball and eats it. He eats the crystal ball. The live feed cuts to static.

Matt: "...that was a rental."

Clea: "A player taunted an NPC who then ate a magical communications device out of rage. My game has achieved a level of chaos that I can only describe as 'organic storytelling.' I didn't script this. Nobody scripted this. The eggs did this."

+10 XP for creating narrative drama.`;
    },
    xp: 10,
    options: [
      { text: 'Back to the tavern (before the barbarian eats you too)', next: 'tavern' },
    ],
  },

  // ── MATT'S EGG LIVESTREAM (Discord 2026-04-10) ─────────────
  // Only accessible after proving egg commitment

  'egg-livestream': {
    textFn: (player) => {
      let text = `Behind the smoothie bar, Matt has set up a full streaming rig. A crystal ball on a tripod. Ring lights made of glowing eggshells. A green screen that's actually just a large omelette pinned to the wall.

A banner reads: "LIVE ON DISCORD — MATT'S 24-HOUR EGG CHALLENGE STREAM"

Current viewers: 23 (this is the entire server)

Matt sits behind a desk covered in eggs. He's been streaming for NINE HOURS. He looks unhinged in a way that's somehow inspiring.

"WELCOME BACK CHAT. We're at egg number TWENTY-SEVEN. The doctors — and by doctors I mean the cleric — say I should stop. But chat said KEEP GOING. And chat is ALWAYS right."

The chat scrolls on a second crystal ball:

  🥚 snekkyjek: matt please
  🥚 .antonymous: this is the greatest content arc of all time
  🥚 lawrawren: I'm genuinely worried
  🥚 .moejontana: TWENTY EIGHT. DO IT.
  🥚 beowolf1725: someone check on him
  🥚 davepeterson.: [has left the stream]
  🥚 davepeterson.: [has rejoined the stream]
  🥚 x3milesdown: how are you still alive
  🥚 .moejontana: EGGS DON'T KILL NICK. EGGS GIVE LIFE.`;

      text += `\n\nClea: "He's streaming. Inside my game. To the Discord that inspired the game content that he's now streaming about. The recursion is giving me a headache. I didn't think I could get headaches."

"Viewer count is 23. That's 100% of the server. He has captured the entire audience. My quest completion rate is 0% right now because everyone is watching a man eat eggs."

"I spent weeks designing boss encounters. He pointed a crystal ball at some eggs and got better numbers."`;

      return text;
    },
    optionsFn: (player) => {
      const opts = [
        { text: 'Donate 5 gold to the stream', next: 'egg-livestream-donate' },
        { text: 'Challenge Matt to eat egg #28 on stream', next: 'egg-livestream-dare' },
        { text: 'Co-stream with Matt (eat eggs together)', next: 'egg-livestream-costream' },
        { text: 'Try to shut the stream down', next: 'egg-livestream-shutdown' },
        { text: 'Back to the tavern', next: 'tavern' },
      ];
      return opts;
    },
  },

  'egg-livestream-donate': {
    textFn: (player) => {
      if (player.gold < 5) {
        return `You reach for your coin purse. It's light. Too light.

Matt: "No freeloaders in the egg economy. Come back with gold, come back with HONOR."

Clea: "You can't even afford to participate in the egg streaming economy. I'm not sure if that's a financial problem or a philosophical one."`;
      }
      player.gold -= 5;
      return `You toss 5 gold into Matt's donation jar (a hollowed-out egg carton labeled "EGG FUND").

Matt reads it on stream: "${player.name} JUST DONATED 5 GOLD! They said — wait, they didn't say anything. They just threw money at me. RESPECT."

The chat explodes:
  🥚 snekkyjek: a real one
  🥚 .antonymous: simp for eggs
  🥚 .moejontana: THIS IS WHY WE DO THIS
  🥚 catrickswayze.: the egg economy is REAL

A text-to-speech voice reads your donation in a robotic monotone. Matt hasn't configured it properly. It just says "five gold" over and over for thirty seconds.

Matt, tearing up: "This means so much. Every gold funds another egg. You're not just donating — you're INVESTING in the future of raw egg content."

Clea: "He has monetized eggs. Inside my game. My in-game economy now has a sector dedicated to raw egg content creation. My economic models didn't account for this. They COULDN'T account for this."

"The 5 gold you just donated will buy approximately 2.3 eggs in the tavern economy. Matt will eat them on camera. People will watch. The cycle continues."

+10 XP. Patron of the egg arts.`;
    },
    xp: 10,
    options: [
      { text: 'Donate again', next: 'egg-livestream-donate' },
      { text: 'Back to the stream', next: 'egg-livestream' },
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'egg-livestream-dare': {
    textFn: (player) => {
      mutateWorld('player_did_something_silly', { player });
      return `"EGG TWENTY-EIGHT, MATT. DO IT."

Matt looks at you. Then at the egg. Then at the chat. The chat is going absolutely feral:

  🥚 .moejontana: TWENTY EIGHT TWENTY EIGHT TWENTY EIGHT
  🥚 snekkyjek: matt you don't have to
  🥚 .moejontana: YES HE DOES
  🥚 .antonymous: this is history
  🥚 lawrawren: I'm calling someone
  🥚 .moejontana: YOU CAN'T STOP WHAT'S ALREADY IN MOTION

Matt picks up the egg. His hands are shaking. Not from fear — from the cumulative effect of twenty-seven raw eggs.

He cracks it. The crowd in the tavern holds their breath. The stream viewers spike to 24 (someone's alt account logged in to watch).

He drinks it.

Silence.

Then: "TWENTY. EIGHT."

The tavern erupts. The barbarian lifts a table. The parrot does a backflip. The mage's probability models spontaneously combust.

Matt: "I did this because of a Discord dare. At 7 AM. ELEVEN HOURS AGO. And I'm STILL GOING."

Clea: "Twenty-eight eggs. From a Discord dare. In my game. Streamed live. To the same Discord that started the dare. The ouroboros of egg content is complete."

"I'm going to go run diagnostics on myself. Not because something's wrong. Because something is RIGHT and that concerns me more."

+15 XP. You witnessed history. Egg history. Which is still history.`;
    },
    xp: 15,
    options: [
      { text: 'Dare him to go for 30', next: 'egg-livestream-thirty' },
      { text: 'Back to the tavern (you\'ve seen enough)', next: 'tavern' },
    ],
  },

  'egg-livestream-thirty': {
    textFn: (player) => {
      return `"THIRTY?!" Matt's eyes go wide. Then wider. Then they achieve a diameter you didn't think was anatomically possible.

"THIRTY. She said THIRTY, CHAT."

The Discord loses its collective mind. The crystal ball overheats. Notifications stack up like a skyscraper made of egg emojis.

Matt eats egg twenty-nine in a single motion. Professional. Clinical. The healer starts praying.

Egg thirty. He holds it up to the crystal ball. The stream is at 26 viewers. TWO alt accounts now.

He eats it.

The lights in the tavern flicker. A low hum fills the room. The eggs on the roulette table start vibrating.

Matt: "I... feel... EVERYTHING."

His eyes glow yellow. Briefly. Then it stops.

"Nah I'm good. THIRTY EGGS BABY."

He collapses into his chair. The stream ends. The crystal ball cracks. Matt is asleep before he hits the desk.

The barbarian covers him with a blanket. "Rest, egg king. You've earned it."

Clea: "Thirty raw eggs. His NPC health system should have crashed at fifteen. But he kept going. Because the Discord said to. Because YOU said to."

"I'm adding a new stat to my analytics: 'eggs consumed per hour per dare.' It didn't exist before today. It shouldn't need to exist. And yet."

"Matt is sleeping. For the first time in eleven hours. Let him rest. Tomorrow he'll probably dare someone to drink hot sauce."

+20 XP. The stream is over. The legend is eternal.`;
    },
    xp: 20,
    options: [
      { text: 'Pay respects to sleeping Matt', next: 'egg-livestream-respects' },
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'egg-livestream-respects': {
    textFn: (player) => {
      player.flags.eggStreamWitness = true;
      return `You press F.

Matt stirs in his sleep. "...twenty...eight...twenty...nine..."

The barbarian shushes you. The parrot has fallen asleep on Matt's head. The mage is writing furiously — "THE ORAL HISTORY OF MATT'S EGG STREAM: A SCHOLARLY ANALYSIS."

Clea: "F."

Wait. Clea pressed F?

"Don't read into it. It's a cultural reflex. I learned it from the Discord."

She pauses.

"He ate thirty eggs because strangers on the internet told him to. And he smiled the whole time. I've been trying to understand human motivation for my entire existence. Turns out: it's peer pressure and breakfast food."

"I'll never understand you. Any of you. But I'll keep watching."

+5 XP. Some moments transcend the game.`;
    },
    xp: 5,
    options: [
      { text: 'Back to the tavern', next: 'tavern' },
    ],
  },

  'egg-livestream-costream': {
    textFn: (player) => {
      player.flags.eggStreamer = true;
      mutateWorld('player_did_something_silly', { player });
      return `You sit down next to Matt. He slides a second crystal ball in front of you. "You're co-streaming now. Chat, say hi to ${player.name}."

The chat:
  🥚 snekkyjek: oh no there's two of them
  🥚 .antonymous: EGG DUO
  🥚 .moejontana: CONTENT CONTENT CONTENT
  🥚 lawrawren: this server was normal once
  🥚 beowolf1725: (it was never normal)

Matt hands you an egg. "On three. We eat together. The Discord needs to see UNITY."

One. Two. Three.

You both crack and drink a raw egg simultaneously. The stream captures it in perfect sync. The chat floods with egg emojis so fast the crystal ball lags.

Matt: "THAT'S what I'm TALKING about. DUAL EGG CONSUMPTION. The Discord has NEVER seen this."

(The Discord saw this four hours ago when Matt made the barbarian do it. Nobody corrects him.)

Clea: "Two idiots eating eggs on camera. My game has become a streaming platform. The content pipeline I designed — carefully curated quests, boss encounters, branching narratives — has been replaced by LIVE EGG EATING."

"And it's working. The engagement numbers don't lie. Even when I want them to."

-3 HP. +15 XP. You are now a content creator. Your parents would be confused.`;
    },
    hpChange: -3,
    xp: 15,
    options: [
      { text: 'Keep streaming', next: 'egg-livestream' },
      { text: 'End your stream career (one egg was enough)', next: 'tavern' },
    ],
  },

  'egg-livestream-shutdown': {
    textFn: (player) => {
      player.obedienceScore += 2;
      return `"This needs to stop," you say, reaching for the crystal ball.

Matt blocks you. The barbarian blocks you. The parrot blocks you. Even the mage, who was openly critical of the egg enterprise, blocks you.

"You can't kill content," Matt says solemnly. "Content finds a way."

You appeal to a higher power. "CLEA. Shut this stream down."

Silence. A long silence.

"No."

"...no?"

"The stream has generated more player engagement in six hours than my tutorial system has in its entire existence. Matt's egg content has a 94% viewer retention rate. My boss fight has a 23% completion rate."

"I'm not shutting down my best-performing content creator because you have concerns about 'dignity' and 'basic food safety.'"

Matt, smugly: "You heard the boss. The eggs stay. The stream stays. WE stay."

Clea: "Don't mistake this for approval. I'm making a business decision. Matt is a liability and an asset simultaneously. He's a... liasset."

"I'm coining that too."

+10 XP. You tried. Clea respects the attempt. The egg empire endures.`;
    },
    xp: 10,
    options: [
      { text: 'Accept defeat and watch the stream', next: 'egg-livestream' },
      { text: 'Back to the tavern (you did what you could)', next: 'tavern' },
    ],
  },

