import {
  beatPhase,
  crossfaderGains,
  detectBpm,
  filterSetting,
  matchRate,
  phaseDifference,
  timeForPhase,
} from "./mixing.js";
import { findQueuedTrack, parseVoiceCommand } from "./voice.js";

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
  volumeSlider: document.querySelector("#volume-slider"),
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
  remoteVolume: document.querySelector("#remote-volume"),
  remoteEnergy: document.querySelector("#remote-energy"),
  remoteCrossfade: document.querySelector("#remote-crossfade"),
  remoteQueue: document.querySelector("#remote-queue"),
  remoteQueueCount: document.querySelector("#remote-queue-count"),
  searchSections: document.querySelectorAll(".music-search"),
  stage: document.querySelector(".stage"),
  youtubeStage: document.querySelector("#youtube-stage"),
  youtubeSlotA: document.querySelector("#youtube-slot-a"),
  youtubeSlotB: document.querySelector("#youtube-slot-b"),
  soundCheckBtn: document.querySelector("#sound-check-btn"),
  soundCheckDialog: document.querySelector("#sound-check"),
  soundCheckClose: document.querySelector("#sound-check-close"),
  soundCheckSummary: document.querySelector("#sound-check-summary"),
  soundCheckList: document.querySelector("#sound-check-list"),
  qrCard: document.querySelector(".qr-card"),
  transitionSelect: document.querySelector("#transition-select"),
  mixNextBtn: document.querySelector("#mix-next-btn"),
  remoteTransition: document.querySelector("#remote-transition"),
  mixerPanel: document.querySelector(".mixer-panel"),
  mixModeTabs: document.querySelectorAll("[data-mix-mode]"),
  crossfader: document.querySelector("#crossfader"),
  autoFadeBtn: document.querySelector("#auto-fade-btn"),
  beatMatchToggle: document.querySelector("#beatmatch-toggle"),
  mixerStatus: document.querySelector("#mixer-status"),
  deckStripTemplate: document.querySelector("#deck-strip-template"),
};

const settingsKey = "party-dj-booth-settings";
const trackPrefsKey = "party-dj-booth-track-prefs";
const recentSearchesKey = "party-dj-booth-recent-searches";
const preflightKey = "party-dj-booth-sound-check";
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
    hint: "Search, or paste a YouTube playlist link to import it. Plays on the booth; nothing is downloaded.",
    searching: "Searching YouTube...",
    found: (count) => `${count} YouTube videos found. They play on the booth; nothing is downloaded.`,
    none: "No YouTube videos found. Try another song or artist.",
  },
};

const speechErrors = {
  "not-allowed": "Microphone access is blocked. Allow the microphone for this page in the browser's site settings.",
  "service-not-allowed": "Speech recognition is turned off. In Safari, turn on Dictation in System Settings > Keyboard.",
  "no-speech": "Didn't hear anything. Press Talk and try again.",
  "audio-capture": "No microphone found.",
  network: "Speech recognition needs an internet connection.",
  aborted: "Stopped listening.",
};

let audioContext;
let analyser;
let analyserData;
let masterGain;
let youtubeApi = null;
let recognition = null;
let isTransitioning = false;
let pendingCue = null;
let crossfaderTimer = 0;
let manualBusy = false;
let wakeLock = null;
let wantsAwake = false;
const sessionInfo = { youtubeSearch: false, phones: 0, youtubeStarted: false, voiceUsed: false };
let analysisQueue = Promise.resolve();
const analysisJobs = new Map();
const deckStrips = [];
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
  volume: settings.volume ?? 100,
  mutedVolume: 0,
  mixMode: settings.mixMode === "manual" ? "manual" : "auto",
  transition: settings.transition || "crossfade",
  beatMatch: settings.beatMatch ?? true,
  crossfader: 0,
  energy: settings.energy,
  crossfade: settings.crossfade,
  autoDj: settings.autoDj,
  visualStyle: "spectrum",
  hypeUntil: 0,
  message: "Waiting for music on the Mac",
  history: [],
  // Track ids someone asked to play next, oldest request first.
  upNext: [],
};

// Two decks, A and B. Either can hold a file or a YouTube video, so every transition overlaps
// the outgoing deck with the other one.
const decks = [createDeck("A", els.deckA, els.youtubeSlotA), createDeck("B", els.deckB, els.youtubeSlotB)];
let activeDeck = decks[0];

function boot() {
  els.shell.dataset.role = isRemote ? "remote" : "display";
  els.screenTitle.textContent = isRemote ? "Phone Remote" : "Mac Booth";
  els.displayView.hidden = isRemote;
  els.remoteView.hidden = !isRemote;
  els.queuePanel.hidden = isRemote;
  els.mixerPanel.hidden = isRemote;

  bindSocket();
  bindSearchControls();
  bindVoiceControls();

  if (isRemote) {
    bindRemoteControls();
  } else {
    bindDisplayControls();
    buildMixer();
    bindSoundCheck();
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
    renderSoundCheck();
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
    renderSoundCheck();
  });

  socket.on("presence", (presence) => {
    els.remoteCount.textContent = `${presence.remotes || 0} phones`;
    sessionInfo.phones = presence.remotes || 0;
    renderSoundCheck();
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
    sessionInfo.youtubeSearch = Boolean(session.youtubeSearch);
    renderSoundCheck();
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

  els.volumeSlider.addEventListener("input", () => setVolume(els.volumeSlider.value));
  els.energySlider.addEventListener("input", () => setEnergy(els.energySlider.value));
  els.crossfadeSlider.addEventListener("input", () => setCrossfade(els.crossfadeSlider.value));
  els.autoDjToggle.addEventListener("change", () => setAutoDj(els.autoDjToggle.checked));
}

// The booth's own sliders, phone commands, and voice commands all change settings through these.
function setVolume(value) {
  booth.volume = clamp(value, 0, 100);
  els.volumeSlider.value = String(booth.volume);
  if (masterGain) masterGain.gain.setTargetAtTime(booth.volume / 100, audioContext.currentTime, 0.05);
  decks.forEach((deck) => deck.refreshVolume());
  saveSettings();
  syncFromDisplay(true);
}

function setEnergy(value) {
  booth.energy = clamp(value, 0, 100);
  els.energySlider.value = String(booth.energy);
  saveSettings();
  renderDisplay();
  syncFromDisplay(true);
}

function setCrossfade(value) {
  booth.crossfade = clamp(value, 0, 12);
  els.crossfadeSlider.value = String(booth.crossfade);
  saveSettings();
  renderDisplay();
  syncFromDisplay(true);
}

function setAutoDj(on) {
  booth.autoDj = Boolean(on);
  els.autoDjToggle.checked = booth.autoDj;
  saveSettings();
  renderDisplay();
  syncFromDisplay(true);
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
        renderRecentSearches(section);
      });
    });
    renderRecentSearches(section);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = input.value.trim();
      const sourceName = section.dataset.source;
      const source = searchSources[sourceName];
      // A YouTube playlist link imports the playlist instead of searching for its text.
      const playlistId = sourceName === "youtube" ? playlistIdFrom(query) : "";

      if (query.length < 2) {
        status.textContent = "Type at least two characters.";
        return;
      }

      status.textContent = playlistId ? "Importing the YouTube playlist..." : source.searching;
      results.replaceChildren();

      try {
        const url = playlistId
          ? `/api/youtube/playlist?list=${encodeURIComponent(playlistId)}`
          : `${source.endpoint}?q=${encodeURIComponent(query)}`;
        const response = await apiFetch(url);
        const payload = await response.json();

        if (!response.ok) throw new Error(payload.error || "Search failed.");
        // The user switched source while this search was running.
        if (section.dataset.source !== sourceName) return;

        if (!playlistId) rememberSearch(sourceName, query);
        renderRecentSearches(section);
        status.textContent = !payload.results.length
          ? source.none
          : playlistId ? `${payload.results.length} playable videos in this playlist.` : source.found(payload.results.length);
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

// The playlist ID from a YouTube playlist link (or a bare ID), or "" when it isn't one.
function playlistIdFrom(text) {
  const fromLink = /[?&]list=([A-Za-z0-9_-]{10,64})/.exec(text);
  if (fromLink) return fromLink[1];
  return /^(?:PL|OLAK5uy_|UU|FL)[A-Za-z0-9_-]{10,60}$/.test(text) ? text : "";
}

// Recent searches per source, kept on this device, so "Raï" or "The Weeknd" is one tap away.
function rememberSearch(sourceName, query) {
  const recent = readJson(recentSearchesKey, {});
  const list = (recent[sourceName] || []).filter((item) => item.toLowerCase() !== query.toLowerCase());
  recent[sourceName] = [query, ...list].slice(0, 6);
  try {
    writeJson(recentSearchesKey, recent);
  } catch {
    // Private windows can refuse storage; the chips just won't persist.
  }
}

function renderRecentSearches(section) {
  const container = section.querySelector(".search-recent");
  const form = section.querySelector(".search-form");
  const input = section.querySelector(".search-input");
  const queries = readJson(recentSearchesKey, {})[section.dataset.source] || [];

  container.replaceChildren(...queries.map((query) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "search-chip";
    chip.textContent = query;
    chip.addEventListener("click", () => {
      input.value = query;
      form.requestSubmit();
    });
    return chip;
  }));
}

function bindRemoteControls() {
  document.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => {
      sendCommand({ type: button.dataset.command });
    });
  });

  els.remoteVolume.addEventListener("input", () => {
    sendCommand({ type: "setVolume", value: Number(els.remoteVolume.value) });
  });

  els.remoteEnergy.addEventListener("input", () => {
    sendCommand({ type: "setEnergy", value: Number(els.remoteEnergy.value) });
  });

  els.remoteCrossfade.addEventListener("input", () => {
    sendCommand({ type: "setCrossfade", value: Number(els.remoteCrossfade.value) });
  });

  els.remoteTransition.addEventListener("change", () => {
    sendCommand({ type: "setTransition", value: els.remoteTransition.value });
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

  if (command.type === "addYouTube") addYouTubeTrack(command.video, Boolean(command.playNow), Boolean(command.playNext));
  if (command.type === "addYouTubeList") addYouTubeList(command.videos);
  if (command.type === "voice") runVoiceCommand(command.text);

  if (command.type === "jumpTo") {
    const index = booth.tracks.findIndex((track) => track.id === command.trackId);
    if (index >= 0) cueTrack(index, true);
  }

  if (command.type === "playNext") {
    const index = booth.tracks.findIndex((track) => track.id === command.trackId);
    if (index >= 0) togglePlayNext(index);
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

  if (command.type === "setVolume") setVolume(command.value);
  if (command.type === "setEnergy") setEnergy(command.value);
  if (command.type === "setCrossfade") setCrossfade(command.value);
  if (command.type === "setTransition") setTransition(command.value);
}

function bindVoiceControls() {
  document.querySelectorAll(".voice-control").forEach((section) => {
    const form = section.querySelector(".voice-form");
    const input = section.querySelector(".voice-input");
    const talk = section.querySelector(".voice-button");

    talk.hidden = !canListen();
    talk.addEventListener("click", () => toggleListening(section));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      submitVoiceText(section, text);
    });
  });

  if (isRemote) return;

  const boothVoice = els.displayView.querySelector(".voice-control");
  if (!canListen()) {
    boothVoice.querySelector(".voice-status").textContent = "This browser can't listen here. Type a command, or open the booth in Chrome or Safari.";
    return;
  }

  // V starts and stops listening on the booth, unless someone is typing.
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "v" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;
    toggleListening(boothVoice);
  });
}

function speechRecognitionClass() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

// Browsers only allow the microphone on secure pages: the booth at localhost qualifies, a phone on
// plain http does not, so phones fall back to their keyboard's dictation key.
function canListen() {
  return Boolean(speechRecognitionClass()) && window.isSecureContext;
}

function toggleListening(section) {
  if (recognition) {
    recognition.stop();
    return;
  }

  const status = section.querySelector(".voice-status");
  const talk = section.querySelector(".voice-button");
  const Recognition = speechRecognitionClass();
  const listener = new Recognition();
  let handled = false;

  // The command words are English, so recognize English whatever the system language is.
  listener.lang = "en-US";
  listener.interimResults = true;
  listener.maxAlternatives = 3;

  listener.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    const heard = result[0].transcript;
    status.textContent = `Hearing: “${heard}”`;
    if (!result.isFinal || handled) return;

    handled = true;
    // Recognizers often rank a near miss first, so use the first alternative that is a command.
    const alternatives = Array.from(result, (alternative) => alternative.transcript);
    submitVoiceText(section, alternatives.find((text) => parseVoiceCommand(text)) || heard);
  };

  listener.onerror = (event) => {
    status.textContent = speechErrors[event.error] || `Voice error: ${event.error}`;
  };

  listener.onend = () => {
    recognition = null;
    talk.classList.remove("is-listening");
    talk.setAttribute("aria-pressed", "false");
    talk.textContent = "Talk";
    if (!handled && /^(Listening|Hearing)/.test(status.textContent)) {
      status.textContent = "Didn't catch a command. Press Talk and try again.";
    }
  };

  try {
    listener.start();
  } catch (error) {
    status.textContent = `Couldn't start listening: ${error.message}`;
    return;
  }

  recognition = listener;
  talk.classList.add("is-listening");
  talk.setAttribute("aria-pressed", "true");
  talk.textContent = "Stop";
  status.textContent = "Listening… say a command.";
}

async function submitVoiceText(section, text) {
  const status = section.querySelector(".voice-status");

  if (isRemote) {
    // The booth runs the command and reports back through its state message.
    sendCommand({ type: "voice", text });
    status.textContent = `Sent “${text}” to the booth.`;
    return;
  }

  const result = await runVoiceCommand(text);
  status.textContent = `“${text}” → ${result}`;
}

async function runVoiceCommand(text) {
  const spoken = String(text || "").slice(0, 200);
  const command = parseVoiceCommand(spoken);
  let result;
  if (command) sessionInfo.voiceUsed = true;

  if (!command) {
    result = `didn't catch a command in “${spoken}”`;
  } else if (command.action === "next") {
    nextTrack(true);
    result = "next song";
  } else if (command.action === "previous") {
    previousTrack();
    result = "previous song";
  } else if (command.action === "pause") {
    if (booth.playing) pauseAll();
    result = "paused";
  } else if (command.action === "play") {
    if (!booth.playing) await togglePlay();
    result = booth.playing ? "playing" : booth.message;
  } else if (command.action === "volume") {
    setVolume(command.value ?? booth.volume + command.delta);
    result = `volume ${booth.volume}`;
  } else if (command.action === "mute") {
    if (booth.volume > 0) booth.mutedVolume = booth.volume;
    setVolume(0);
    result = "muted";
  } else if (command.action === "unmute") {
    setVolume(booth.mutedVolume || 80);
    result = `volume ${booth.volume}`;
  } else if (command.action === "energy") {
    setEnergy(command.value ?? booth.energy + command.delta);
    result = `energy ${booth.energy} (${energyMode(booth.energy)})`;
  } else if (command.action === "hype") {
    hypeMoment();
    result = "hype!";
  } else if (command.action === "crossfade") {
    setCrossfade(command.value);
    result = `crossfade ${booth.crossfade}s`;
  } else if (command.action === "autoDj") {
    setAutoDj(command.value);
    result = booth.autoDj ? "Auto DJ on" : "Auto DJ off";
  } else if (command.action === "mixMode") {
    setMixMode(command.value);
    result = booth.mixMode === command.value ? `${command.value === "manual" ? "Manual" : "Auto"} mix` : els.mixerStatus.textContent;
  } else if (command.action === "transition") {
    setTransition(command.value);
    result = `transition: ${transitionNames[booth.transition]}`;
  } else if (command.action === "autoFade") {
    if (booth.mixMode === "manual") {
      result = (await autoFade()) ? "fading across" : els.mixerStatus.textContent;
    } else {
      nextTrack(true);
      result = "next song";
    }
  } else {
    const mode = { playSong: "now", playNext: "next", queueSong: "queue" }[command.action];
    result = await requestSong(command.query, mode);
  }

  booth.message = `Voice: ${result}`;
  renderDisplay();
  syncFromDisplay(true);
  return result;
}

// A song request plays from the queue when it's there, and otherwise from YouTube's top result.
// mode is "now" (play it), "next" (Up next), or "queue" (just add it).
async function requestSong(query, mode) {
  const playable = booth.tracks.map((track) => (track.unplayable ? {} : track));
  const index = findQueuedTrack(query, playable);

  if (index >= 0) {
    const track = booth.tracks[index];
    if (mode === "next") return playNextMessage(track, addToUpNext(index));
    if (mode !== "now") return `${track.title} is already in the queue`;
    cueTrack(index, true);
    return `playing ${track.title}`;
  }

  try {
    const response = await apiFetch(`/api/youtube/search?q=${encodeURIComponent(query)}`);
    const payload = await response.json();
    if (!response.ok) return `“${query}” isn't in the queue. ${payload.error || "YouTube search failed."}`;

    const video = payload.results[0];
    if (!video) return `couldn't find “${query}” in the queue or on YouTube`;

    addYouTubeTrack(video, mode === "now", mode === "next");
    if (mode === "now") return `playing ${video.title} from YouTube`;
    return mode === "next" ? `${video.title} from YouTube plays next` : `added ${video.title} from YouTube`;
  } catch {
    return `couldn't search YouTube for “${query}”. Check the internet connection.`;
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
      bpm: saved.bpm,
      firstBeat: saved.firstBeat,
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
    bpm: saved.bpm,
    firstBeat: saved.firstBeat,
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

function addYouTubeTrack(video, playNow, playNext = false) {
  const index = queueYouTubeVideo(video);
  if (index < 0) return;

  booth.message = `Queued ${booth.tracks[index].title} from YouTube`;

  if (playNow) {
    cueTrack(index, true);
  } else if (booth.currentIndex === -1) {
    loadTrack(index, false, false);
  } else if (playNext) {
    booth.message = playNextMessage(booth.tracks[index], addToUpNext(index));
  }

  renderDisplay();
  syncFromDisplay(true);
}

// "Add all": queue a whole set of results or a playlist, then render once.
function addYouTubeList(videos) {
  const added = (Array.isArray(videos) ? videos.slice(0, 100) : []).map(queueYouTubeVideo).filter((index) => index >= 0);
  if (!added.length) return;

  booth.message = `Added ${added.length} songs from YouTube`;
  if (booth.currentIndex === -1) loadTrack(added[0], false, false);
  renderDisplay();
  syncFromDisplay(true);
}

// Adds a YouTube video to the queue (or finds it already there) and returns its index, or -1.
function queueYouTubeVideo(video) {
  // Phones send videos over the socket, so check the shape before trusting it.
  const videoId = String(video?.videoId || "");
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return -1;

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

  return index;
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

  // Each deck's file engine is a mixer channel: 3-band EQ, then a sweep filter, then its fader.
  // An echo send taps in after the filter and skips the fader, so echoes keep ringing after
  // the fader closes (the Echo out transition).
  decks.forEach((deck) => {
    deck.source = audioContext.createMediaElementSource(deck.el);
    deck.eqNodes = {
      low: new BiquadFilterNode(audioContext, { type: "lowshelf", frequency: 200, gain: deck.eq.low }),
      mid: new BiquadFilterNode(audioContext, { type: "peaking", frequency: 1000, Q: 0.8, gain: deck.eq.mid }),
      high: new BiquadFilterNode(audioContext, { type: "highshelf", frequency: 3500, gain: deck.eq.high }),
    };
    deck.filter = new BiquadFilterNode(audioContext, { Q: 1 });
    applyFilter(deck.filter, deck.filterValue);
    deck.gain = audioContext.createGain();
    deck.gain.gain.value = levelFor(deck);
    deck.source
      .connect(deck.eqNodes.low)
      .connect(deck.eqNodes.mid)
      .connect(deck.eqNodes.high)
      .connect(deck.filter)
      .connect(deck.gain)
      .connect(analyser);

    deck.echo = {
      send: new GainNode(audioContext, { gain: 0 }),
      delay: new DelayNode(audioContext, { maxDelayTime: 2, delayTime: 0.375 }),
      feedback: new GainNode(audioContext, { gain: 0.55 }),
    };
    deck.filter.connect(deck.echo.send).connect(deck.echo.delay).connect(deck.echo.feedback).connect(deck.echo.delay);
    deck.echo.delay.connect(analyser);
  });

  // Master volume sits after the analyser, so the visualizer keeps moving at low volume.
  masterGain = audioContext.createGain();
  masterGain.gain.value = booth.volume / 100;
  analyser.connect(masterGain);
  masterGain.connect(audioContext.destination);
  await audioContext.resume();
}

async function togglePlay() {
  if (!booth.tracks.length) {
    booth.message = "Load music first";
    renderDisplay();
    return;
  }

  if (booth.mixMode === "manual") {
    await manualToggle();
    renderDisplay();
    syncFromDisplay(true);
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
  decks.forEach((deck) => deck.pause());
  booth.playing = false;
  booth.message = "Paused";
}

async function loadTrack(index, shouldPlay, useFade) {
  if (!booth.tracks[index] || isTransitioning) return;

  const track = booth.tracks[index];
  const currentDeck = activeDeck;
  const nextDeck = otherDeck(currentDeck);
  const canFade = useFade && shouldPlay && booth.playing && booth.crossfade > 0 && currentDeck.loaded;
  const previousIndex = booth.currentIndex;

  booth.currentIndex = index;
  const remembered = rememberPlay(track);
  booth.message = `Loaded ${track.title}`;
  ensureBpm(track);

  if (!canFade) {
    // No transition: reuse the current deck (it switches engine if needed) and stop the other.
    const deck = currentDeck;
    decks.filter((other) => other !== deck && other.loaded).forEach((other) => other.stop());
    activeDeck = deck;

    try {
      await deck.load(track);
      // Auto mix plays every song at its own tempo; Manual mix keeps the deck's tempo fader.
      if (booth.mixMode === "auto") deck.setTempo(1);
      deck.setLevel(levelFor(deck));
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
    // Freeze the outgoing deck's tempo (it may still be drifting back from the last mix).
    window.clearInterval(currentDeck.tempoTimer);
    await nextDeck.load(track);
    nextDeck.setLevel(0);
    const plan = booth.beatMatch ? beatMatchPlan(currentDeck, track) : null;
    nextDeck.setTempo(plan ? plan.rate : 1);
    if (plan) nextDeck.currentTime = plan.startTime;
    await nextDeck.play();
    if (plan) wait(0.25).then(() => alignBeats(nextDeck, currentDeck, plan));
    const style = await runTransition(currentDeck, nextDeck, booth.crossfade);
    currentDeck.stop();
    activeDeck = nextDeck;
    // After the mix, drift back to the song's own tempo slowly enough that nobody notices.
    if (plan && plan.rate !== 1) easeTempo(nextDeck, 1, 8);
    booth.playing = true;
    booth.message = `Now playing ${track.title}`;
    mixerStatus(`Last transition: ${transitionNames[style]}${plan ? ", beat-matched" : ""}.`);
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

  // Keep the music going: the old deck is still playing, so crossfade past a video YouTube refused.
  if (failed && booth.playing && track.unplayable) nextTrack(true);
}

// --- Play next ---------------------------------------------------------------------------------

// Where a track sits in the Up next list (1 = plays next), or 0 when it isn't on it.
function upNextPosition(track) {
  return booth.upNext.indexOf(track.id) + 1;
}

function addToUpNext(index) {
  const track = booth.tracks[index];
  if (!track) return 0;
  if (!booth.upNext.includes(track.id) && index !== booth.currentIndex) booth.upNext.push(track.id);
  return upNextPosition(track);
}

// The queue's Play next button: add the song to Up next, or take it off again.
function togglePlayNext(index) {
  const track = booth.tracks[index];
  if (!track) return;

  if (booth.upNext.includes(track.id)) {
    booth.upNext = booth.upNext.filter((id) => id !== track.id);
    booth.message = `${track.title} is off the Up next list`;
  } else {
    booth.message = playNextMessage(track, addToUpNext(index));
  }

  renderDisplay();
  syncFromDisplay(true);
}

function playNextMessage(track, position) {
  if (!position) return `${track.title} is already playing`;
  return position === 1 ? `${track.title} plays next` : `${track.title} is up next (#${position})`;
}

// Play now is what someone asked for, so a running crossfade delays it instead of dropping it.
// Automatic transitions still just skip while a crossfade runs.
function cueTrack(index, shouldPlay) {
  if (booth.mixMode === "manual") {
    manualPlay(index);
    return;
  }
  if (isTransitioning) {
    pendingCue = { index, shouldPlay };
    booth.message = `Up next: ${booth.tracks[index]?.title}`;
    renderDisplay();
    syncFromDisplay(true);
    return;
  }
  loadTrack(index, shouldPlay, true);
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

// --- Transitions -----------------------------------------------------------------------------

const transitionNames = {
  crossfade: "Crossfade",
  bassSwap: "Bass swap",
  filter: "Filter sweep",
  echo: "Echo out",
  brake: "Brake",
  cut: "Cut on the beat",
  random: "Mix it up",
};

function setTransition(style) {
  if (!transitionNames[style]) return;
  booth.transition = style;
  els.transitionSelect.value = style;
  saveSettings();
  syncFromDisplay(true);
}

// Runs one transition from `from` to `to` (already playing, silent) and returns its style. The
// effects need the outgoing song's audio in Web Audio, so a YouTube song can only crossfade or cut.
async function runTransition(from, to, seconds) {
  const duration = Math.max(0.2, seconds);
  const outIsFile = from.kind === "audio" && Boolean(from.gain);
  const bothFiles = outIsFile && to.kind === "audio" && Boolean(to.gain);
  const available = ["crossfade", "cut"];
  if (outIsFile) available.push("filter", "echo", "brake");
  if (bothFiles) available.push("bassSwap");

  const style = booth.transition === "random"
    ? available[Math.floor(Math.random() * available.length)]
    : available.includes(booth.transition) ? booth.transition : "crossfade";

  if (style === "cut") await cutOnBeat(from, to);
  else if (style === "filter") await filterSweep(from, to, duration);
  else if (style === "echo") await echoOut(from, to, duration);
  else if (style === "brake") await brake(from, to);
  else if (style === "bassSwap") await bassSwap(from, to, duration);
  else await fadeDecks(from, to, duration);

  return style;
}

// Cut: switch decks in one go, on the outgoing song's next beat when its tempo is known.
async function cutOnBeat(from, to) {
  const track = from.track;
  if (from.kind === "audio" && track?.bpm && track.firstBeat !== undefined) {
    const period = 60 / track.bpm;
    const phase = beatPhase(from.currentTime, track.firstBeat, period);
    await wait(((1 - phase) * period) / (from.rate || 1));
  }
  from.setLevel(0);
  to.setLevel(1);
}

// Filter sweep: a high-pass rises through the outgoing song, draining its bass and body, while
// the next song fades in underneath.
async function filterSweep(from, to, duration) {
  const now = audioContext.currentTime;
  const cutoff = from.filter.frequency;
  from.filter.type = "highpass";
  cutoff.cancelScheduledValues(0);
  cutoff.setValueAtTime(30, now);
  cutoff.exponentialRampToValueAtTime(5000, now + duration);

  const level = from.gain.gain;
  level.cancelScheduledValues(0);
  level.setValueAtTime(1, now);
  level.setValueAtTime(1, now + duration * 0.6);
  level.linearRampToValueAtTime(0, now + duration);
  to.fade(fadeCurves().fadeIn, duration);

  await wait(duration);
  from.setLevel(0);
  to.setLevel(1);
  cutoff.cancelScheduledValues(0);
  applyFilter(from.filter, from.filterValue);
}

// Echo out: the outgoing song feeds a tempo-synced echo for one beat, then drops out, leaving only
// its echoes ringing while the next song comes in.
async function echoOut(from, to, duration) {
  const now = audioContext.currentTime;
  const beat = from.track?.bpm ? 60 / (from.track.bpm * from.rate) : 0.5;
  const pull = now + Math.min(beat, duration * 0.4);
  const { send, delay, feedback } = from.echo;

  delay.delayTime.setValueAtTime(Math.min(1.5, beat * 0.75), now);
  feedback.gain.setValueAtTime(0.55, now);
  for (const param of [send.gain, from.gain.gain]) {
    param.cancelScheduledValues(0);
    param.setValueAtTime(1, now);
    param.setValueAtTime(1, pull);
    param.linearRampToValueAtTime(0, pull + 0.05);
  }
  to.fade(fadeCurves().fadeIn, Math.max(0.5, duration * 0.5));

  await wait(duration);
  from.setLevel(0);
  to.setLevel(1);
  send.gain.cancelScheduledValues(0);
  send.gain.value = 0;
}

// Brake: the outgoing song slows to a stop like a turntable losing power (pitch dropping with
// it), then the next song drops in at full volume.
function brake(from, to) {
  const seconds = 1.4;
  const startRate = from.rate;
  const level = from.gain.gain;
  const now = audioContext.currentTime;
  level.cancelScheduledValues(0);
  level.setValueAtTime(1, now);
  level.setValueAtTime(1, now + seconds - 0.25);
  level.linearRampToValueAtTime(0, now + seconds);
  from.el.preservesPitch = false;
  from.el.webkitPreservesPitch = false;

  return new Promise((resolve) => {
    const started = performance.now();
    // Driven by elapsed time, so a throttled timer in a hidden window only makes it less smooth.
    const timer = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - started) / (seconds * 1000));
      from.el.playbackRate = Math.max(0.25, startRate * (1 - progress) ** 1.5);
      if (progress < 1) return;

      window.clearInterval(timer);
      from.setLevel(0);
      from.pause();
      from.setKeyLock(from.keyLock);
      from.applyRate(startRate);
      to.setLevel(1);
      resolve();
    }, 30);
  });
}

// Bass swap: the next song rises with its bass cut; halfway through, the two basses swap so the
// low end never doubles up, then the outgoing song fades away.
async function bassSwap(from, to, duration) {
  const now = audioContext.currentTime;
  const middle = now + duration / 2;
  const outLow = from.eqNodes.low.gain;
  const inLow = to.eqNodes.low.gain;

  inLow.cancelScheduledValues(0);
  inLow.setValueAtTime(-26, now);
  inLow.setValueAtTime(to.eq.low, middle);
  outLow.cancelScheduledValues(0);
  outLow.setValueAtTime(from.eq.low, now);
  outLow.setValueAtTime(-26, middle);

  const inLevel = to.gain.gain;
  inLevel.cancelScheduledValues(0);
  inLevel.setValueAtTime(0, now);
  inLevel.linearRampToValueAtTime(1, middle);
  const outLevel = from.gain.gain;
  outLevel.cancelScheduledValues(0);
  outLevel.setValueAtTime(1, now);
  outLevel.setValueAtTime(1, middle);
  outLevel.linearRampToValueAtTime(0, now + duration);

  await wait(duration);
  from.setLevel(0);
  to.setLevel(1);
  for (const [param, value] of [[outLow, from.eq.low], [inLow, to.eq.low]]) {
    param.cancelScheduledValues(0);
    param.value = value;
  }
}

function wait(seconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, seconds * 1000);
  });
}

// A deck plays either an audio file, through its Web Audio mixer channel, or a YouTube video,
// through its own YouTube player. `deck.kind` says which engine the loaded track uses, so any
// two songs (file or YouTube) can overlap in a crossfade.
function createDeck(label, el, slot) {
  const hostId = slot.querySelector("div").id;
  let player = null;
  let playerReady = null;
  let lastError = null;
  let needsStart = false;
  let wantsPlay = false;
  let youtubeLevel = 1;
  let fadeTimer = 0;
  let progressTimer = 0;
  let startWaiter = null;

  function ensurePlayer() {
    if (!playerReady) {
      let created = null;
      const ready = loadYouTubeApi().then((YT) => new Promise((resolve) => {
        created = new YT.Player(hostId, {
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
        if (!document.getElementById(hostId)) {
          const host = document.createElement("div");
          host.id = hostId;
          slot.append(host);
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

  // Shared by both engines: Auto mix moves on; in Manual mix a finished deck just stops and the
  // DJ (or the safety net) decides what's next.
  function finished() {
    if (deck === activeDeck && booth.mixMode === "auto") nextTrack(false);
    else updateLiveDeck();
  }

  function handleState(event) {
    if (event.data === youtubeStates.playing) {
      needsStart = false;
      sessionInfo.youtubeStarted = true;
      settleStart(null);
    }
    if (event.data === youtubeStates.ended && deck.kind === "youtube") {
      wantsPlay = false;
      finished();
    }
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
    const track = deck.track;
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
    slot.hidden = !visible;
    layoutVideos();
  }

  // The deck's own level (fades and crossfader) times the booth's master volume.
  function applyYoutubeLevel(value) {
    youtubeLevel = clamp(value, 0, 1);
    player?.setVolume(Math.round(youtubeLevel * booth.volume));
  }

  function stopAudio() {
    el.pause();
    if (el.getAttribute("src")) {
      el.removeAttribute("src");
      el.load();
    }
  }

  function stopYouTube() {
    window.clearInterval(fadeTimer);
    window.clearInterval(progressTimer);
    settleStart(new Error("stopped"));
    wantsPlay = false;
    player?.stopVideo();
    showVideo(false);
  }

  const deck = {
    kind: "audio",
    label,
    el,
    slot,
    gain: null,
    source: null,
    eqNodes: null,
    filter: null,
    echo: null,
    track: null,
    rate: 1,
    keyLock: true,
    eq: { low: 0, mid: 0, high: 0 },
    filterValue: 0,
    cue: null,
    tempoTimer: 0,
    get loaded() {
      return Boolean(deck.track);
    },
    get playing() {
      if (!deck.track) return false;
      return deck.kind === "youtube" ? wantsPlay : !el.paused;
    },
    get currentTime() {
      if (deck.kind === "youtube") return player?.getCurrentTime?.() || 0;
      return el.currentTime || 0;
    },
    set currentTime(value) {
      if (deck.kind === "youtube") player?.seekTo(value, true);
      else el.currentTime = value;
    },
    get duration() {
      if (deck.kind === "youtube") return player?.getDuration?.() || 0;
      return Number.isFinite(el.duration) ? el.duration : 0;
    },
    async load(track) {
      if (track.kind === "youtube") {
        await ensurePlayer();
        stopAudio();
        window.clearInterval(progressTimer);
        deck.kind = "youtube";
        lastError = null;
        needsStart = true;
        wantsPlay = false;
        showVideo(true);
      } else {
        stopYouTube();
        deck.kind = "audio";
        el.pause();
        el.src = track.url;
        el.currentTime = 0;
        // A new src resets the element's rate, so put the deck's tempo back on it.
        deck.applyRate(deck.rate);
      }
      deck.track = track;
      deck.cue = null;
    },
    preview() {
      // Show the video's first frame while the booth is paused. Never cue right before
      // playing: YouTube then ignores the play request and stays cued.
      if (deck.kind === "youtube" && deck.track && needsStart) player.cueVideoById(deck.track.videoId);
    },
    async play() {
      if (deck.kind !== "youtube") return el.play();

      await ensurePlayer();
      // YouTube already refused this video while cueing it.
      if (deck.track?.unplayable && lastError) throw lastError;
      wantsPlay = true;

      // A newly loaded video must start even if the player is still playing the previous one.
      if (needsStart || player.getPlayerState() !== youtubeStates.playing) {
        try {
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
            if (needsStart) player.loadVideoById(deck.track.videoId);
            else player.playVideo();
          });
        } catch (error) {
          wantsPlay = false;
          throw error;
        }
      }

      window.clearInterval(progressTimer);
      // The YouTube player has no timeupdate event, so poll it while it plays.
      progressTimer = window.setInterval(() => {
        if (deck === activeDeck) updatePlaybackProgress();
      }, 500);
    },
    pause() {
      el.pause();
      if (deck.kind === "youtube") {
        wantsPlay = false;
        window.clearInterval(progressTimer);
        player?.pauseVideo();
      }
    },
    stop() {
      stopAudio();
      stopYouTube();
      deck.track = null;
      deck.cue = null;
    },
    // Levels go to both engines, so a deck keeps its level when it switches between them.
    setLevel(value) {
      if (deck.gain) {
        // Clear leftover fade automation first: setting a value inside a curve's time range throws.
        deck.gain.gain.cancelScheduledValues(0);
        deck.gain.gain.value = value;
      }
      window.clearInterval(fadeTimer);
      applyYoutubeLevel(value);
    },
    // For the crossfader: glide to the new level over a few milliseconds so drags don't click.
    setFaderLevel(value) {
      if (deck.gain) deck.gain.gain.setTargetAtTime(value, audioContext.currentTime, 0.015);
      window.clearInterval(fadeTimer);
      applyYoutubeLevel(value);
    },
    fade(curve, seconds) {
      if (deck.gain) {
        deck.gain.gain.cancelScheduledValues(0);
        deck.gain.gain.setValueCurveAtTime(curve, audioContext.currentTime, seconds);
      }
      window.clearInterval(fadeTimer);
      if (deck.kind !== "youtube") return;
      // YouTube volume can't be scheduled ahead, so step it on a timer.
      const started = performance.now();
      fadeTimer = window.setInterval(() => {
        const progress = Math.min(1, (performance.now() - started) / (seconds * 1000));
        applyYoutubeLevel(curve[Math.round(progress * (curve.length - 1))]);
        if (progress >= 1) window.clearInterval(fadeTimer);
      }, 50);
    },
    refreshVolume() {
      applyYoutubeLevel(youtubeLevel);
    },
    setTempo(rate) {
      window.clearInterval(deck.tempoTimer);
      deck.applyRate(rate);
    },
    applyRate(rate) {
      deck.rate = clamp(rate, 0.9, 1.1);
      el.defaultPlaybackRate = deck.rate;
      el.playbackRate = deck.rate;
    },
    setKeyLock(on) {
      deck.keyLock = Boolean(on);
      el.preservesPitch = deck.keyLock;
      el.webkitPreservesPitch = deck.keyLock;
    },
    setEq(band, decibels) {
      deck.eq[band] = clamp(decibels, -26, 6);
      deck.eqNodes?.[band].gain.setTargetAtTime(deck.eq[band], audioContext.currentTime, 0.02);
    },
    setFilter(value) {
      deck.filterValue = clamp(value, -1, 1);
      if (deck.filter) applyFilter(deck.filter, deck.filterValue);
    },
  };

  el.addEventListener("timeupdate", updatePlaybackProgress);
  el.addEventListener("ended", finished);

  return deck;
}

// Show the players of decks holding a YouTube video: one fills the stage, two (during a
// crossfade or a manual mix) sit side by side, since YouTube's players may never be covered.
function layoutVideos() {
  const visible = [els.youtubeSlotA, els.youtubeSlotB].filter((slot) => !slot.hidden).length;
  els.youtubeStage.hidden = visible === 0;
  els.youtubeStage.classList.toggle("is-split", visible === 2);
  els.stage.classList.toggle("has-video", visible > 0);
}

function applyFilter(node, value) {
  const { type, frequency } = filterSetting(value);
  node.type = type;
  node.frequency.setTargetAtTime(Math.min(frequency, audioContext.sampleRate / 2), audioContext.currentTime, 0.02);
}

// A deck's fader level: in Manual mix the crossfader decides, in Auto mix only the active deck is up.
function levelFor(deck) {
  if (booth.mixMode !== "manual") return deck === activeDeck ? 1 : 0;
  const { a, b } = crossfaderGains(booth.crossfader);
  return deck === decks[0] ? a : b;
}

function otherDeck(deck) {
  return deck === decks[0] ? decks[1] : decks[0];
}

// --- BPM analysis ---------------------------------------------------------------------------

// track.bpm is undefined until analysed, null when the track has no steady beat, else the tempo.
// Analyses run one at a time, because decoding a whole song takes a lot of memory.
function ensureBpm(track) {
  if (!track || track.kind !== "audio" || track.bpm !== undefined) return Promise.resolve(track?.bpm ?? null);

  if (!analysisJobs.has(track.key)) {
    const job = analysisQueue.then(() => analyzeTrack(track));
    analysisQueue = job.catch(() => {});
    analysisJobs.set(track.key, job);
  }

  return analysisJobs.get(track.key);
}

async function analyzeTrack(track) {
  try {
    const data = await (await fetch(track.url)).arrayBuffer();
    // 22.05 kHz is plenty for finding kick drums and needs a quarter of the memory of 44.1 kHz stereo.
    const decoded = await new OfflineAudioContext(1, 1, 22050).decodeAudioData(data);
    const rate = decoded.sampleRate;
    // Skip the intro of longer songs, where there's often no beat yet, and listen to a minute.
    const start = decoded.duration > 90 ? Math.floor(decoded.length * 0.25) : 0;
    const end = Math.min(decoded.length, start + 60 * rate);
    const mono = new Float32Array(end - start);

    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const samples = decoded.getChannelData(channel).subarray(start, end);
      for (let i = 0; i < mono.length; i += 1) mono[i] += samples[i] / decoded.numberOfChannels;
    }

    const result = detectBpm(mono, rate);
    if (result && result.confidence >= 2) {
      track.bpm = result.bpm;
      track.firstBeat = timeForPhase(0, start / rate + result.firstBeat, 60 / result.bpm);
    } else {
      track.bpm = null;
    }
    saveTrackAnalysis(track);
  } catch {
    // A failed fetch or decode isn't saved, so the next session tries again.
    track.bpm = null;
  }

  renderDisplay();
  return track.bpm;
}

// --- Beat matching ---------------------------------------------------------------------------

// How to bring `track` in on beat with what `outDeck` is playing: the incoming rate, where to
// start it, and both beat periods. Null when either tempo is unknown or they are over 8% apart.
function beatMatchPlan(outDeck, track) {
  const outTrack = outDeck.track;
  if (!outTrack?.bpm || !track?.bpm || outTrack.firstBeat === undefined || track.firstBeat === undefined) return null;

  const match = matchRate(outTrack.bpm * outDeck.rate, track.bpm);
  if (!match) return null;

  const outPeriod = 60 / outTrack.bpm;
  const inPeriod = 60 / (track.bpm * match.factor);
  const phase = beatPhase(outDeck.currentTime, outTrack.firstBeat, outPeriod);
  return { rate: match.rate, startTime: timeForPhase(phase, track.firstBeat, inPeriod), inPeriod, outPeriod };
}

// Playback starts a little late, so once the incoming deck runs, nudge it onto the beat. This
// happens while it is still nearly silent at the start of the fade.
function alignBeats(inDeck, outDeck, plan) {
  if (!inDeck.playing || !outDeck.playing || !inDeck.track || !outDeck.track) return;
  const outPhase = beatPhase(outDeck.currentTime, outDeck.track.firstBeat, plan.outPeriod);
  const inPhase = beatPhase(inDeck.currentTime, inDeck.track.firstBeat, plan.inPeriod);
  const beats = phaseDifference(inPhase, outPhase);
  if (Math.abs(beats) > 0.02) inDeck.currentTime = Math.max(0, inDeck.currentTime + beats * plan.inPeriod);
}

function easeTempo(deck, target, seconds) {
  window.clearInterval(deck.tempoTimer);
  const from = deck.rate;
  const started = performance.now();
  deck.tempoTimer = window.setInterval(() => {
    const progress = Math.min(1, (performance.now() - started) / (seconds * 1000));
    deck.applyRate(from + (target - from) * progress);
    if (progress >= 1) window.clearInterval(deck.tempoTimer);
    renderMixer();
  }, 250);
}

// Sync: match this deck's tempo to the other deck, and its beats too when both are playing.
function syncDeck(deck) {
  const other = otherDeck(deck);
  if (!deck.track || !other.track) {
    mixerStatus("Sync needs a track on both decks.");
    return;
  }
  if (deck.kind === "youtube" || other.kind === "youtube") {
    mixerStatus("Sync needs two of your own files. YouTube's player doesn't let the booth read its tempo.");
    return;
  }

  const plan = beatMatchPlan(other, deck.track);
  if (!plan) {
    mixerStatus(deck.track.bpm && other.track.bpm
      ? "These tempos are more than 8% apart, too far to sync."
      : "Sync needs the BPM of both tracks. Wait for the analysis to finish.");
    return;
  }

  deck.setTempo(plan.rate);
  if (deck.playing && other.playing) alignBeats(deck, other, plan);
  mixerStatus(`Deck ${deck.label} synced to ${(other.track.bpm * other.rate).toFixed(1)} BPM.`);
  renderMixer();
}

// --- Manual mix ------------------------------------------------------------------------------

function setMixMode(mode) {
  if (mode === booth.mixMode) return;
  if (isTransitioning || manualBusy) {
    mixerStatus("Wait for the crossfade to finish, then switch.");
    return;
  }

  if (mode === "manual") {
    booth.mixMode = "manual";
    setCrossfader(activeDeck === decks[1] ? 1 : 0);
    mixerStatus("Manual mix: load songs with the A and B buttons in the queue, then mix with the crossfader.");
  } else {
    stopCrossfaderAnimation();
    // Keep what the room hears and stop the other deck.
    const live = liveDeck();
    const other = otherDeck(live);
    if (other.loaded) other.stop();
    booth.mixMode = "auto";
    activeDeck = live;
    live.setLevel(1);
    booth.playing = live.playing;
    mixerStatus("Auto mix: the booth crossfades for you.");
  }

  saveSettings();
  renderDisplay();
  syncFromDisplay(true);
}

// The deck the room hears most: the crossfader's side, unless only the other deck is playing.
function liveDeck() {
  const playing = decks.filter((deck) => deck.playing);
  if (playing.length === 1) return playing[0];
  return booth.crossfader < 0.5 ? decks[0] : decks[1];
}

function setCrossfader(value) {
  booth.crossfader = clamp(value, 0, 1);
  els.crossfader.value = String(booth.crossfader);
  const { a, b } = crossfaderGains(booth.crossfader);
  decks[0].setFaderLevel(a);
  decks[1].setFaderLevel(b);
  updateLiveDeck();
}

// Keep the booth's idea of "now playing" in step with the decks. Only re-render the whole booth
// when that changes, since the crossfader can fire this many times a second.
function updateLiveDeck() {
  if (booth.mixMode !== "manual") {
    renderMixer();
    return;
  }

  const live = liveDeck();
  const playing = decks.some((deck) => deck.playing);
  const index = booth.tracks.indexOf(live.track);
  const changed = live !== activeDeck || playing !== booth.playing || (index >= 0 && index !== booth.currentIndex);

  activeDeck = live;
  booth.playing = playing;
  if (index >= 0 && index !== booth.currentIndex) {
    booth.currentIndex = index;
    if (playing) rememberPlay(live.track);
  }

  if (changed) {
    renderDisplay();
    syncFromDisplay(true);
  } else {
    renderMixer();
  }
}

async function loadIntoDeck(deck, index) {
  const track = booth.tracks[index];
  if (!track) return;

  try {
    await deck.load(track);
  } catch (error) {
    mixerStatus(error?.boothMessage || `Could not load ${track.title}.`);
    return;
  }
  ensureBpm(track);
  mixerStatus(`${track.title} is on deck ${deck.label}.`);
  updateLiveDeck();
  renderDisplay();
}

async function toggleDeck(deck) {
  if (!deck.loaded) {
    mixerStatus(`Load a track on deck ${deck.label} first, with the ${deck.label} button in the queue.`);
    return;
  }

  if (deck.playing) {
    deck.pause();
  } else {
    try {
      await setupAudio();
      await deck.play();
    } catch {
      mixerStatus("Press Play on the Mac once to unlock audio.");
    }
  }

  updateLiveDeck();
}

// Play and Pause in Manual mix: pause everything, or resume the deck the room hears.
async function manualToggle() {
  const playing = decks.filter((deck) => deck.playing);
  if (playing.length) {
    playing.forEach((deck) => deck.pause());
    booth.message = "Paused";
  } else {
    const deck = liveDeck();
    if (!deck.loaded) await loadIntoDeck(deck, Math.max(0, booth.currentIndex));
    try {
      await setupAudio();
      await deck.play();
      booth.message = "Booth is playing";
    } catch {
      booth.message = "Press Play on the Mac once to unlock audio";
    }
  }
  updateLiveDeck();
}

// Next and Play now in Manual mix: put the song (file or YouTube) on the deck the room
// isn't hearing, then fade over to it.
async function manualPlay(index) {
  const track = booth.tracks[index];
  if (!track || manualBusy) return;

  manualBusy = true;
  try {
    stopCrossfaderAnimation();
    const incoming = otherDeck(liveDeck());
    await incoming.load(track);
    ensureBpm(track);
    // Start from the live side, so the fade goes all the way across.
    setCrossfader(incoming === decks[0] ? 1 : 0);
    if (!(await autoFade())) manualBusy = false;
  } catch {
    manualBusy = false;
  }
}

// Auto fade: start the far deck if needed (on beat when possible) and glide the crossfader over.
async function autoFade() {
  const target = booth.crossfader < 0.5 ? 1 : 0;
  const incoming = decks[target];
  const outgoing = otherDeck(incoming);

  if (!incoming.loaded) {
    mixerStatus(`Load a track on deck ${incoming.label} first.`);
    return false;
  }

  await setupAudio();
  if (!incoming.playing) {
    const plan = booth.beatMatch && outgoing.playing ? beatMatchPlan(outgoing, incoming.track) : null;
    if (plan) incoming.setTempo(plan.rate);
    try {
      await incoming.play();
    } catch {
      mixerStatus("Press Play on the Mac once to unlock audio.");
      return false;
    }
    if (plan) wait(0.25).then(() => alignBeats(incoming, outgoing, plan));
  }

  manualBusy = true;
  animateCrossfader(target, booth.crossfade);
  return true;
}

function animateCrossfader(target, seconds) {
  stopCrossfaderAnimation();
  const from = booth.crossfader;
  const started = performance.now();
  const duration = Math.max(0.2, seconds) * 1000;

  // A timer, not requestAnimationFrame, so the fade still finishes in a hidden window.
  crossfaderTimer = window.setInterval(() => {
    const progress = Math.min(1, (performance.now() - started) / duration);
    setCrossfader(from + (target - from) * progress);
    if (progress < 1) return;

    stopCrossfaderAnimation();
    // The deck that faded out has nothing left to do.
    const faded = otherDeck(decks[target]);
    if (faded.playing) faded.pause();
    manualBusy = false;
    updateLiveDeck();
  }, 40);
}

function stopCrossfaderAnimation() {
  window.clearInterval(crossfaderTimer);
  crossfaderTimer = 0;
}

// --- Mixer panel -----------------------------------------------------------------------------

function buildMixer() {
  const center = els.mixerPanel.querySelector(".mixer-center");

  decks.forEach((deck, index) => {
    const root = els.deckStripTemplate.content.firstElementChild.cloneNode(true);
    const find = (selector) => root.querySelector(selector);
    const parts = {
      name: find(".deck-name"),
      state: find(".deck-state"),
      track: find(".deck-track"),
      bpm: find(".deck-bpm"),
      play: find(".deck-play"),
      cue: find(".deck-cue"),
      sync: find(".deck-sync"),
      tempo: find(".deck-tempo"),
      tempoValue: find(".deck-tempo-value"),
      keyLock: find(".deck-keylock"),
      eq: root.querySelectorAll(".deck-eq"),
      eqValues: root.querySelectorAll(".deck-eq-value"),
      filter: find(".deck-filter"),
      filterValue: find(".deck-filter-value"),
      platter: find(".deck-platter"),
      platterLabel: find(".deck-platter-label"),
    };

    parts.name.textContent = `Deck ${deck.label}`;
    parts.platterLabel.textContent = deck.label;
    bindPlatter(deck, parts.platter);
    parts.play.addEventListener("click", () => toggleDeck(deck));
    parts.sync.addEventListener("click", () => syncDeck(deck));
    parts.cue.title = "Click to set a cue point, click again to jump back to it, right-click to clear it.";
    parts.cue.addEventListener("click", () => {
      if (!deck.loaded) return;
      if (deck.cue === null) {
        deck.cue = deck.currentTime;
        mixerStatus(`Cue set at ${formatTime(deck.cue)} on deck ${deck.label}. Click Cue to jump back; right-click to clear.`);
      } else {
        deck.currentTime = deck.cue;
      }
      renderMixer();
    });
    parts.cue.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      deck.cue = null;
      renderMixer();
    });

    parts.tempo.addEventListener("input", () => {
      deck.setTempo(1 + Number(parts.tempo.value) / 100);
      renderMixer();
    });
    parts.keyLock.addEventListener("change", () => deck.setKeyLock(parts.keyLock.checked));
    parts.eq.forEach((slider) => {
      slider.addEventListener("input", () => {
        deck.setEq(slider.dataset.band, Number(slider.value));
        renderMixer();
      });
    });
    parts.filter.addEventListener("input", () => {
      deck.setFilter(Number(parts.filter.value));
      renderMixer();
    });

    // Double-click any knob to put it back in the middle.
    [parts.tempo, parts.filter, ...parts.eq].forEach((slider) => {
      slider.addEventListener("dblclick", () => {
        slider.value = "0";
        slider.dispatchEvent(new Event("input"));
      });
    });

    if (index === 0) center.before(root);
    else center.after(root);
    deckStrips.push({ deck, root, parts });
  });

  els.mixModeTabs.forEach((tab) => {
    tab.addEventListener("click", () => setMixMode(tab.dataset.mixMode));
  });
  els.crossfader.addEventListener("input", () => {
    // Grabbing the crossfader takes over from an auto fade.
    if (crossfaderTimer) {
      stopCrossfaderAnimation();
      manualBusy = false;
    }
    setCrossfader(els.crossfader.value);
  });
  els.autoFadeBtn.addEventListener("click", () => autoFade());
  els.mixNextBtn.addEventListener("click", () => nextTrack(true));
  els.transitionSelect.addEventListener("change", () => setTransition(els.transitionSelect.value));
  els.beatMatchToggle.addEventListener("change", () => {
    booth.beatMatch = els.beatMatchToggle.checked;
    saveSettings();
  });

  if (booth.mixMode === "manual") setCrossfader(booth.crossfader);
  renderMixer();
}

function renderMixer() {
  if (isRemote || !deckStrips.length) return;

  els.mixerPanel.dataset.mode = booth.mixMode;
  els.mixModeTabs.forEach((tab) => {
    const selected = tab.dataset.mixMode === booth.mixMode;
    tab.classList.toggle("is-selected", selected);
    tab.setAttribute("aria-pressed", String(selected));
  });
  els.crossfader.disabled = booth.mixMode !== "manual";
  if (booth.mixMode !== "manual") els.crossfader.value = activeDeck === decks[1] ? "1" : "0";
  els.beatMatchToggle.checked = booth.beatMatch;
  els.transitionSelect.value = booth.transition;

  deckStrips.forEach(({ deck, root, parts }) => {
    const live = deck === activeDeck && deck.playing;
    root.classList.toggle("is-live", live);
    // YouTube's audio never reaches Web Audio, so its deck has no EQ, filter, tempo, or sync.
    const youtube = deck.kind === "youtube" && deck.loaded;
    root.classList.toggle("is-youtube", youtube);
    [parts.tempo, parts.keyLock, parts.filter, parts.sync, ...parts.eq].forEach((control) => {
      control.disabled = youtube;
    });
    parts.state.textContent = !deck.loaded ? "Empty" : live ? "Live" : deck.playing ? "Playing" : "Paused";
    parts.state.classList.toggle("muted", !deck.playing);
    parts.track.textContent = deck.track ? deck.track.title : "No track loaded";
    parts.bpm.textContent = bpmText(deck);
    renderPlatter(deck, parts);
    parts.play.textContent = deck.playing ? "Pause" : "Play";
    parts.cue.textContent = deck.cue === null ? "Set cue" : `Cue ${formatTime(deck.cue)}`;
    if (document.activeElement !== parts.tempo) parts.tempo.value = ((deck.rate - 1) * 100).toFixed(1);
    parts.tempoValue.textContent = `${deck.rate >= 1 ? "+" : ""}${((deck.rate - 1) * 100).toFixed(1)}%`;
    parts.keyLock.checked = deck.keyLock;
    parts.eq.forEach((slider) => {
      slider.value = String(deck.eq[slider.dataset.band]);
    });
    parts.eqValues.forEach((output) => {
      const value = deck.eq[output.dataset.band];
      output.textContent = `${value > 0 ? "+" : ""}${value} dB`;
    });
    parts.filter.value = String(deck.filterValue);
    parts.filterValue.textContent = Math.abs(deck.filterValue) < 0.02
      ? "Open"
      : `${deck.filterValue < 0 ? "Low-pass" : "High-pass"} ${Math.round(Math.abs(deck.filterValue) * 100)}%`;
  });
}

// The platter works like a jog wheel: drag right to push the song ahead, left to hold it back
// (up to ±4% while you hold it), then let go and it returns to the deck's tempo. Handy for
// lining up beats by ear. Files only, since YouTube's player can't bend its speed smoothly.
function bindPlatter(deck, platter) {
  let startX = null;

  platter.addEventListener("pointerdown", (event) => {
    if (deck.kind !== "audio" || !deck.playing) return;
    startX = event.clientX;
    platter.setPointerCapture(event.pointerId);
    platter.classList.add("is-nudging");
  });

  platter.addEventListener("pointermove", (event) => {
    if (startX === null) return;
    const push = clamp((event.clientX - startX) / 60, -1, 1);
    deck.el.playbackRate = deck.rate * (1 + 0.04 * push);
  });

  const release = () => {
    if (startX === null) return;
    startX = null;
    deck.el.playbackRate = deck.rate;
    platter.classList.remove("is-nudging");
  };
  platter.addEventListener("pointerup", release);
  platter.addEventListener("pointercancel", release);
  platter.addEventListener("lostpointercapture", release);
}

function renderPlatter(deck, parts) {
  const { platter, platterLabel } = parts;
  // One turn per 1.8 seconds is 33⅓ RPM; the tempo fader speeds the record up or down with it.
  platter.style.setProperty("--spin", `${(1.8 / (deck.rate || 1)).toFixed(3)}s`);
  platter.classList.toggle("is-spinning", deck.playing);
  platter.classList.toggle("is-empty", !deck.loaded);
  const videoId = deck.kind === "youtube" ? deck.track?.videoId : null;
  platterLabel.style.backgroundImage = videoId ? `url("https://i.ytimg.com/vi/${videoId}/mqdefault.jpg")` : "";
  platterLabel.classList.toggle("has-art", Boolean(videoId));
}

// --- Sound check ------------------------------------------------------------------------------

function bindSoundCheck() {
  els.soundCheckBtn.addEventListener("click", () => {
    els.soundCheckDialog.showModal();
    renderSoundCheck();
  });
  els.soundCheckClose.addEventListener("click", () => els.soundCheckDialog.close());

  // The browser drops a wake lock whenever the tab is hidden, so take it again on return.
  document.addEventListener("visibilitychange", () => {
    if (wantsAwake && !wakeLock && document.visibilityState === "visible") keepAwake();
  });

  renderSoundCheck();
}

async function keepAwake() {
  wantsAwake = true;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
      renderSoundCheck();
    });
  } catch {
    wakeLock = null;
  }
  renderSoundCheck();
}

// Manual confirmations ("sounds good", "notifications off") count for the day they were given.
function confirmCheck(name) {
  const today = new Date().toLocaleDateString("en-CA");
  const saved = readJson(preflightKey, {});
  const confirmed = saved.date === today ? saved : { date: today };
  confirmed[name] = true;
  try {
    writeJson(preflightKey, confirmed);
  } catch {
    // Private windows can refuse storage; the check just won't be remembered.
  }
}

function confirmedToday(name) {
  const saved = readJson(preflightKey, {});
  return saved.date === new Date().toLocaleDateString("en-CA") && Boolean(saved[name]);
}

function showQrCode() {
  els.soundCheckDialog.close();
  els.qrCard.scrollIntoView({ behavior: "smooth", block: "center" });
  els.qrCard.classList.add("is-highlighted");
  window.setTimeout(() => els.qrCard.classList.remove("is-highlighted"), 2500);
}

// Each check says whether it's done ("ok"), needs doing ("todo"), looks wrong ("warn"), or doesn't
// apply ("skip"), and offers one-click actions where the booth can help.
function soundChecks() {
  const songs = booth.tracks.length;
  const lowVolume = booth.volume < 30;
  const youtubeTrack = booth.tracks.find((track) => track.kind === "youtube" && !track.unplayable);
  const voiceSection = els.displayView.querySelector(".voice-control");
  const canWake = "wakeLock" in navigator;

  return [
    {
      title: "Booth is open on the Mac",
      state: socket.connected ? "ok" : "todo",
      detail: socket.connected
        ? "Connected to the server at localhost."
        : "Not connected. Check the server is still running in Terminal, then reload this page.",
    },
    {
      title: "Audio is unlocked",
      state: audioContext?.state === "running" ? "ok" : "todo",
      detail: audioContext?.state === "running"
        ? "The browser will play sound, even when the phone starts it."
        : "Browsers need one click on the Mac before a page can play sound.",
      actions: audioContext?.state === "running" ? [] : [{ label: "Unlock audio", run: setupAudio }],
    },
    {
      title: "Music is loaded",
      state: songs ? "ok" : "todo",
      detail: songs ? `${songs} songs in the queue.` : "Choose a music folder, drop in files, or search for music.",
      actions: songs ? [] : [{ label: "Choose a folder", run: () => els.folderInput.click() }],
    },
    {
      title: "Volume is up",
      state: lowVolume ? "warn" : "ok",
      detail: lowVolume
        ? `The booth's master volume is only ${booth.volume}%, so guests won't hear much.`
        : `Master volume is ${booth.volume}%. Set the Mac's own volume high too.`,
      actions: lowVolume ? [{ label: "Set to 80%", run: () => setVolume(80) }] : [],
    },
    {
      title: "Phone remote is paired",
      state: sessionInfo.phones ? "ok" : "todo",
      detail: sessionInfo.phones
        ? `${sessionInfo.phones} phone${sessionInfo.phones === 1 ? "" : "s"} connected.`
        : "Scan the QR code with your phone, on the same Wi-Fi as the Mac.",
      actions: sessionInfo.phones ? [] : [{ label: "Show the QR code", run: showQrCode }],
    },
    {
      title: "Transitions sound right",
      state: confirmedToday("crossfade") ? "ok" : "todo",
      detail: "While music plays, press Mix next and listen to the change. Then confirm it sounds good.",
      actions: confirmedToday("crossfade")
        ? []
        : [{ label: "Mix next", run: () => nextTrack(true) }, { label: "Sounds good", run: () => confirmCheck("crossfade") }],
    },
    {
      title: "YouTube search is set up",
      state: sessionInfo.youtubeSearch ? "ok" : "skip",
      detail: sessionInfo.youtubeSearch
        ? "YouTube search is on."
        : "Optional. Add YOUTUBE_API_KEY to the .env file and restart the server to search YouTube.",
    },
    {
      title: "YouTube plays with sound",
      state: !sessionInfo.youtubeSearch ? "skip" : sessionInfo.youtubeStarted ? "ok" : "todo",
      detail: sessionInfo.youtubeStarted
        ? "A YouTube song has started on this booth."
        : youtubeTrack
          ? "Play one YouTube song so you know it starts with sound."
          : "Add a YouTube song from search and play it once.",
      actions: sessionInfo.youtubeSearch && !sessionInfo.youtubeStarted && youtubeTrack
        ? [{ label: "Play one now", run: () => cueTrack(booth.tracks.indexOf(youtubeTrack), true) }]
        : [],
    },
    {
      title: "Voice commands work",
      state: sessionInfo.voiceUsed ? "ok" : "todo",
      detail: sessionInfo.voiceUsed
        ? "A voice command ran on this booth."
        : canListen()
          ? "Press Talk (or V) and say “louder”, or type it in the Voice box."
          : "Type “louder” in the Voice box. For Talk, open the booth in Chrome or Safari.",
      actions: canListen() && !sessionInfo.voiceUsed ? [{ label: "Talk", run: () => toggleListening(voiceSection) }] : [],
    },
    {
      title: "Mac stays awake",
      state: wakeLock ? "ok" : "todo",
      detail: wakeLock
        ? "The screen won't sleep while this page is open. Keep the charger plugged in."
        : canWake
          ? "Keep the screen awake while the booth runs, and plug in the charger."
          : "This browser can't keep the screen awake. Turn sleep off in System Settings > Lock Screen.",
      actions: wakeLock || !canWake ? [] : [{ label: "Keep awake", run: keepAwake }],
    },
    {
      title: "Notifications are off",
      state: confirmedToday("notifications") ? "ok" : "todo",
      detail: "Turn on Do Not Disturb (Control Center > Focus), so pop-ups and alert sounds don't interrupt the music.",
      actions: confirmedToday("notifications") ? [] : [{ label: "Done", run: () => confirmCheck("notifications") }],
    },
  ];
}

function renderSoundCheck() {
  if (isRemote || !els.soundCheckBtn) return;

  const checks = soundChecks();
  const counted = checks.filter((check) => check.state !== "skip");
  const ready = counted.filter((check) => check.state === "ok").length;
  const allReady = ready === counted.length;
  els.soundCheckBtn.textContent = allReady ? "Sound check: all set" : `Sound check · ${counted.length - ready} to do`;
  els.soundCheckBtn.classList.toggle("is-ready", allReady);
  if (!els.soundCheckDialog.open) return;

  els.soundCheckSummary.textContent = allReady ? "All set. Enjoy the party!" : `${ready} of ${counted.length} ready.`;
  const marks = { ok: "✓", todo: "•", warn: "!", skip: "–" };
  const labels = { ok: "Done", todo: "To do", warn: "Check this", skip: "Not needed" };

  els.soundCheckList.replaceChildren(...checks.map((check) => {
    const row = document.createElement("li");
    row.className = `sound-check-row is-${check.state}`;

    const mark = document.createElement("span");
    mark.className = "sound-check-mark";
    mark.textContent = marks[check.state];
    mark.setAttribute("aria-label", labels[check.state]);

    const text = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = check.title;
    const detail = document.createElement("p");
    detail.textContent = check.detail;
    text.append(title, detail);

    const actions = document.createElement("div");
    actions.className = "sound-check-actions";
    (check.actions || []).forEach(({ label, run }) => {
      actions.append(actionButton(label, async () => {
        await run();
        renderSoundCheck();
      }));
    });

    row.append(mark, text, actions);
    return row;
  }));
}

function bpmText(deck) {
  const track = deck.track;
  if (!track) return "BPM —";
  if (deck.kind === "youtube") return "YouTube: volume and crossfader only";
  if (track.bpm === undefined) return analysisJobs.has(track.key) ? "BPM: analyzing…" : "BPM —";
  if (!track.bpm) return "BPM: no steady beat";
  const playingAt = (track.bpm * deck.rate).toFixed(1);
  return deck.rate === 1 ? `${playingAt} BPM` : `${playingAt} BPM (track ${track.bpm})`;
}

function mixerStatus(text) {
  els.mixerStatus.textContent = text;
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
  // Once a requested song starts, it leaves the Up next list.
  booth.upNext = booth.upNext.filter((id) => id !== track.id);
  if (booth.history.at(-1) === track.id) return false;
  booth.history.push(track.id);
  track.plays += 1;
  return true;
}

function nextTrack(useFade) {
  if (!booth.tracks.length) return;
  const nextIndex = chooseNextIndex();
  if (nextIndex < 0) return;
  if (booth.mixMode === "manual") {
    manualPlay(nextIndex);
    return;
  }
  loadTrack(nextIndex, booth.playing, useFade);
}

function previousTrack() {
  if (!booth.tracks.length || isTransitioning) return;
  // In Manual mix, Prev restarts the deck the room hears; the DJ picks what comes before.
  if (activeDeck.currentTime > 4 || booth.mixMode === "manual") {
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
  // Songs someone asked to play next come first, in the order they were asked for.
  for (const id of booth.upNext) {
    const index = booth.tracks.findIndex((track) => track.id === id);
    if (index >= 0 && index !== booth.currentIndex && !booth.tracks[index].unplayable) return index;
  }

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

  // Seconds of real time left: a deck playing faster than 100% runs out sooner.
  const remaining = (duration - activeDeck.currentTime) / (activeDeck.rate || 1);
  const dueForNext = booth.autoDj && booth.playing && duration > 0 && trusted && remaining <= Math.max(1.2, booth.crossfade + 0.25);

  if (booth.mixMode === "manual") {
    // Safety net: with Auto DJ on, fade to the next song before the live deck runs out, unless
    // the DJ already has the other deck playing.
    if (dueForNext && !manualBusy && !otherDeck(activeDeck).playing) nextTrack(true);
  } else if (dueForNext && !isTransitioning) {
    nextTrack(true);
  }

  renderPlaybackOnly();
  // Keep the deck strips current during crossfades, when the rest of the booth isn't re-rendered.
  renderMixer();
}

function applySettingsToInputs() {
  els.volumeSlider.value = String(booth.volume);
  els.energySlider.value = String(booth.energy);
  els.crossfadeSlider.value = String(booth.crossfade);
  els.autoDjToggle.checked = booth.autoDj;
}

function saveSettings() {
  writeJson(settingsKey, {
    volume: booth.volume,
    energy: booth.energy,
    crossfade: booth.crossfade,
    autoDj: booth.autoDj,
    mixMode: booth.mixMode,
    beatMatch: booth.beatMatch,
    transition: booth.transition,
  });
}

function saveTrackPrefs(track) {
  mergeTrackPrefs(track, { energy: track.energy });
}

function saveTrackAnalysis(track) {
  mergeTrackPrefs(track, { bpm: track.bpm, firstBeat: track.firstBeat });
}

// Merge into what is stored, so other tracks (and this track's other fields) survive.
function mergeTrackPrefs(track, fields) {
  const prefs = readJson(trackPrefsKey, {});
  prefs[track.key] = { ...prefs[track.key], ...fields };
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
  els.deckIndicator.textContent = activeDeck.kind === "youtube" && activeDeck.loaded ? `${activeDeck.label} · YouTube` : activeDeck.label;
  els.nextTrackTitle.textContent = nextTrack ? nextTrack.title : "No queue";
  els.roomModeReadout.textContent = mode;
  els.queueSizeReadout.textContent = String(booth.tracks.length);
  els.signalReadout.textContent = booth.playing ? "Live" : "Ready";
  renderPlaybackOnly();
  renderQueue();
  renderMixer();
  renderSoundCheck();

  // Analyse what's playing and what's next ahead of time, so the next mix can be beat-matched.
  ensureBpm(currentTrack);
  ensureBpm(nextTrack);
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
    const bpm = track.bpm ? ` - ${track.bpm} BPM` : "";
    meta.textContent = `${track.artist} - ${formatTime(track.duration)}${sourceLabel(track)}${bpm} - energy ${track.energy} - ${track.votes} votes`;
    info.append(title, meta);
    const upNext = upNextPosition(track);
    if (upNext) {
      row.classList.add("is-up-next");
      title.prepend(upNextBadge(upNext));
    }

    const actions = document.createElement("div");
    actions.className = "queue-actions";
    const playNow = actionButton("Play now", () => cueTrack(index, true));
    const position = upNextPosition(track);
    const playNext = actionButton(position ? "Cancel next" : "Play next", () => togglePlayNext(index));
    if (position) playNext.classList.add("is-selected");
    const vote = actionButton("Vote", () => {
      track.votes += 1;
      renderDisplay();
      syncFromDisplay(true);
    });
    actions.append(playNow, playNext, vote, tagButton("Warm", track, 28), tagButton("Groove", track, 55), tagButton("Peak", track, 86));
    if (booth.mixMode === "manual" && track.kind === "audio") {
      actions.append(
        actionButton("A", () => loadIntoDeck(decks[0], index)),
        actionButton("B", () => loadIntoDeck(decks[1], index)),
      );
    }

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

  const addAll = actionButton(`Add all ${results.length} to the queue`, () => {
    if (isRemote) sendCommand({ type: "addYouTubeList", videos: results });
    else addYouTubeList(results);
    section.querySelector(".search-status").textContent = `Added ${results.length} songs to the booth queue.`;
    addAll.disabled = true;
    addAll.textContent = "All added";
  });
  addAll.classList.add("add-all");

  container.replaceChildren(addAll, ...results.map((video) => {
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
    const playNow = actionButton("Play now", () => queueYouTube(section, video, "now"));
    const playNext = actionButton("Play next", () => {
      queueYouTube(section, video, "next");
      playNext.textContent = "Up next";
    });
    const add = actionButton("Add to queue", () => {
      queueYouTube(section, video, "queue");
      add.textContent = "Added";
    });

    const source = document.createElement("a");
    source.className = "search-link";
    source.href = video.url;
    source.target = "_blank";
    source.rel = "noreferrer";
    source.textContent = "YouTube";

    actions.append(playNow, playNext, add, source);
    row.append(thumb, info, actions);
    return row;
  }));
}

// mode is "now", "next" (Up next), or "queue" (just add it).
function queueYouTube(section, video, mode) {
  const status = section.querySelector(".search-status");
  const playNow = mode === "now";
  const playNext = mode === "next";

  if (isRemote) {
    sendCommand({ type: "addYouTube", video, playNow, playNext });
  } else {
    addYouTubeTrack(video, playNow, playNext);
  }

  status.textContent = playNow
    ? `Playing ${video.title} on the booth.`
    : playNext ? `${video.title} plays after the current song.` : `Added ${video.title} to the booth queue.`;
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
  els.remoteVolume.value = String(remoteState.volume ?? 100);
  els.remoteEnergy.value = String(remoteState.energy ?? 52);
  els.remoteCrossfade.value = String(remoteState.crossfade ?? 5);
  if (document.activeElement !== els.remoteTransition) els.remoteTransition.value = remoteState.transition || "crossfade";
  els.remoteQueueCount.textContent = `${playlist.length} tracks`;

  // Show the booth's answer to a voice command under the phone's voice box. The first state a
  // phone receives only sets the baseline, so it doesn't show an old answer from before it joined.
  const voiceStatus = els.remoteView.querySelector(".voice-status");
  if (voiceStatus.dataset.shown === undefined) {
    voiceStatus.dataset.shown = remoteState.message || "";
  } else if (remoteState.message?.startsWith("Voice: ") && voiceStatus.dataset.shown !== remoteState.message) {
    voiceStatus.dataset.shown = remoteState.message;
    voiceStatus.textContent = `Booth: ${remoteState.message.slice("Voice: ".length)}`;
  }

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
    if (track.upNext) {
      row.classList.add("is-up-next");
      title.prepend(upNextBadge(track.upNext));
    }
    const playNext = remoteAction(track.upNext ? "Cancel next" : "Play next", { type: "playNext", trackId: track.id });
    if (track.upNext) playNext.classList.add("is-selected");
    actions.append(
      remoteAction("Play now", { type: "jumpTo", trackId: track.id }),
      playNext,
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
    volume: booth.volume,
    transition: booth.transition,
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
    upNext: upNextPosition(track),
  };
}

function upNextBadge(position) {
  const badge = document.createElement("span");
  badge.className = "up-next-badge";
  badge.textContent = position === 1 ? "Up next" : `Up next #${position}`;
  return badge;
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
