const params = new URLSearchParams(window.location.search);
const isRemote = params.has("remote") || params.get("role") === "remote";
const sessionCode = params.get("session") || "";
const socket = window.io({
  // Sent on every connect and reconnect; the server checks it before accepting the socket.
  auth: { role: isRemote ? "remote" : "display", session: sessionCode },
});

const els = {
  shell: document.querySelector(".app-shell"),
  screenTitle: document.querySelector("#screen-title"),
  displayView: document.querySelector("#display-view"),
  remoteView: document.querySelector("#remote-view"),
  queuePanel: document.querySelector(".queue-panel"),
  connectionPill: document.querySelector("#connection-pill"),
  remoteCount: document.querySelector("#remote-count"),
  qrCode: document.querySelector("#qr-code"),
  remoteUrl: document.querySelector("#remote-url"),
  fileInput: document.querySelector("#file-input"),
  folderInput: document.querySelector("#folder-input"),
  dropZone: document.querySelector("#drop-zone"),
  deckA: document.querySelector("#deck-a"),
  deckB: document.querySelector("#deck-b"),
  playBtn: document.querySelector("#play-btn"),
  nextBtn: document.querySelector("#next-btn"),
  previousBtn: document.querySelector("#previous-btn"),
  hypeBtn: document.querySelector("#hype-btn"),
  energySlider: document.querySelector("#energy-slider"),
  crossfadeSlider: document.querySelector("#crossfade-slider"),
  autoDjToggle: document.querySelector("#autodj-toggle"),
  visualizer: document.querySelector("#visualizer"),
  modeLabel: document.querySelector("#mode-label"),
  trackTitle: document.querySelector("#track-title"),
  trackMeta: document.querySelector("#track-meta"),
  elapsedTime: document.querySelector("#elapsed-time"),
  remainingTime: document.querySelector("#remaining-time"),
  progressBar: document.querySelector("#progress-bar"),
  queueList: document.querySelector("#queue-list"),
  queueCount: document.querySelector("#queue-count"),
  energyReadout: document.querySelector("#energy-readout"),
  crossfadeReadout: document.querySelector("#crossfade-readout"),
  autodjReadout: document.querySelector("#autodj-readout"),
  deckIndicator: document.querySelector("#deck-indicator"),
  nextTrackTitle: document.querySelector("#next-track-title"),
  roomModeReadout: document.querySelector("#room-mode-readout"),
  queueSizeReadout: document.querySelector("#queue-size-readout"),
  signalReadout: document.querySelector("#signal-readout"),
  remoteTrackTitle: document.querySelector("#remote-track-title"),
  remoteTrackMeta: document.querySelector("#remote-track-meta"),
  remoteElapsed: document.querySelector("#remote-elapsed"),
  remoteDuration: document.querySelector("#remote-duration"),
  remoteProgress: document.querySelector("#remote-progress"),
  remoteEnergy: document.querySelector("#remote-energy"),
  remoteCrossfade: document.querySelector("#remote-crossfade"),
  remoteQueue: document.querySelector("#remote-queue"),
  remoteQueueCount: document.querySelector("#remote-queue-count"),
  searchSections: document.querySelectorAll(".music-search"),
  stage: document.querySelector(".stage"),
  youtubeStage: document.querySelector("#youtube-stage"),
};

const settingsKey = "party-dj-booth-settings";
const trackPrefsKey = "party-dj-booth-track-prefs";
const youtubeStates = { ended: 0, playing: 1, buffering: 3 };
const searchSources = {
  archive: {
    endpoint: "/api/search",
    hint: "Open audio collections, saved locally.",
    searching: "Searching open audio collections...",
    found: (count) => `${count} legal download results found.`,
    none: "No open audio results found. Try another song, artist, or vibe.",
  },
  youtube: {
    endpoint: "/api/youtube/search",
    hint: "Plays through YouTube's player on the booth. Nothing is downloaded.",
    searching: "Searching YouTube...",
    found: (count) => `${count} YouTube videos found. They play on the booth; nothing is downloaded.`,
    none: "No YouTube videos found. Try another song or artist.",
  },
};

let audioContext;
let analyser;
let analyserData;
let youtubeApi = null;
let isTransitioning = false;
let pendingCue = null;
let renderTick = 0;
let lastSync = 0;
let remoteState = {};

const settings = readJson(settingsKey, {
  energy: 52,
  crossfade: 5,
  autoDj: true,
});
const trackPrefs = readJson(trackPrefsKey, {});

const booth = {
  tracks: [],
  currentIndex: -1,
  playing: false,
  energy: settings.energy,
  crossfade: settings.crossfade,
  autoDj: settings.autoDj,
  visualStyle: "spectrum",
  hypeUntil: 0,
  message: "Waiting for music on the Mac",
  history: [],
};

// Every deck has the same shape, so playback code doesn't care whether a track is an audio file
// or a YouTube video. Two audio decks let local tracks overlap during a crossfade.
const audioDecks = [createAudioDeck(els.deckA, "A"), createAudioDeck(els.deckB, "B")];
const youtubeDeck = createYouTubeDeck();
const allDecks = [...audioDecks, youtubeDeck];
let activeDeck = audioDecks[0];

function boot() {
  els.shell.dataset.role = isRemote ? "remote" : "display";
  els.screenTitle.textContent = isRemote ? "Phone Remote" : "Mac Booth";
  els.displayView.hidden = isRemote;
  els.remoteView.hidden = !isRemote;
  els.queuePanel.hidden = isRemote;

  bindSocket();
  bindSearchControls();

  if (isRemote) {
    bindRemoteControls();
  } else {
    bindDisplayControls();
    fetchSession();
    loadDownloadedTracks();
    applySettingsToInputs();
    drawVisualizer();
    renderDisplay();
    window.setInterval(syncFromDisplay, 700);
  }
}

function bindSocket() {
  socket.on("connect", () => {
    els.connectionPill.textContent = isRemote ? "Remote linked" : "Booth live";
  });

  socket.on("connect_error", (error) => {
    if (error.message !== "not-authorized") return;
    els.connectionPill.textContent = "Not linked";

    if (isRemote) {
      els.remoteTrackTitle.textContent = "Scan the QR code again";
      els.remoteTrackMeta.textContent = "This remote link is missing or out of date. Scan the QR code on the Mac booth to reconnect.";
    } else {
      const port = window.location.port ? `:${window.location.port}` : "";
      els.trackTitle.textContent = "Open the booth on the Mac";
      els.trackMeta.textContent = `The booth only runs on the Mac running the server, at http://localhost${port}.`;
    }
  });

  socket.on("disconnect", () => {
    els.connectionPill.textContent = "Disconnected";
  });

  socket.on("presence", (presence) => {
    els.remoteCount.textContent = `${presence.remotes || 0} phones`;
  });

  socket.on("state", (state) => {
    if (isRemote) {
      remoteState = state || {};
      renderRemote();
    }
  });

  socket.on("player:command", (command) => {
    if (!isRemote) handleRemoteCommand(command);
  });

  socket.on("download:ready", (track) => {
    if (!isRemote) addDownloadedTrack(track, true);
  });
}

async function fetchSession() {
  try {
    const res = await fetch("/api/session");
    const session = await res.json();
    els.qrCode.src = session.qrDataUrl;
    els.remoteUrl.textContent = session.localRemoteUrl;
  } catch {
    els.remoteUrl.textContent = "Could not create phone link. Restart the server.";
  }
}

function bindDisplayControls() {
  els.fileInput.addEventListener("change", () => addFiles(els.fileInput.files));
  els.folderInput.addEventListener("change", () => addFiles(els.folderInput.files));

  ["dragenter", "dragover"].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("is-dragging");
    });
  });

  els.dropZone.addEventListener("drop", (event) => {
    addFiles(event.dataTransfer.files);
  });

  els.playBtn.addEventListener("click", togglePlay);
  els.nextBtn.addEventListener("click", () => nextTrack(true));
  els.previousBtn.addEventListener("click", previousTrack);
  els.hypeBtn.addEventListener("click", hypeMoment);

  els.energySlider.addEventListener("input", () => {
    booth.energy = Number(els.energySlider.value);
    saveSettings();
    renderDisplay();
    syncFromDisplay(true);
  });

  els.crossfadeSlider.addEventListener("input", () => {
    booth.crossfade = Number(els.crossfadeSlider.value);
    saveSettings();
    syncFromDisplay(true);
  });

  els.autoDjToggle.addEventListener("change", () => {
    booth.autoDj = els.autoDjToggle.checked;
    saveSettings();
    renderDisplay();
    syncFromDisplay(true);
  });
}

function bindSearchControls() {
  els.searchSections.forEach((section) => {
    const form = section.querySelector(".search-form");
    const input = section.querySelector(".search-input");
    const status = section.querySelector(".search-status");
    const results = section.querySelector(".search-results");
    const tabs = section.querySelectorAll(".source-tab");
    section.dataset.source = "archive";

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        section.dataset.source = tab.dataset.source;
        tabs.forEach((other) => {
          other.classList.toggle("is-selected", other === tab);
          other.setAttribute("aria-pressed", String(other === tab));
        });
        status.textContent = searchSources[tab.dataset.source].hint;
        results.replaceChildren();
      });
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = input.value.trim();
      const sourceName = section.dataset.source;
      const source = searchSources[sourceName];

      if (query.length < 2) {
        status.textContent = "Type at least two characters.";
        return;
      }

      status.textContent = source.searching;
      results.replaceChildren();

      try {
        const response = await apiFetch(`${source.endpoint}?q=${encodeURIComponent(query)}`);
        const payload = await response.json();

        if (!response.ok) throw new Error(payload.error || "Search failed.");
        // The user switched source while this search was running.
        if (section.dataset.source !== sourceName) return;

        status.textContent = payload.results.length ? source.found(payload.results.length) : source.none;
        if (sourceName === "youtube") {
          renderYouTubeResults(section, payload.results);
        } else {
          renderSearchResults(section, payload.results);
        }
      } catch (error) {
        if (section.dataset.source === sourceName) status.textContent = error.message;
      }
    });
  });
}

function bindRemoteControls() {
  document.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => {
      sendCommand({ type: button.dataset.command });
    });
  });

  els.remoteEnergy.addEventListener("input", () => {
    sendCommand({ type: "setEnergy", value: Number(els.remoteEnergy.value) });
  });

  els.remoteCrossfade.addEventListener("input", () => {
    sendCommand({ type: "setCrossfade", value: Number(els.remoteCrossfade.value) });
  });
}

async function loadDownloadedTracks() {
  try {
    const response = await fetch("/api/downloads");
    const payload = await response.json();
    const before = booth.tracks.length;
    (payload.tracks || []).forEach((track) => addDownloadedTrack(track, false));
    const added = booth.tracks.length - before;

    if (added > 0) {
      booth.message = `${added} downloaded tracks ready`;
      renderDisplay();
      syncFromDisplay(true);
    }
  } catch {
    // The booth still works without the saved download library.
  }
}

function apiFetch(url, options = {}) {
  // Phones prove they were paired by the QR code; the booth on the Mac needs no code.
  return fetch(url, { ...options, headers: { ...options.headers, "X-Party-Session": sessionCode } });
}

function sendCommand(command) {
  socket.emit("remote:command", command);
}

function handleRemoteCommand(command) {
  if (!command || !command.type) return;

  if (command.type === "playPause") togglePlay();
  if (command.type === "next") nextTrack(true);
  if (command.type === "previous") previousTrack();
  if (command.type === "hype") hypeMoment();

  if (command.type === "addYouTube") addYouTubeTrack(command.video, Boolean(command.playNow));

  if (command.type === "jumpTo") {
    const index = booth.tracks.findIndex((track) => track.id === command.trackId);
    if (index >= 0) cueTrack(index, booth.playing);
  }

  if (command.type === "vote") {
    const track = booth.tracks.find((item) => item.id === command.trackId);
    if (track) {
      track.votes += 1;
      booth.message = `${track.title} got a crowd vote`;
      renderDisplay();
      syncFromDisplay(true);
    }
  }

  if (command.type === "setEnergy") {
    booth.energy = clamp(command.value, 0, 100);
    els.energySlider.value = String(booth.energy);
    saveSettings();
    renderDisplay();
    syncFromDisplay(true);
  }

  if (command.type === "setCrossfade") {
    booth.crossfade = clamp(command.value, 0, 12);
    els.crossfadeSlider.value = String(booth.crossfade);
    saveSettings();
    syncFromDisplay(true);
  }
}

function addFiles(fileList) {
  const files = Array.from(fileList || [])
    .filter(isAudioFile)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  if (!files.length) return;

  const existingKeys = new Set(booth.tracks.map((track) => track.key));

  files.forEach((file) => {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (existingKeys.has(key)) return;

    const parsed = parseTrackName(file.name);
    const saved = trackPrefs[key] || {};
    const track = {
      id: safeId(),
      key,
      kind: "audio",
      title: parsed.title,
      artist: parsed.artist,
      fileName: file.name,
      size: file.size,
      duration: 0,
      url: URL.createObjectURL(file),
      energy: saved.energy ?? guessEnergy(file.name),
      votes: 0,
      plays: 0,
      addedAt: Date.now(),
    };

    booth.tracks.push(track);
    loadDuration(track);
  });

  if (booth.currentIndex === -1) {
    loadTrack(0, false, false);
  }

  booth.message = `${booth.tracks.length} tracks ready`;
  renderDisplay();
  syncFromDisplay(true);
}

function addDownloadedTrack(downloadedTrack, announce) {
  if (!downloadedTrack?.url) return;

  const key = downloadedTrack.key || `download:${downloadedTrack.url}`;
  if (booth.tracks.some((track) => track.key === key)) return;

  const title = downloadedTrack.title || parseTrackName(downloadedTrack.fileName || "Downloaded track").title;
  const artist = downloadedTrack.artist || "Downloaded";
  const saved = trackPrefs[key] || {};
  const track = {
    id: safeId(),
    key,
    kind: "audio",
    title,
    artist,
    fileName: downloadedTrack.fileName || title,
    size: 0,
    duration: 0,
    url: downloadedTrack.url,
    energy: saved.energy ?? downloadedTrack.energy ?? guessEnergy(`${title} ${artist}`),
    votes: 0,
    plays: 0,
    source: downloadedTrack.source || "Downloaded",
    sourceUrl: downloadedTrack.sourceUrl || "",
    licenseUrl: downloadedTrack.licenseUrl || "",
    addedAt: Date.now(),
  };

  booth.tracks.push(track);
  loadDuration(track);

  if (booth.currentIndex === -1) {
    loadTrack(0, false, false);
  }

  if (announce) booth.message = `Downloaded ${title}`;
  renderDisplay();
  syncFromDisplay(true);
}

function addYouTubeTrack(video, playNow) {
  // Phones send videos over the socket, so check the shape before trusting it.
  const videoId = String(video?.videoId || "");
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return;

  const key = `youtube:${videoId}`;
  let index = booth.tracks.findIndex((track) => track.key === key);

  if (index === -1) {
    const title = String(video.title || "YouTube video").slice(0, 200);
    const saved = trackPrefs[key] || {};
    booth.tracks.push({
      id: safeId(),
      key,
      kind: "youtube",
      videoId,
      title,
      artist: String(video.channel || "YouTube").slice(0, 120),
      fileName: title,
      size: 0,
      duration: clamp(video.duration, 0, 24 * 3600),
      url: "",
      energy: saved.energy ?? guessEnergy(title),
      votes: 0,
      plays: 0,
      source: "YouTube",
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
      addedAt: Date.now(),
    });
    index = booth.tracks.length - 1;
  }

  booth.message = `Queued ${booth.tracks[index].title} from YouTube`;

  if (playNow) {
    cueTrack(index, true);
  } else if (booth.currentIndex === -1) {
    loadTrack(index, false, false);
  }

  renderDisplay();
  syncFromDisplay(true);
}

function isAudioFile(file) {
  return file.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg|flac|aiff?)$/i.test(file.name);
}

function parseTrackName(name) {
  const clean = name
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = clean.split(/\s+-\s+/);

  if (parts.length >= 2) {
    return {
      artist: parts[0].trim(),
      title: parts.slice(1).join(" - ").trim(),
    };
  }

  return { artist: "Local file", title: clean || name };
}

function guessEnergy(name) {
  const lower = name.toLowerCase();
  if (/(remix|club|edit|house|techno|dance|banger|peak|hard|drill|afro)/.test(lower)) return 82;
  if (/(slow|acoustic|chill|intro|warm|late|soft|ambient)/.test(lower)) return 32;
  return 55;
}

function loadDuration(track) {
  const probe = new Audio();
  probe.preload = "metadata";
  probe.src = track.url;
  probe.addEventListener("loadedmetadata", () => {
    track.duration = Number.isFinite(probe.duration) ? probe.duration : 0;
    renderDisplay();
    syncFromDisplay(true);
  }, { once: true });
}

async function setupAudio() {
  if (audioContext) {
    if (audioContext.state === "suspended") await audioContext.resume();
    return;
  }

  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.78;
  analyserData = new Uint8Array(analyser.frequencyBinCount);

  audioDecks.forEach((deck) => {
    deck.source = audioContext.createMediaElementSource(deck.el);
    deck.gain = audioContext.createGain();
    deck.gain.gain.value = deck === activeDeck ? 1 : 0;
    deck.source.connect(deck.gain);
    deck.gain.connect(analyser);
  });

  analyser.connect(audioContext.destination);
  await audioContext.resume();
}

async function togglePlay() {
  if (!booth.tracks.length) {
    booth.message = "Load music first";
    renderDisplay();
    return;
  }

  if (booth.currentIndex === -1) {
    await loadTrack(0, false, false);
  }

  if (booth.playing) {
    pauseAll();
  } else {
    await playActive();
  }

  renderDisplay();
  syncFromDisplay(true);
}

async function playActive() {
  try {
    await setupAudio();
    if (!activeDeck.loaded && booth.currentIndex >= 0) {
      await activeDeck.load(booth.tracks[booth.currentIndex]);
    }
    await activeDeck.play();
    booth.playing = true;
    booth.message = "Booth is playing";
  } catch (error) {
    booth.playing = false;
    booth.message = error?.boothMessage || "Press Play on the Mac once to unlock audio";
  }
}

function pauseAll() {
  allDecks.forEach((deck) => deck.pause());
  booth.playing = false;
  booth.message = "Paused";
}

async function loadTrack(index, shouldPlay, useFade) {
  if (!booth.tracks[index] || isTransitioning) return;

  const track = booth.tracks[index];
  const currentDeck = activeDeck;
  const nextDeck = deckFor(track);
  const canFade = useFade && shouldPlay && booth.playing && booth.crossfade > 0 && currentDeck.loaded;
  const previousIndex = booth.currentIndex;

  booth.currentIndex = index;
  const remembered = rememberPlay(track);
  booth.message = `Loaded ${track.title}`;

  if (!canFade) {
    // Reuse the current deck when it plays this kind of track; otherwise switch decks.
    const deck = currentDeck.kind === track.kind ? currentDeck : nextDeck;
    allDecks.filter((other) => other !== deck && other.loaded).forEach((other) => other.stop());
    activeDeck = deck;

    try {
      await deck.load(track);
      deck.setLevel(1);
      if (shouldPlay) await playActive();
      else deck.preview?.();
    } catch (error) {
      booth.playing = false;
      booth.message = error?.boothMessage || `Could not load ${track.title}`;
    }

    updatePlaybackProgress();
    renderDisplay();
    syncFromDisplay(true);
    return;
  }

  await setupAudio();
  isTransitioning = true;
  let failed = false;

  try {
    if (nextDeck === currentDeck) {
      // One YouTube player can't overlap two videos, so fade out, switch, and fade back in.
      await dipDeck(currentDeck, track, booth.crossfade);
    } else {
      await nextDeck.load(track);
      nextDeck.setLevel(0);
      await nextDeck.play();
      await fadeDecks(currentDeck, nextDeck, booth.crossfade);
      currentDeck.stop();
      activeDeck = nextDeck;
    }
    booth.playing = true;
    booth.message = `Now playing ${track.title}`;
  } catch (error) {
    failed = true;
    booth.message = error?.boothMessage || "Could not crossfade this track";

    if (nextDeck !== activeDeck) {
      // The old deck is still playing its track: drop the failed deck (a dead YouTube video
      // would stay on screen) and point the booth and Prev back at what is actually playing.
      // The failed track keeps its play count, so Auto DJ tries other songs before retrying it.
      nextDeck.stop();
      if (remembered) booth.history.pop();
      booth.currentIndex = previousIndex;
    }
  } finally {
    isTransitioning = false;
    updatePlaybackProgress();
    renderDisplay();
    syncFromDisplay(true);
  }

  if (pendingCue) {
    const { index: cuedIndex, shouldPlay: cuedPlay } = pendingCue;
    pendingCue = null;
    loadTrack(cuedIndex, cuedPlay, true);
    return;
  }

  // Keep the music going: skip a video YouTube refused, and move on after a failed
  // YouTube-to-YouTube switch, which leaves nothing playing.
  if (failed && booth.playing && (track.unplayable || nextDeck === currentDeck)) {
    nextTrack(activeDeck !== nextDeck);
  }
}

// Cue and Play now are what someone asked for, so a running crossfade delays them instead of
// dropping them. Automatic transitions still just skip while a crossfade runs.
function cueTrack(index, shouldPlay) {
  if (isTransitioning) {
    pendingCue = { index, shouldPlay };
    booth.message = `Up next: ${booth.tracks[index]?.title}`;
    renderDisplay();
    syncFromDisplay(true);
    return;
  }
  loadTrack(index, shouldPlay, true);
}

function deckFor(track) {
  if (track.kind === "youtube") return youtubeDeck;
  // Use the audio deck that isn't playing, so a crossfade can overlap the two.
  return audioDecks.find((deck) => deck !== activeDeck);
}

function fadeCurves() {
  const steps = 64;
  const fadeIn = new Float32Array(steps);
  const fadeOut = new Float32Array(steps);

  for (let i = 0; i < steps; i += 1) {
    const progress = i / (steps - 1);
    const shaped = progress * progress * (3 - 2 * progress);
    fadeIn[i] = shaped;
    fadeOut[i] = 1 - shaped;
  }

  return { fadeIn, fadeOut };
}

function fadeDecks(fromDeck, toDeck, seconds) {
  const duration = Math.max(0.2, seconds);
  const { fadeIn, fadeOut } = fadeCurves();

  // Audio decks fade on the audio clock and the YouTube deck on a timer, never on
  // requestAnimationFrame: it stops when the tab is hidden or the screen sleeps, which used to
  // freeze the fade and lock out every later transition.
  fromDeck.fade(fadeOut, duration);
  toDeck.fade(fadeIn, duration);

  return wait(duration).then(() => {
    fromDeck.setLevel(0);
    toDeck.setLevel(1);
  });
}

async function dipDeck(deck, track, seconds) {
  const half = Math.max(0.2, seconds / 2);
  const { fadeIn, fadeOut } = fadeCurves();

  deck.fade(fadeOut, half);
  await wait(half);
  await deck.load(track);
  deck.setLevel(0);
  await deck.play();
  deck.fade(fadeIn, half);
  await wait(half);
  deck.setLevel(1);
}

function wait(seconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, seconds * 1000);
  });
}

function createAudioDeck(el, label) {
  const deck = {
    kind: "audio",
    label,
    el,
    gain: null,
    source: null,
    get loaded() {
      return Boolean(el.src);
    },
    get currentTime() {
      return el.currentTime || 0;
    },
    set currentTime(value) {
      el.currentTime = value;
    },
    get duration() {
      return Number.isFinite(el.duration) ? el.duration : 0;
    },
    async load(track) {
      el.pause();
      el.src = track.url;
      el.currentTime = 0;
    },
    play() {
      return el.play();
    },
    pause() {
      el.pause();
    },
    stop() {
      el.pause();
      el.removeAttribute("src");
      el.load();
    },
    setLevel(value) {
      if (!deck.gain) return;
      // Clear leftover fade automation first: setting a value inside a curve's time range throws.
      deck.gain.gain.cancelScheduledValues(0);
      deck.gain.gain.value = value;
    },
    fade(curve, seconds) {
      if (!deck.gain) return;
      deck.gain.gain.cancelScheduledValues(0);
      deck.gain.gain.setValueCurveAtTime(curve, audioContext.currentTime, seconds);
    },
  };

  el.addEventListener("timeupdate", updatePlaybackProgress);
  el.addEventListener("ended", () => {
    if (deck === activeDeck) nextTrack(false);
  });

  return deck;
}

function createYouTubeDeck() {
  let player = null;
  let playerReady = null;
  let track = null;
  let lastError = null;
  let needsStart = false;
  let fadeTimer = 0;
  let progressTimer = 0;
  let startWaiter = null;

  function ensurePlayer() {
    if (!playerReady) {
      let created = null;
      const ready = loadYouTubeApi().then((YT) => new Promise((resolve) => {
        created = new YT.Player("youtube-player", {
          width: "100%",
          height: "100%",
          playerVars: { playsinline: 1, rel: 0, origin: window.location.origin },
          events: {
            onReady: () => resolve(created),
            onStateChange: handleState,
            onError: handleError,
          },
        });
      }));
      // A player that never gets ready must not hold up the booth mid-transition.
      playerReady = withTimeout(ready, 20, "Couldn't start the YouTube player. Check the internet connection.");
      playerReady.then((value) => {
        player = value;
      }, () => {
        // Start clean next time instead of reusing a half-built player.
        created?.destroy();
        if (!document.querySelector("#youtube-player")) {
          const host = document.createElement("div");
          host.id = "youtube-player";
          els.youtubeStage.append(host);
        }
        playerReady = null;
      });
    }
    return playerReady;
  }

  function settleStart(error) {
    if (!startWaiter) return;
    const waiter = startWaiter;
    startWaiter = null;
    window.clearTimeout(waiter.timer);
    if (error) waiter.reject(error);
    else waiter.resolve();
  }

  function handleState(event) {
    if (event.data === youtubeStates.playing) {
      needsStart = false;
      settleStart(null);
    }
    if (event.data === youtubeStates.ended && deck === activeDeck) nextTrack(false);
  }

  function handleError(event) {
    const reasons = {
      2: "the video link is invalid",
      5: "the video can't play in this browser",
      100: "the video was removed or made private",
      101: "the owner doesn't allow it outside YouTube",
      150: "the owner doesn't allow it outside YouTube",
    };
    const reason = reasons[event.data] || `YouTube player error ${event.data}`;
    if (track) track.unplayable = true;
    const error = Object.assign(new Error(reason), {
      boothMessage: `YouTube won't play ${track?.title || "this video"}: ${reason}. Skipping it.`,
    });
    lastError = error;

    if (startWaiter) {
      settleStart(error);
      return;
    }

    // The video failed while playing: say why and move on.
    if (deck === activeDeck && booth.playing) {
      booth.message = error.boothMessage;
      nextTrack(false);
    }
  }

  function showVideo(visible) {
    els.youtubeStage.hidden = !visible;
    els.stage.classList.toggle("has-video", visible);
  }

  function setVolume(value) {
    player?.setVolume(Math.round(clamp(value, 0, 1) * 100));
  }

  function stopTimers() {
    window.clearInterval(fadeTimer);
    window.clearInterval(progressTimer);
  }

  const deck = {
    kind: "youtube",
    label: "YouTube",
    get loaded() {
      return Boolean(track);
    },
    get currentTime() {
      return player?.getCurrentTime?.() || 0;
    },
    set currentTime(value) {
      player?.seekTo(value, true);
    },
    get duration() {
      return player?.getDuration?.() || 0;
    },
    async load(item) {
      await ensurePlayer();
      track = item;
      lastError = null;
      needsStart = true;
      showVideo(true);
    },
    preview() {
      // Show the video's first frame while the booth is paused. Never cue right before
      // playing: YouTube then ignores the play request and stays cued.
      if (track && needsStart) player.cueVideoById(track.videoId);
    },
    async play() {
      await ensurePlayer();
      // YouTube already refused this video while cueing it.
      if (track?.unplayable && lastError) throw lastError;

      // A newly loaded video must start even while the previous one is still playing (a
      // YouTube-to-YouTube switch); otherwise only start when paused or stopped.
      if (needsStart || player.getPlayerState() !== youtubeStates.playing) {
        await new Promise((resolve, reject) => {
          const timer = window.setTimeout(() => {
            startWaiter = null;
            // Still buffering (or an ad is loading) counts as started.
            if (player.getPlayerState() === youtubeStates.buffering) {
              resolve();
              return;
            }
            reject(Object.assign(new Error("YouTube did not start"), {
              boothMessage: "YouTube didn't start. Press Play on the Mac once to unlock audio.",
            }));
          }, 10000);
          startWaiter = { resolve, reject, timer };
          // A new video starts with loadVideoById; playVideo only resumes a paused one.
          if (needsStart) player.loadVideoById(track.videoId);
          else player.playVideo();
        });
      }

      window.clearInterval(progressTimer);
      // The YouTube player has no timeupdate event, so poll it while it plays.
      progressTimer = window.setInterval(() => {
        if (deck === activeDeck) updatePlaybackProgress();
      }, 500);
    },
    pause() {
      window.clearInterval(progressTimer);
      player?.pauseVideo();
    },
    stop() {
      stopTimers();
      settleStart(new Error("stopped"));
      player?.stopVideo();
      track = null;
      showVideo(false);
    },
    setLevel(value) {
      window.clearInterval(fadeTimer);
      setVolume(value);
    },
    fade(curve, seconds) {
      window.clearInterval(fadeTimer);
      const started = performance.now();
      fadeTimer = window.setInterval(() => {
        const progress = Math.min(1, (performance.now() - started) / (seconds * 1000));
        setVolume(curve[Math.round(progress * (curve.length - 1))]);
        if (progress >= 1) window.clearInterval(fadeTimer);
      }, 50);
    },
  };

  return deck;
}

function withTimeout(promise, seconds, boothMessage) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(Object.assign(new Error("timed out"), { boothMessage }));
    }, seconds * 1000);
    promise.then((value) => {
      window.clearTimeout(timer);
      resolve(value);
    }, (error) => {
      window.clearTimeout(timer);
      reject(error);
    });
  });
}

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);

  if (!youtubeApi) {
    youtubeApi = new Promise((resolve, reject) => {
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.onerror = () => {
        youtubeApi = null;
        reject(Object.assign(new Error("YouTube player API failed to load"), {
          boothMessage: "Couldn't load the YouTube player. Check the internet connection.",
        }));
      };
      document.head.append(script);
    });
  }

  return youtubeApi;
}

function rememberPlay(track) {
  if (booth.history.at(-1) === track.id) return false;
  booth.history.push(track.id);
  track.plays += 1;
  return true;
}

function nextTrack(useFade) {
  if (!booth.tracks.length) return;
  const nextIndex = chooseNextIndex();
  if (nextIndex < 0) return;
  loadTrack(nextIndex, booth.playing, useFade);
}

function previousTrack() {
  if (!booth.tracks.length || isTransitioning) return;
  if (activeDeck.currentTime > 4) {
    activeDeck.currentTime = 0;
    return;
  }

  // Go back to the track that actually played before this one, not the one above it in the list.
  const playedId = booth.history.at(-2);
  const playedIndex = booth.tracks.findIndex((track) => track.id === playedId);
  if (playedIndex >= 0) {
    booth.history.pop();
    loadTrack(playedIndex, booth.playing, false);
    return;
  }

  const previous = (booth.currentIndex - 1 + booth.tracks.length) % booth.tracks.length;
  loadTrack(previous, booth.playing, false);
}

function chooseNextIndex() {
  const count = booth.tracks.length;
  // In list order, skipping videos YouTube refused to play; -1 when nothing is playable.
  let following = -1;
  for (let step = 1; step <= count && following < 0; step += 1) {
    const index = (booth.currentIndex + step) % count;
    if (!booth.tracks[index].unplayable) following = index;
  }

  if (!booth.autoDj || count < 3) return following;

  const target = booth.energy;
  const others = booth.tracks
    .map((track, index) => ({ track, index }))
    .filter((item) => item.index !== booth.currentIndex && !item.track.unplayable);
  if (!others.length) return following;

  // Every track plays once before any repeats, so Auto DJ can't bounce between two favorites.
  const fewestPlays = Math.min(...others.map((item) => item.track.plays));
  const candidates = others
    .filter((item) => item.track.plays === fewestPlays)
    .map((item) => ({
      ...item,
      score: Math.abs(item.track.energy - target) - item.track.votes * 8,
    }))
    .sort((a, b) => a.score - b.score);

  return candidates[0].index;
}

function hypeMoment() {
  booth.hypeUntil = Date.now() + 7000;
  booth.message = "Hype moment";
  document.body.classList.add("hype");
  window.setTimeout(() => document.body.classList.remove("hype"), 7000);
  renderDisplay();
  syncFromDisplay(true);
}

function updatePlaybackProgress() {
  const currentTrack = booth.tracks[booth.currentIndex];
  const duration = activeDeck.duration;
  // While a YouTube ad plays, the player can report the ad's length. Only trust the player
  // when it agrees with the video length the search returned.
  const trusted = !(currentTrack?.kind === "youtube" && currentTrack.duration && Math.abs(duration - currentTrack.duration) > 5);

  if (currentTrack && duration > 0 && trusted) {
    currentTrack.duration = duration;
  }

  if (booth.autoDj && booth.playing && !isTransitioning && duration > 0 && trusted) {
    const remaining = duration - activeDeck.currentTime;
    if (remaining <= Math.max(1.2, booth.crossfade + 0.25)) {
      nextTrack(true);
    }
  }

  renderPlaybackOnly();
}

function applySettingsToInputs() {
  els.energySlider.value = String(booth.energy);
  els.crossfadeSlider.value = String(booth.crossfade);
  els.autoDjToggle.checked = booth.autoDj;
}

function saveSettings() {
  writeJson(settingsKey, {
    energy: booth.energy,
    crossfade: booth.crossfade,
    autoDj: booth.autoDj,
  });
}

function saveTrackPrefs(track) {
  // Merge into the stored tags so tags for tracks not loaded this session survive.
  const prefs = readJson(trackPrefsKey, {});
  prefs[track.key] = { energy: track.energy };
  trackPrefs[track.key] = prefs[track.key];
  writeJson(trackPrefsKey, prefs);
}

function renderDisplay() {
  const currentTrack = booth.tracks[booth.currentIndex];
  const mode = energyMode(booth.energy);
  const nextTrack = booth.tracks.length > 1 ? booth.tracks[chooseNextIndex()] : null;

  els.modeLabel.textContent = mode;
  els.trackTitle.textContent = currentTrack ? currentTrack.title : "Load your playlist";
  els.trackMeta.textContent = currentTrack
    ? `${currentTrack.artist} - ${formatTime(currentTrack.duration)} - ${booth.message}`
    : "Choose audio files on the Mac. Your phone becomes the booth remote.";
  els.playBtn.textContent = booth.playing ? "Pause" : "Play";
  els.queueCount.textContent = `${booth.tracks.length} tracks`;
  els.connectionPill.textContent = socket.connected ? "Booth live" : "Connecting";
  els.energyReadout.textContent = String(booth.energy);
  els.crossfadeReadout.textContent = `${booth.crossfade}s`;
  els.autodjReadout.textContent = booth.autoDj ? "Auto DJ on" : "Manual";
  els.deckIndicator.textContent = activeDeck.label;
  els.nextTrackTitle.textContent = nextTrack ? nextTrack.title : "No queue";
  els.roomModeReadout.textContent = mode;
  els.queueSizeReadout.textContent = String(booth.tracks.length);
  els.signalReadout.textContent = booth.playing ? "Live" : "Ready";
  renderPlaybackOnly();
  renderQueue();
}

function renderPlaybackOnly() {
  const duration = activeDeck.duration || booth.tracks[booth.currentIndex]?.duration || 0;
  const current = activeDeck.currentTime;
  const percent = duration ? clamp((current / duration) * 100, 0, 100) : 0;

  els.elapsedTime.textContent = formatTime(current);
  els.remainingTime.textContent = duration ? `-${formatTime(duration - current)}` : "0:00";
  els.progressBar.style.width = `${percent}%`;
}

function renderQueue() {
  if (!booth.tracks.length) {
    els.queueList.innerHTML = `<div class="empty-state">Your queue will appear here after you load music files or add songs from search.</div>`;
    return;
  }

  els.queueList.replaceChildren(...booth.tracks.map((track, index) => {
    const row = document.createElement("article");
    row.className = `queue-row${index === booth.currentIndex ? " is-active" : ""}`;

    const indexEl = document.createElement("div");
    indexEl.className = "queue-index";
    indexEl.textContent = String(index + 1).padStart(2, "0");

    const info = document.createElement("div");
    const title = document.createElement("p");
    title.className = "queue-title";
    title.textContent = track.title;
    const meta = document.createElement("p");
    meta.className = "queue-meta";
    meta.textContent = `${track.artist} - ${formatTime(track.duration)}${sourceLabel(track)} - energy ${track.energy} - ${track.votes} votes`;
    info.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "queue-actions";
    const cue = actionButton("Cue", () => cueTrack(index, booth.playing));
    const vote = actionButton("Vote", () => {
      track.votes += 1;
      renderDisplay();
      syncFromDisplay(true);
    });
    actions.append(cue, vote, tagButton("Warm", track, 28), tagButton("Groove", track, 55), tagButton("Peak", track, 86));

    row.append(indexEl, info, actions);
    return row;
  }));
}

function renderSearchResults(section, results) {
  const container = section.querySelector(".search-results");

  if (!results.length) {
    container.innerHTML = `<div class="empty-state">No results yet.</div>`;
    return;
  }

  container.replaceChildren(...results.map((result) => {
    const row = document.createElement("article");
    row.className = "search-result";

    const info = document.createElement("div");
    const title = document.createElement("p");
    title.className = "search-result-title";
    title.textContent = result.title || result.identifier;
    const meta = document.createElement("p");
    meta.className = "search-result-meta";
    const license = result.licenseUrl ? "license linked" : "open audio collection";
    meta.textContent = `${result.artist || "Internet Archive"} - ${license} - ${result.downloads || 0} downloads`;
    info.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "search-result-actions";

    const download = document.createElement("button");
    download.className = "queue-action";
    download.type = "button";
    download.textContent = "Download";
    download.addEventListener("click", () => downloadSearchResult(section, result, download));

    const source = document.createElement("a");
    source.className = "search-link";
    source.href = result.sourceUrl;
    source.target = "_blank";
    source.rel = "noreferrer";
    source.textContent = "Source";

    actions.append(download, source);
    row.append(info, actions);
    return row;
  }));
}

function renderYouTubeResults(section, results) {
  const container = section.querySelector(".search-results");

  if (!results.length) {
    container.innerHTML = `<div class="empty-state">No results yet.</div>`;
    return;
  }

  container.replaceChildren(...results.map((video) => {
    const row = document.createElement("article");
    row.className = "search-result has-thumb";

    const thumb = document.createElement("img");
    thumb.className = "search-thumb";
    thumb.alt = "";
    thumb.loading = "lazy";
    if (video.thumbnail) thumb.src = video.thumbnail;

    const info = document.createElement("div");
    const title = document.createElement("p");
    title.className = "search-result-title";
    title.textContent = video.title;
    const meta = document.createElement("p");
    meta.className = "search-result-meta";
    meta.textContent = `${video.channel} - ${formatTime(video.duration)} - YouTube`;
    info.append(title, meta);

    // Play and queue only: YouTube videos are never downloaded.
    const actions = document.createElement("div");
    actions.className = "search-result-actions";
    const playNow = actionButton("Play now", () => queueYouTube(section, video, true));
    const add = actionButton("Add to queue", () => {
      queueYouTube(section, video, false);
      add.textContent = "Added";
    });

    const source = document.createElement("a");
    source.className = "search-link";
    source.href = video.url;
    source.target = "_blank";
    source.rel = "noreferrer";
    source.textContent = "YouTube";

    actions.append(playNow, add, source);
    row.append(thumb, info, actions);
    return row;
  }));
}

function queueYouTube(section, video, playNow) {
  const status = section.querySelector(".search-status");

  if (isRemote) {
    sendCommand({ type: "addYouTube", video, playNow });
  } else {
    addYouTubeTrack(video, playNow);
  }

  status.textContent = playNow
    ? `Playing ${video.title} on the booth.`
    : `Added ${video.title} to the booth queue.`;
}

async function downloadSearchResult(section, result, button) {
  const status = section.querySelector(".search-status");
  button.disabled = true;
  button.textContent = "Downloading";
  status.textContent = "Downloading to this Mac...";

  try {
    const response = await apiFetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
    const payload = await response.json();

    if (!response.ok) throw new Error(payload.error || "Download failed.");

    if (!isRemote) addDownloadedTrack(payload.track, true);
    status.textContent = "Saved locally and added to the booth queue.";
    button.textContent = "Saved";
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
    button.textContent = "Download";
  }
}

function actionButton(label, onClick) {
  const button = document.createElement("button");
  button.className = "queue-action";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function tagButton(label, track, energy) {
  const button = actionButton(label, () => {
    track.energy = energy;
    saveTrackPrefs(track);
    renderDisplay();
    syncFromDisplay(true);
  });
  button.className = `tag-button${Math.abs(track.energy - energy) < 6 ? " is-selected" : ""}`;
  return button;
}

function renderRemote() {
  const playlist = remoteState.playlist || [];
  const current = playlist.find((track) => track.id === remoteState.currentTrackId);
  const duration = remoteState.duration || current?.duration || 0;
  const progress = duration ? clamp((remoteState.currentTime / duration) * 100, 0, 100) : 0;

  els.remoteCount.textContent = `${remoteState.connectedRemotes || 0} phones`;
  els.remoteTrackTitle.textContent = current ? current.title : "Waiting for the Mac";
  els.remoteTrackMeta.textContent = current
    ? `${current.artist} - ${remoteState.message || "Booth is linked"}`
    : "Open the booth on your Mac and load music.";
  els.remoteElapsed.textContent = formatTime(remoteState.currentTime || 0);
  els.remoteDuration.textContent = duration ? formatTime(duration) : "0:00";
  els.remoteProgress.style.width = `${progress}%`;
  els.remoteEnergy.value = String(remoteState.energy ?? 52);
  els.remoteCrossfade.value = String(remoteState.crossfade ?? 5);
  els.remoteQueueCount.textContent = `${playlist.length} tracks`;

  const playButton = document.querySelector('[data-command="playPause"]');
  if (playButton) playButton.textContent = remoteState.playing ? "Pause" : "Play";

  if (!playlist.length) {
    els.remoteQueue.innerHTML = `<div class="empty-state">The Mac has not loaded a playlist yet.</div>`;
    return;
  }

  els.remoteQueue.replaceChildren(...playlist.map((track, index) => {
    const row = document.createElement("article");
    row.className = `queue-row${track.id === remoteState.currentTrackId ? " is-active" : ""}`;

    const indexEl = document.createElement("div");
    indexEl.className = "queue-index";
    indexEl.textContent = String(index + 1).padStart(2, "0");

    const info = document.createElement("div");
    const title = document.createElement("p");
    title.className = "queue-title";
    title.textContent = track.title;
    const meta = document.createElement("p");
    meta.className = "queue-meta";
    meta.textContent = `${track.artist} - ${formatTime(track.duration)}${sourceLabel(track)} - ${track.votes || 0} votes`;
    info.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "queue-actions";
    actions.append(
      remoteAction("Cue", { type: "jumpTo", trackId: track.id }),
      remoteAction("Vote", { type: "vote", trackId: track.id }),
    );

    row.append(indexEl, info, actions);
    return row;
  }));
}

function remoteAction(label, command) {
  const button = document.createElement("button");
  button.className = "queue-action";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => sendCommand(command));
  return button;
}

function syncFromDisplay(force = false) {
  if (isRemote) return;
  const now = Date.now();
  if (!force && now - lastSync < 650) return;
  lastSync = now;

  const currentTrack = booth.tracks[booth.currentIndex];
  socket.emit("display:state", {
    playlist: booth.tracks.map(publicTrack),
    currentTrackId: currentTrack?.id || null,
    currentTime: activeDeck.currentTime,
    duration: activeDeck.duration || currentTrack?.duration || 0,
    playing: booth.playing,
    energy: booth.energy,
    crossfade: booth.crossfade,
    autoDj: booth.autoDj,
    visualStyle: booth.visualStyle,
    hypeUntil: booth.hypeUntil,
    message: booth.message,
  });
}

function publicTrack(track) {
  return {
    id: track.id,
    kind: track.kind,
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    energy: track.energy,
    votes: track.votes,
  };
}

function sourceLabel(track) {
  return track.kind === "youtube" ? " - YouTube" : "";
}

function drawVisualizer() {
  const canvas = els.visualizer;
  const ctx = canvas.getContext("2d");

  function draw(now) {
    renderTick = now;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, width, height);

    if (analyser && analyserData) {
      analyser.getByteFrequencyData(analyserData);
    }

    const bars = 72;
    const gap = 5;
    const barWidth = (width - gap * (bars - 1)) / bars;
    const hype = Date.now() < booth.hypeUntil;
    const energy = booth.energy / 100;
    // YouTube audio plays inside YouTube's player and never reaches the analyser.
    const live = analyser && activeDeck.kind === "audio";

    for (let i = 0; i < bars; i += 1) {
      const sampleIndex = Math.floor((i / bars) * (analyserData?.length || 1));
      const audioValue = analyserData ? analyserData[sampleIndex] / 255 : 0;
      const idle = 0.18 + Math.sin(now / 260 + i * 0.42) * 0.12 + energy * 0.22;
      const value = live ? Math.max(audioValue, 0.05) : idle;
      const barHeight = Math.max(12, value * height * (hype ? 0.9 : 0.72));
      const x = i * (barWidth + gap);
      const y = height - barHeight;
      const hueColor = i % 3 === 0 ? "#21f5c7" : i % 3 === 1 ? "#ff3d81" : "#ffb12b";

      ctx.fillStyle = hype && i % 2 === 0 ? "#d8ff3d" : hueColor;
      ctx.fillRect(x, y, barWidth, barHeight);

      ctx.globalAlpha = 0.24;
      ctx.fillRect(x, height - barHeight * 0.45, barWidth, barHeight * 0.45);
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = hype ? "rgba(216, 255, 61, 0.85)" : "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = hype ? 6 : 2;
    ctx.beginPath();
    const pulse = 160 + Math.sin(now / 180) * 20 + booth.energy * 2.4;
    ctx.arc(width * 0.5, height * 0.42, pulse, 0, Math.PI * 2);
    ctx.stroke();

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
}

function energyMode(value) {
  if (value < 28) return "Afterglow";
  if (value < 48) return "Warmup";
  if (value < 72) return "Groove";
  return "Peak";
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function safeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

boot();
