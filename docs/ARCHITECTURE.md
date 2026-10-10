# Architecture

Party DJ Booth is intentionally local-first. The server coordinates screens, but the Mac browser owns audio playback.

## Runtime Pieces

```text
Mac terminal
  server.js
    Express static server
    Socket.IO realtime sync
    QR code generation
    Internet Archive open-audio search
    local music download library
    YouTube Data API search (key from .env)

Mac browser
  public/app.js
    local audio file import
    Web Audio graph
    two audio decks + a YouTube deck (IFrame player)
    crossfades between any two decks
    mixer: EQ, filter, tempo, BPM analysis, beat matching, Manual mix
    master volume
    voice commands (Web Speech API, push-to-talk)
    visualizer canvas
    queue state
    remote command handler

  public/voice.js
    voice command parser and song matching (pure, unit-tested)

  public/mixing.js
    BPM detection, beat grids, tempo matching, crossfader and filter curves (pure, unit-tested)

Phone browser
  public/app.js
    remote UI
    voice command box (keyboard dictation)
    Socket.IO command sender
    live state renderer
```

## Why Audio Lives On The Mac

Browsers do not let a web app read arbitrary local files without a user choosing them. The Mac chooses the audio files, creates local object URLs, and plays them locally.

The phone receives metadata only:

- title
- artist
- duration
- energy
- votes
- current track
- playback progress

The phone never receives the audio file itself.

Downloaded search results are different: the server downloads them into `music-downloads/` on the Mac, serves them from `/music/...`, and then the Mac booth adds that local URL to the live queue.

YouTube tracks are streamed, never stored. The booth plays them through YouTube's embedded player, and the phone only sends the video's ID, title, channel, and length.

## Realtime Flow

1. Mac opens `http://localhost:4242/`.
2. Phone opens `/?remote=1&session=<code>` from the QR code.
3. Both connect to Socket.IO and declare their role in the handshake: `display` for the Mac, `remote` plus the session code for the phone.
4. The server checks the role before accepting the socket (see [Access Control](#access-control)).
5. Mac broadcasts state with `display:state`.
6. Phone sends commands with `remote:command`.
7. Server broadcasts commands as `player:command`.
8. Mac handles commands and rebroadcasts updated state.

Socket.IO resends the handshake on every reconnect, so after a Wi-Fi drop the server checks the role again and counts the device correctly. After a server restart the session code is new, so phones with the old link are refused and show **Scan the QR code again**.

The server works out the display and phone counts by counting live sockets by role each time a socket connects or disconnects. It then sends them out as a `presence` event. Recounting instead of keeping running totals means reconnects cannot push the counts out of sync.

## Access Control

The server trusts two kinds of clients.

**The booth** is a browser on this Mac at `localhost`. A request counts as the booth only when all three hold:

- It comes from a loopback address (`127.0.0.1` or `::1`).
- Its `Host` header is `localhost`, `127.0.0.1`, or `[::1]`. This stops a DNS-rebinding web page, which reaches the server from the Mac but under its own host name, from posing as the booth.
- Its `Origin` header, if any, matches the `Host`. Browsers send `Origin` on cross-site requests and on every WebSocket handshake. CORS does not cover WebSockets, so this check is what keeps other websites out.

**A paired phone** carries the session code from the QR link: in the Socket.IO handshake (`auth.session`) and in the `X-Party-Session` header on API calls. The code is 6 random bytes (`crypto.randomBytes`), regenerated on every server start, and compared in constant time. The `Origin` check applies here too.

| Route or event | Booth | Paired phone | Anyone else |
| --- | --- | --- | --- |
| Static page files | yes | yes | yes |
| Socket as `display`, `display:state` | yes | no | no |
| Socket as `remote`, `remote:command` | yes | yes | no |
| `GET /api/search`, `POST /api/download` | yes | yes | no |
| `GET /api/youtube/search`, `GET /api/youtube/playlist` | yes | yes | no |
| `GET /api/session` (QR code and session code) | yes | no | no |
| `GET /api/downloads`, `/music/*` | yes | no | no |

Refused sockets get a `not-authorized` connect error, which the page turns into a plain message. Refused API calls get HTTP 403.

## Open-Audio Boundary

Search and download share one Internet Archive filter:

```text
mediatype:audio
AND (collection:opensource_audio OR collection:netlabels OR collection:etree)
AND NOT collection:stream_only
```

The user's search text is wrapped in parentheses before the filter is added. Before downloading, the server runs the same filtered search for `identifier:"<id>"` and refuses the download unless the item is found. So anything search can show can be downloaded, and nothing else.

YouTube is outside this boundary on purpose: it is search and play only. `/api/youtube/search` calls the YouTube Data API v3 with the key from `.env` (`search.list` with `type=video` and `videoEmbeddable=true`, then `videos.list` for lengths). It drops live streams and returns video IDs for the official player. Nothing from YouTube is downloaded.

## Decks

The booth has two decks, A and B, with one interface (`load`, `play`, `pause`, `stop`, `setLevel`, `setFaderLevel`, `fade`, `currentTime`, `duration`). Each deck has two engines and uses whichever its current track needs (`deck.kind`):

- **File engine:** an `<audio>` element feeding the deck's Web Audio mixer channel.
- **YouTube engine:** the deck's own YouTube IFrame player, in its own slot on the stage (`#youtube-slot-a`, `#youtube-slot-b`).

Every song change loads the other deck (`otherDeck(activeDeck)`), so any two songs overlap: file to file, file to YouTube, or YouTube to YouTube. Levels go to both engines, so a deck keeps its level when it switches between them.

### File engine

Each deck's file engine is a mixer channel:

```text
MediaElementSource -> low shelf (200 Hz) -> peaking (1 kHz) -> high shelf (3.5 kHz)
  -> sweep filter -> deck fader GainNode -> AnalyserNode -> master GainNode -> speakers
                  \-> echo send -> DelayNode <-> feedback ---------^ (skips the fader)
```

The echo send skips the fader, so echoes keep ringing after the fader closes; the Echo out transition uses that.

Tempo is the element's `playbackRate` (±8%). Key lock is `preservesPitch`. A new `src` resets the rate, so `load` puts the deck's tempo back on it. Auto mix sets each new song's tempo explicitly (100%, or the beat-match rate). Manual mix keeps the deck's tempo fader, like a hardware deck. Each deck also keeps the track it holds (`deck.track`) and its hot cue.

The `AnalyserNode` drives the canvas visualizer. It sits before the master gain, so the bars keep moving when the volume is low. Master volume changes ramp with `setTargetAtTime` to avoid clicks. Fades are scheduled on the `AudioContext` clock with `setValueCurveAtTime`, using a smoothstep shape over the crossfade length. Before any direct gain change, `setLevel` clears leftover fade automation, because in Web Audio setting a value inside a scheduled curve's time range throws `NotSupportedError`.

### YouTube engine

- YouTube audio plays inside YouTube's cross-origin player, so it never reaches Web Audio: no analyser (the visualizer shows its idle animation), EQ, filter, tempo, or effects. The mixer greys those controls out on a YouTube deck.
- Its level (fades and crossfader) times the master volume goes to `setVolume` (0–100). Fades step it every 50 ms along the same smoothstep curve.
- A new video starts with `loadVideoById`. Never cue a video and then call `playVideo` right away: YouTube either fails with error 2 or stays cued. `cueVideoById` is only used to show a preview while the booth is paused.
- The player has no `timeupdate` event, so the deck polls it every 500 ms while it plays.
- YouTube's rules forbid covering a player, so `layoutVideos` shows each deck's slot only while it holds a video. One video fills the stage width (up to 70% of the window height). Two (during a crossfade or a manual mix) sit side by side. While any video shows, the stage overlay moves below the videos (`.stage.has-video`).

### Transitions

`runTransition(from, to, seconds)` runs the chosen style once the incoming deck is playing silently, and returns the style it used:

| Style | How it's built |
| --- | --- |
| Crossfade | Smoothstep fade curves on both decks |
| Bass swap | The incoming low shelf starts at −26 dB while its fader rises; at the midpoint both low shelves swap; then the outgoing fader falls |
| Filter sweep | The outgoing filter turns high-pass and ramps exponentially from 30 Hz to 5 kHz; its fader holds, then falls in the last 40% |
| Echo out | The echo delay is set to ¾ beat (feedback 0.55); the send and the dry fader cut together after one beat, so only echoes ring on |
| Brake | The outgoing `playbackRate` falls to 0.25 over 1.4 s with key lock off (pitch drops); then the deck pauses and the incoming one drops in at full level |
| Cut on the beat | Waits for the outgoing song's next beat when its BPM is known, then swaps levels |
| Mix it up | A random pick from the styles that work for these two decks |

Styles that need Web Audio on the outgoing deck (filter, echo, brake) or on both decks (bass swap) fall back to a crossfade when YouTube is involved. Everything is scheduled on the audio clock or driven by elapsed time, never `requestAnimationFrame`: browsers stop animation frames when the tab is hidden or the screen sleeps, which once froze fades halfway and locked out every later transition.

### Platters

Each deck strip has a CSS vinyl platter. It spins at 33⅓ RPM (1.8 s per turn) divided by the deck's tempo, only while the deck plays, and shows the YouTube thumbnail as its label. On a file deck, dragging it bends `playbackRate` by up to ±4% for as long as you hold it, then returns to the deck's tempo: a jog-wheel nudge for lining up beats by ear.

### When something fails

- **Player never gets ready** (no internet, blocked): `withTimeout` gives up after 20 seconds with a message, and the next attempt builds a fresh player.
- **Video doesn't start within 10 seconds**: the transition fails. In an overlap, the old deck keeps playing, the failed deck is stopped, and the booth and Prev point back at the playing track. The failed track keeps its play count, so Auto DJ tries other songs before retrying it.
- **YouTube refuses a video** (`onError`: removed, private, or not allowed outside YouTube): the track is marked `unplayable`, the booth shows why, and Auto DJ and Next skip it from then on.
- **Cue or Play now during a crossfade**: kept in `pendingCue` and played as soon as the crossfade ends, instead of being dropped.

## Auto DJ

With Auto DJ on and at least three tracks loaded, `chooseNextIndex` picks the next track in two steps:

1. Keep only the tracks with the fewest plays this session, so every track plays once before any track repeats.
2. Rank those by this score and take the lowest:

```text
|track energy - energy target| - votes × 8
```

That keeps the room near the current energy mode and lets crowd votes move songs up within a round, without letting two favorites alternate forever.

With Auto DJ off, or with fewer than three tracks, songs play in list order.

Tracks marked `unplayable` are skipped in both modes.

Auto DJ starts the crossfade when the remaining time drops to the crossfade length. In manual mode, the next song starts when the current one ends.

For YouTube tracks, Auto DJ only trusts the player's reported length when it is within 5 seconds of the length search returned. During an ad, the player can report the ad's length, which would otherwise start the next song early.

## Mixing

### BPM detection

`detectBpm` in `public/mixing.js`:

1. Low-pass the audio around 150 Hz to favour kick drums.
2. Measure energy in 5 ms frames, and take the positive jumps between frames as an onset envelope.
3. Autocorrelate the envelope over beat lengths for 80–170 BPM. A gentle preference for tempos near 120 settles half/double-time ambiguity.
4. Refine the peak with a parabola, for tenths of a BPM.
5. Find the beat grid's offset from the first 16 beats.

It returns `{ bpm, firstBeat, confidence }`, or `null` for silence or short clips. Tracks below confidence 2 count as "no steady beat". On synthetic drum loops the tests check tempo within ±0.5 BPM; the beat position lands within about 5 ms.

The booth analyses only what's playing and what's next (`ensureBpm`, one at a time, because decoding a whole song uses a lot of memory). It decodes at 22.05 kHz, listens to one minute starting a quarter of the way in, and saves `bpm` and `firstBeat` with the track's prefs, so each song is analysed once.

### Beat matching

`beatMatchPlan(outDeck, track)` uses `matchRate` to find a playback rate within 8% that matches the outgoing deck's playing BPM, including half and double time. It also picks a start time whose beat phase equals the outgoing deck's. After the incoming deck starts, `alignBeats` corrects the start-up delay with one small seek while the incoming deck is still nearly silent.

In Auto mix, the incoming deck then eases back to 100% over 8 seconds once the fade ends. In Manual mix, tempo stays where Sync or the DJ put it.

### Manual mix

- The crossfader sets both deck faders with an equal-power curve (`crossfaderGains`). It ramps with `setTargetAtTime`, so dragging doesn't click.
- The **live deck** is the crossfader's side, unless only the other deck is playing. `updateLiveDeck` keeps `activeDeck`, `booth.currentIndex`, and `booth.playing` in step, so the stage, the phone, and voice all follow it.
- **Auto fade** starts the far deck (on beat when possible) and moves the crossfader on a 40 ms timer. When it finishes, it pauses the deck that faded out.
- Play, Next, Cue, Play now, and voice requests are routed through `manualToggle` and `manualPlay`. Those load the free deck (file or YouTube) and auto fade. Prev restarts the live deck.
- **Safety net:** with Auto DJ on, if the live deck is about to end and the other deck is idle, the booth runs `manualPlay` on the next song.
- Switching back to Auto mix keeps the live deck and stops the other. Switching is refused during a crossfade.

## Voice Commands

```text
Mac:   Talk button / V key -> SpeechRecognition (en-US, 3 alternatives) -> runVoiceCommand
Phone: keyboard dictation -> voice box -> remote:command {type: "voice", text} -> booth -> runVoiceCommand
```

- **Parsing** lives in `public/voice.js`. `parseVoiceCommand` normalizes the text (case, punctuation, a leading "hey DJ", a trailing "please"), then matches it against an ordered list of patterns. It returns an action such as `{ action: "volume", delta: 15 }` or `{ action: "playSong", query }`, or `null`. It has no side effects, so `npm test` runs it in Node (`test/voice.test.js`).
- **Running** happens only on the booth. `runVoiceCommand` maps each action to the same setters the sliders and phone commands use (`setVolume`, `setEnergy`, `setCrossfade`, `setAutoDj`), or to next, previous, play/pause, and hype. The result goes into the booth message as `Voice: …`, so every phone sees it. The phone that sent the command shows it under its voice box.
- **Song requests** first look in the queue with `findQueuedTrack`. A track matches when at least 75% of the request's words (ignoring filler like "the", "by", "song") appear in its title and artist. The bar is high because a wrong match is worse than falling back to YouTube's top result.
- **Speech recognition** needs a secure page, so the Talk button only appears where `window.isSecureContext` is true and the browser has the Web Speech API. The booth at `localhost` qualifies; a phone on `http://<lan-ip>` does not. That's why the phone uses its keyboard's dictation instead, which works in any text box. When the recognizer offers several transcripts, the first one that parses as a command wins, because recognizers often rank a near miss first.

## Up Next

`booth.upNext` holds track ids someone asked to play next, oldest first. `chooseNextIndex` returns the first playable one before anything else, so Next, Auto DJ, and the Manual mix safety net all honour it. `rememberPlay` drops a track from the list when it becomes current. The phone sees each track's position through `publicTrack().upNext`.

## Sound Check

`soundChecks()` builds the checklist from state the booth already has: the socket, `audioContext.state`, the queue, the master volume, the phone count from `presence`, `sessionInfo` flags (YouTube search on from `/api/session`, a YouTube player reaching PLAYING, a voice command parsed), the screen wake lock (`navigator.wakeLock`, taken again on `visibilitychange` because browsers release it when the page hides), and day-stamped confirmations in local storage. `renderSoundCheck()` runs with every booth render and keeps the button's "n to do" count current.

## Play History

`rememberPlay` records each track that becomes current and increments its play count. Re-cueing the current track does not count twice.

Prev restarts the current song if it is more than 4 seconds in. Otherwise it pops the history and returns to the song that actually played before, without counting a new play.

## State Storage

Local browser storage keeps:

- mix mode (Auto or Manual) and the Beat match setting
- each track's detected BPM and beat offset
- master volume
- energy setting
- crossfade setting
- Auto DJ setting
- per-track energy tags

Energy tags are keyed by track: file name, size, and modified time for local files, or the Internet Archive item and file name for downloads. A tag is saved only when you set one. It is merged into the stored tags, so tags for tracks you did not load this session are kept. Both local files and downloads read their saved tag when they are added to the queue.

Play counts, votes, and play history live in memory and reset when the page reloads.

Playlist files are not stored permanently. You choose them again when you start a new browser session.

## Main Files

`server.js`

- Hosts the app.
- Prints Mac and phone URLs.
- Generates the QR code.
- Searches Internet Archive open audio collections.
- Searches YouTube with the API key from `.env`, so the key never reaches a browser.
- Downloads selected audio files into `music-downloads/`.
- Keeps a small `.music-library.json` manifest.
- Keeps the latest public booth state in memory.
- Relays remote commands.
- Decides who is the booth and who is a paired phone.

`public/app.js`

- Detects Mac booth vs phone remote from URL params.
- Handles file import.
- Handles music search (open audio and YouTube), downloads, and YouTube queueing.
- Controls playback through the deck interface.
- Runs transitions between the two decks, in any of the seven styles.
- Listens for voice commands and runs them (booth), or forwards them (phone).
- Draws the visualizer.
- Renders booth and remote screens.
- Syncs state over Socket.IO.

`public/mixing.js`

- Detects BPM and beat offsets, matches tempos, and shapes the crossfader and filter.

`public/voice.js`

- Parses voice commands and matches song requests against the queue.

`public/styles.css`

- Responsive booth layout.
- Phone remote layout.
- Stage, queue, controls, and visual direction.

## Known Browser Limitation

A remote command from the phone may not be allowed to start audio until the Mac page has received a direct user gesture. Press Play once on the Mac after loading music. This unlocks the audio session for the rest of the party.

YouTube has a second limit: a browser tab that has never been on screen cannot start a video with sound. The video stays "unstarted", and the booth skips it after 10 seconds. Open the booth in a visible window. Once it has been on screen, videos also start while the window is in the background.

## Future Upgrade Ideas

- Loops (4/8/16 beats). Media elements can't seek without a small gap, so loops need an `AudioBufferSourceNode` playback engine with `loopStart`/`loopEnd`.
- Waveform display with the beat grid.
- MIDI DJ controller support (Web MIDI).
- Mixer controls on the phone.
- Hands-free voice with a wake word ("DJ, next"), and French voice commands.
- Saved playlist manifests.
- Guest-only voting links separate from the DJ remote.
- Album art extraction.
- Keyboard shortcuts.
- Lighting bridge for smart bulbs.
