import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beatPhase,
  crossfaderGains,
  detectBpm,
  filterSetting,
  matchRate,
  phaseDifference,
  timeForPhase,
} from "../public/mixing.js";

const sampleRate = 22050;

// A drum loop: a 55 Hz kick on every beat, optional hi-hats between beats, optional noise.
function drumLoop({ bpm, seconds = 30, firstBeat = 0, hats = false, noise = 0, seed = 1 }) {
  const samples = new Float32Array(seconds * sampleRate);
  const period = 60 / bpm;
  let random = seed;
  const nextRandom = () => {
    random = (random * 16807) % 2147483647;
    return random / 2147483647 - 0.5;
  };

  for (let beat = firstBeat; beat < seconds; beat += period) {
    const start = Math.round(beat * sampleRate);
    for (let i = 0; i < 0.12 * sampleRate && start + i < samples.length; i += 1) {
      const t = i / sampleRate;
      samples[start + i] += Math.sin(2 * Math.PI * 55 * t) * Math.exp(-t * 30) * 0.9;
    }
    if (hats) {
      const hat = Math.round((beat + period / 2) * sampleRate);
      for (let i = 0; i < 0.03 * sampleRate && hat + i < samples.length; i += 1) {
        samples[hat + i] += nextRandom() * Math.exp((-i / sampleRate) * 200) * 0.4;
      }
    }
  }

  if (noise) {
    for (let i = 0; i < samples.length; i += 1) samples[i] += nextRandom() * noise;
  }

  return samples;
}

for (const bpm of [90, 120, 124, 128, 140, 160]) {
  test(`detects ${bpm} BPM`, () => {
    const result = detectBpm(drumLoop({ bpm }), sampleRate);
    assert.ok(result, "expected a result");
    assert.ok(Math.abs(result.bpm - bpm) <= 0.5, `got ${result.bpm}`);
  });
}

test("detects tempo through hi-hats and noise", () => {
  const result = detectBpm(drumLoop({ bpm: 126, hats: true, noise: 0.05 }), sampleRate);
  assert.ok(Math.abs(result.bpm - 126) <= 0.5, `got ${result.bpm}`);
});

test("finds where the beats start", () => {
  const result = detectBpm(drumLoop({ bpm: 120, firstBeat: 0.31 }), sampleRate);
  // The grid repeats every beat, so compare positions within one beat.
  const period = 60 / 120;
  assert.ok(Math.abs(phaseDifference(beatPhase(result.firstBeat, 0.31, period), 0)) < 0.04, `got ${result.firstBeat}`);
});

test("returns null for silence and very short audio", () => {
  assert.equal(detectBpm(new Float32Array(30 * sampleRate), sampleRate), null);
  assert.equal(detectBpm(drumLoop({ bpm: 120, seconds: 3 }), sampleRate), null);
});

test("matches tempos, including half and double time", () => {
  assert.deepEqual(matchRate(128, 128), { rate: 1, factor: 1 });
  const nudge = matchRate(128, 124);
  assert.equal(nudge.factor, 1);
  assert.ok(Math.abs(nudge.rate - 128 / 124) < 1e-9);
  assert.equal(matchRate(128, 65).factor, 2);
  assert.equal(matchRate(70, 140).factor, 0.5);
  assert.equal(matchRate(128, 100), null);
  assert.equal(matchRate(0, 120), null);
});

test("beat phase and start times line up", () => {
  const period = 0.5;
  assert.equal(beatPhase(1.25, 0.25, period), 0);
  assert.equal(beatPhase(1.5, 0.25, period), 0.5);
  assert.equal(beatPhase(0.1, 0.25, period), 0.7);
  const start = timeForPhase(0.3, 1.1, period);
  assert.ok(start >= 0 && start < period);
  assert.ok(Math.abs(beatPhase(start, 1.1, period) - 0.3) < 1e-9);
  assert.ok(Math.abs(phaseDifference(0.9, 0.1) - 0.2) < 1e-9);
  assert.ok(Math.abs(phaseDifference(0.1, 0.9) + 0.2) < 1e-9);
});

test("crossfader keeps equal power", () => {
  assert.deepEqual(crossfaderGains(0), { a: 1, b: 0 });
  const middle = crossfaderGains(0.5);
  assert.ok(Math.abs(middle.a ** 2 + middle.b ** 2 - 1) < 1e-9);
  assert.ok(Math.abs(middle.a - middle.b) < 1e-9);
  const end = crossfaderGains(1);
  assert.ok(end.a < 1e-9 && Math.abs(end.b - 1) < 1e-9);
});

test("filter knob sweeps low-pass, open, and high-pass", () => {
  assert.deepEqual(filterSetting(0), { type: "lowpass", frequency: 22000 });
  assert.equal(filterSetting(-1).type, "lowpass");
  assert.ok(Math.abs(filterSetting(-1).frequency - 200) < 1e-6);
  assert.equal(filterSetting(1).type, "highpass");
  assert.ok(Math.abs(filterSetting(1).frequency - 6000) < 1e-6);
  assert.ok(filterSetting(-0.5).frequency < 20000 && filterSetting(-0.5).frequency > 200);
});
