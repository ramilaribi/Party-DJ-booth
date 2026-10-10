import assert from "node:assert/strict";
import { test } from "node:test";
import { findQueuedTrack, matchScore, normalizeSpeech, parseVoiceCommand, requestKey } from "../public/voice.js";

const cases = [
  ["get the music back", { action: "recover" }],
  ["DJ, bring the sound back please", { action: "recover" }],
  ["fix the audio", { action: "recover" }],
  ["there's no sound", { action: "recover" }],
  ["the music stopped", { action: "recover" }],
  ["recover", { action: "recover" }],
  ["next", { action: "next" }],
  ["Next song, please!", { action: "next" }],
  ["skip this one", { action: "next" }],
  ["play the next song", { action: "next" }],
  ["play something else", { action: "next" }],
  ["go back", { action: "previous" }],
  ["previous song", { action: "previous" }],
  ["pause", { action: "pause" }],
  ["stop the music", { action: "pause" }],
  ["play", { action: "play" }],
  ["resume", { action: "play" }],
  ["play music", { action: "play" }],
  ["louder", { action: "volume", delta: 15 }],
  ["turn it up", { action: "volume", delta: 15 }],
  ["turn the volume down", { action: "volume", delta: -15 }],
  ["quieter", { action: "volume", delta: -15 }],
  ["volume 60", { action: "volume", value: 60 }],
  ["set the volume to 150 percent", { action: "volume", value: 100 }],
  ["mute", { action: "mute" }],
  ["unmute", { action: "unmute" }],
  ["more energy", { action: "energy", delta: 10 }],
  ["turn up the energy", { action: "energy", delta: 10 }],
  ["calm it down", { action: "energy", delta: -10 }],
  ["energy 75", { action: "energy", value: 75 }],
  ["peak mode", { action: "energy", value: 86 }],
  ["warm up", { action: "energy", value: 38 }],
  ["switch to groove", { action: "energy", value: 60 }],
  ["afterglow", { action: "energy", value: 15 }],
  ["hype", { action: "hype" }],
  ["drop the beat", { action: "hype" }],
  ["crossfade 8 seconds", { action: "crossfade", value: 8 }],
  ["set cross fade to 3", { action: "crossfade", value: 3 }],
  ["auto dj off", { action: "autoDj", value: false }],
  ["turn on auto DJ", { action: "autoDj", value: true }],
  ["manual mix", { action: "mixMode", value: "manual" }],
  ["switch to auto mix", { action: "mixMode", value: "auto" }],
  ["automatic mixing", { action: "mixMode", value: "auto" }],
  ["fade", { action: "autoFade" }],
  ["auto fade", { action: "autoFade" }],
  ["crossfade now", { action: "autoFade" }],
  ["transition echo out", { action: "transition", value: "echo" }],
  ["use the bass swap", { action: "transition", value: "bassSwap" }],
  ["set transition to filter sweep", { action: "transition", value: "filter" }],
  ["vinyl stop", { action: "transition", value: "brake" }],
  ["transition cut", { action: "transition", value: "cut" }],
  ["mix it up", { action: "transition", value: "random" }],
  ["play One More Time by Daft Punk", { action: "playSong", query: "one more time by daft punk" }],
  ["put on the song despacito", { action: "playSong", query: "despacito" }],
  ["add Get Lucky to the queue", { action: "queueSong", query: "get lucky" }],
  ["queue up blinding lights", { action: "queueSong", query: "blinding lights" }],
  ["play Get Lucky next", { action: "playNext", query: "get lucky" }],
  ["add didi by khaled next", { action: "playNext", query: "didi by khaled" }],
  ["put on starboy after this one", { action: "playNext", query: "starboy" }],
  ["hey DJ, next", { action: "next" }],
  ["OK booth louder", { action: "volume", delta: 15 }],
];

for (const [spoken, expected] of cases) {
  test(`"${spoken}"`, () => {
    assert.deepEqual(parseVoiceCommand(spoken), expected);
  });
}

test("ignores speech that isn't a command", () => {
  for (const spoken of ["", "   ", "hello there", "what a night", "dj", "transition banana"]) {
    assert.equal(parseVoiceCommand(spoken), null, spoken);
  }
});

test("strips wake words and punctuation", () => {
  assert.equal(normalizeSpeech("Hey DJ — play “Levels”, please!"), "play levels");
});

test("song matching ignores filler words and keeps DJ in titles", () => {
  const track = { title: "Turn Down for What", artist: "DJ Snake" };
  assert.equal(matchScore("turn down for what by dj snake", track), 1);
  assert.equal(matchScore("the song turn down for what", track), 1);
  assert.equal(matchScore("something unrelated", track), 0);
});

test("finds the best queued track, preferring the earlier one on a tie", () => {
  const tracks = [
    { title: "Alpha", artist: "Test" },
    { title: "One More Time", artist: "Daft Punk" },
    { title: "One More Time", artist: "Daft Punk (Live)" },
  ];
  assert.equal(findQueuedTrack("one more time", tracks), 1);
  assert.equal(findQueuedTrack("alpha", tracks), 0);
  assert.equal(findQueuedTrack("bravo", tracks), -1);
  assert.equal(findQueuedTrack("one more night", tracks), -1);
});

test("the same song request typed two ways gets one key", () => {
  const key = requestKey("Blinding Lights - The Weeknd");
  assert.equal(key, "blinding lights the weeknd");
  assert.equal(requestKey("can you play blinding lights the weeknd please"), key);
  assert.equal(requestKey("Please play Blinding Lights, The Weeknd!"), key);
  assert.equal(requestKey("Raï – Cheb Khaled"), "raï cheb khaled");
  assert.equal(requestKey("Play"), "play");
  assert.equal(requestKey("!!!"), "");
});
