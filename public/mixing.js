// DJ mixing maths: BPM detection, beat grids, tempo matching, crossfader and filter curves.
// No side effects, so it runs the same in the browser and in tests.

const envelopeRate = 200; // onset envelope frames per second (5 ms resolution)

// Finds the tempo and the first beat of mono audio. Returns { bpm, firstBeat, confidence }, or
// null when there's too little audio or no steady beat.
export function detectBpm(samples, sampleRate, { minBpm = 80, maxBpm = 170 } = {}) {
  const hop = Math.max(1, Math.round(sampleRate / envelopeRate));
  // The hop is rounded to whole samples, so use the real frame rate for every conversion.
  const frameRate = sampleRate / hop;
  const frames = Math.floor(samples.length / hop);
  if (frames < frameRate * 8) return null;

  // Kick drums carry the beat, so low-pass around 150 Hz before measuring energy per frame.
  const alpha = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
  const energy = new Float32Array(frames);
  let low = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let i = frame * hop; i < (frame + 1) * hop; i += 1) {
      low += alpha * (samples[i] - low);
      sum += low * low;
    }
    energy[frame] = Math.log1p((1000 * sum) / hop);
  }

  // Onset strength: how much the energy jumps up from one frame to the next.
  const onset = new Float32Array(frames);
  for (let frame = 1; frame < frames; frame += 1) {
    onset[frame] = Math.max(0, energy[frame] - energy[frame - 1]);
  }

  // Autocorrelation: beats repeat every period, so the onset envelope lines up with itself
  // when shifted by one beat.
  const minLag = Math.floor((60 * frameRate) / maxBpm);
  const maxLag = Math.ceil((60 * frameRate) / minBpm);
  const scores = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag += 1) {
    let sum = 0;
    for (let frame = lag; frame < frames; frame += 1) sum += onset[frame] * onset[frame - lag];
    scores[lag] = sum / (frames - lag);
  }

  // A gentle preference for tempos near 120 BPM settles half-time / double-time ambiguity.
  let bestLag = -1;
  let bestWeighted = 0;
  let total = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    total += scores[lag];
    const bpm = (60 * frameRate) / lag;
    const weight = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    if (scores[lag] * weight > bestWeighted) {
      bestWeighted = scores[lag] * weight;
      bestLag = lag;
    }
  }

  const mean = total / (maxLag - minLag + 1);
  if (bestLag < 0 || mean <= 0) return null;
  const confidence = scores[bestLag] / mean;

  // Refine to a fraction of a frame with a parabola through the peak and its neighbours.
  const before = scores[bestLag - 1];
  const peak = scores[bestLag];
  const after = scores[bestLag + 1];
  const curve = before - 2 * peak + after;
  const shift = curve < 0 ? (0.5 * (before - after)) / curve : 0;
  const period = bestLag + Math.max(-0.5, Math.min(0.5, shift));

  // Beat phase: the offset where onsets one period apart add up the most. Only the first 16
  // beats count, so a tiny period error can't drift the grid, and each beat may land a frame early
  // or late.
  const beatsToCheck = Math.min(16, Math.floor(frames / period) - 1);
  let bestOffset = 0;
  let bestComb = -1;
  for (let offset = 0; offset < Math.ceil(period); offset += 1) {
    let sum = 0;
    for (let beat = 0; beat < beatsToCheck; beat += 1) {
      const position = Math.round(offset + beat * period);
      sum += Math.max(onset[position - 1] || 0, onset[position] || 0, onset[position + 1] || 0);
    }
    if (sum > bestComb) {
      bestComb = sum;
      bestOffset = offset;
    }
  }

  return {
    bpm: Math.round(((60 * frameRate) / period) * 10) / 10,
    firstBeat: bestOffset / frameRate,
    confidence,
  };
}

// The playback rate that makes a track at `incomingBpm` match `targetBpm`. Half and double time
// count too (factor 2 or 0.5). Returns { rate, factor }, or null when the shift is over maxShift.
export function matchRate(targetBpm, incomingBpm, maxShift = 0.08) {
  if (!(targetBpm > 0 && incomingBpm > 0)) return null;

  let best = null;
  for (const factor of [1, 2, 0.5]) {
    const rate = targetBpm / (incomingBpm * factor);
    if (!best || Math.abs(rate - 1) < Math.abs(best.rate - 1)) best = { rate, factor };
  }

  return Math.abs(best.rate - 1) <= maxShift ? best : null;
}

// Where a beat grid is at `time`: 0 on a beat, 0.5 halfway to the next one.
export function beatPhase(time, firstBeat, period) {
  const phase = ((time - firstBeat) / period) % 1;
  return phase < 0 ? phase + 1 : phase;
}

// The earliest track time at or after 0 whose beat phase is `phase`.
export function timeForPhase(phase, firstBeat, period) {
  const time = firstBeat + phase * period;
  return time - Math.floor(time / period) * period;
}

// The shortest way from phase `from` to phase `to`, in beats, between -0.5 and 0.5.
export function phaseDifference(from, to) {
  const difference = to - from;
  return difference - Math.round(difference);
}

// Equal-power crossfader: position 0 is all deck A, 1 is all deck B, and the middle keeps the
// overall loudness steady.
export function crossfaderGains(position) {
  const x = Math.min(1, Math.max(0, Number(position) || 0));
  return { a: Math.cos((x * Math.PI) / 2), b: Math.sin((x * Math.PI) / 2) };
}

// One filter knob: below 0 sweeps a low-pass down from 20 kHz to 200 Hz, above 0 sweeps a
// high-pass up from 20 Hz to 6 kHz, and the middle leaves the sound open.
export function filterSetting(value) {
  const amount = Math.min(1, Math.max(-1, Number(value) || 0));
  if (Math.abs(amount) < 0.02) return { type: "lowpass", frequency: 22000 };
  if (amount < 0) return { type: "lowpass", frequency: 20000 * (200 / 20000) ** -amount };
  return { type: "highpass", frequency: 20 * (6000 / 20) ** amount };
}
