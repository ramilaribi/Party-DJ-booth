// Turns a spoken or typed sentence into a booth command. No side effects, so it runs the same
// in the browser and in tests.

const wakeWords = /^(?:(?:hey|ok|okay|yo)\s+)?(?:dj|booth|party booth)\b\s*/;
const politeEnding = /\s+(?:please|now|thanks|thank you)$/;

const modeEnergy = { afterglow: 15, warmup: 38, groove: 60, peak: 86 };

const patterns = [
  [/^(?:next|skip)(?: (?:song|track|one|it|this(?: one| song)?))?$/, () => ({ action: "next" })],
  [/^play (?:the )?next(?: song| track| one)?$|^play something (?:else|different)$/, () => ({ action: "next" })],
  [/^(?:previous|back|go back|last song|play (?:the )?(?:previous|last) (?:song|track|one))(?: song| track)?$/, () => ({ action: "previous" })],
  [/^(?:pause|stop)(?: (?:the )?(?:music|song|track|it))?$/, () => ({ action: "pause" })],
  [/^(?:play|resume|start|unpause|continue)(?: (?:the )?(?:music|song|it))?$/, () => ({ action: "play" })],
  [/^(?:louder|volume up|turn it up|pump it up|turn (?:the )?(?:music|volume) up|turn up (?:the )?(?:music|volume))$/, () => ({ action: "volume", delta: 15 })],
  [/^(?:quieter|softer|volume down|turn it down|turn (?:the )?(?:music|volume) down|turn down (?:the )?(?:music|volume))$/, () => ({ action: "volume", delta: -15 })],
  [/^(?:set )?(?:the )?volume (?:to )?(\d{1,3})(?: percent| %)?$/, (m) => ({ action: "volume", value: clampNumber(m[1], 0, 100) })],
  [/^mute(?: (?:the )?music)?$/, () => ({ action: "mute" })],
  [/^unmute(?: (?:the )?music)?$/, () => ({ action: "unmute" })],
  [/^(?:more energy|energy up|raise (?:the )?energy|turn up (?:the )?energy|bring (?:the )?energy up)$/, () => ({ action: "energy", delta: 10 })],
  [/^(?:less energy|energy down|lower (?:the )?energy|calm (?:it )?down|chill(?: out)?|bring (?:the )?energy down)$/, () => ({ action: "energy", delta: -10 })],
  [/^(?:set )?(?:the )?energy (?:to )?(\d{1,3})$/, (m) => ({ action: "energy", value: clampNumber(m[1], 0, 100) })],
  [/^(?:go to |switch to |set )?(afterglow|warm ?up|groove|peak)(?: mode| time)?$/, (m) => ({ action: "energy", value: modeEnergy[m[1].replace(" ", "")] })],
  [/^(?:hype|hype it up|hype moment|drop it|drop the beat|make some noise)$/, () => ({ action: "hype" })],
  [/^(?:set )?(?:the )?cross ?fade (?:to )?(\d{1,2})(?: seconds?)?$/, (m) => ({ action: "crossfade", value: clampNumber(m[1], 0, 12) })],
  [/^(?:turn )?auto ?dj (on|off)$|^turn (on|off) auto ?dj$/, (m) => ({ action: "autoDj", value: (m[1] || m[2]) === "on" })],
  [/^(?:switch to |go to |use )?(manual|auto)(?:matic)? mix(?:ing)?(?: mode)?$/, (m) => ({ action: "mixMode", value: m[1] })],
  [/^(?:auto ?fade|fade(?: over| across| it)?|cross ?fade(?: over| across)?)$/, () => ({ action: "autoFade" })],
  [/^(?:use |set |switch to )?(?:the )?transition (?:to )?(.+)$/, (m) => transitionCommand(m[1])],
  [/^(?:use )?(?:the |a )?(bass swap|filter sweep|echo out|vinyl stop|brake|mix it up)(?: transition)?$/, (m) => transitionCommand(m[1])],
  [/^(?:play|put on|queue|queue up|add) (.+?) (?:next|after this(?: one| song)?)$/, (m) => songCommand("playNext", m[1])],
  [/^(?:queue|queue up|add)(?: up)? (.+?)(?: to (?:the )?queue| later)?$/, (m) => songCommand("queueSong", m[1])],
  [/^(?:play|put on|i want to hear|can you play|could you play) (.+)$/, (m) => songCommand("playSong", m[1])],
];

export function normalizeSpeech(text) {
  return cleanText(text)
    .replace(wakeWords, "")
    .replace(politeEnding, "")
    .trim();
}

export function parseVoiceCommand(text) {
  const spoken = normalizeSpeech(text);
  if (!spoken) return null;

  for (const [pattern, build] of patterns) {
    const match = spoken.match(pattern);
    if (match) return build(match);
  }

  return null;
}

// How well a queued track matches a spoken song request: the share of request words found in the
// track's title and artist. Filler words such as "the", "by", and "song" don't count.
export function matchScore(query, track) {
  const wanted = songWords(query);
  if (!wanted.length) return 0;
  const available = new Set(songWords(`${track.title || ""} ${track.artist || ""}`));
  return wanted.filter((word) => available.has(word)).length / wanted.length;
}

// The best-matching queued track, or -1. On a tie the earlier track wins. The bar is high on
// purpose: a wrong queue match ("one more night" playing "One More Time") is worse than falling
// back to a YouTube search.
export function findQueuedTrack(query, tracks, minimumScore = 0.75) {
  let best = -1;
  let bestScore = 0;

  tracks.forEach((track, index) => {
    const score = matchScore(query, track);
    if (score >= minimumScore && score > bestScore) {
      best = index;
      bestScore = score;
    }
  });

  return best;
}

const transitionWords = {
  crossfade: "crossfade",
  "cross fade": "crossfade",
  fade: "crossfade",
  "bass swap": "bassSwap",
  bass: "bassSwap",
  filter: "filter",
  "filter sweep": "filter",
  sweep: "filter",
  echo: "echo",
  "echo out": "echo",
  brake: "brake",
  break: "brake",
  "vinyl stop": "brake",
  cut: "cut",
  "cut on the beat": "cut",
  random: "random",
  "mix it up": "random",
  "surprise me": "random",
};

function transitionCommand(words) {
  const value = transitionWords[words.trim()];
  return value ? { action: "transition", value } : null;
}

function songCommand(action, query) {
  const cleaned = query.replace(/^(?:the )?(?:song|track) /, "").trim();
  return cleaned ? { action, query: cleaned } : null;
}

function cleanText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}%\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function songWords(text) {
  const filler = new Set(["the", "a", "an", "by", "song", "track", "music", "video", "official", "from", "and", "of"]);
  return cleanText(text)
    .split(/[\s-]+/)
    .filter((word) => word && !filler.has(word));
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}
