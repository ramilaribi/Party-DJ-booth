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
    master volume
    voice commands (Web Speech API, push-to-talk)
    visualizer canvas
    queue state
    remote command handler

  public/voice.js
    voice command parser and song matching (pure, unit-tested)

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
| `GET /api/youtube/search` | yes | yes | no |
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

The booth has three decks with the same interface (`load`, `play`, `pause`, `stop`, `setLevel`, `fade`, `currentTime`, `duration`):

- **Deck A** and **Deck B**: `<audio>` elements for local files and downloads.
- **YouTube**: one YouTube IFrame player, shown at the top of the stage while it holds a video.

`deckFor(track)` picks the YouTube deck for YouTube tracks, and otherwise the audio deck that isn't playing, so the two can overlap.

### Audio decks

Both route through:

```text
MediaElementSource -> deck GainNode -> AnalyserNode -> master GainNode -> speakers
```

The `AnalyserNode` drives the canvas visualizer. It sits before the master gain, so the bars keep moving when the volume is low. Master volume changes ramp with `setTargetAtTime` to avoid clicks. The YouTube deck applies the same master volume by multiplying it into the player volume. Fades are scheduled on the `AudioContext` clock with `setValueCurveAtTime`, using a smoothstep shape over the crossfade length. Before any direct gain change, `setLevel` clears leftover fade automation, because in Web Audio setting a value inside a scheduled curve's time range throws `NotSupportedError`.

### YouTube deck

- YouTube audio plays inside YouTube's cross-origin player, so it never reaches the analyser. The visualizer shows its idle animation while YouTube plays.
- Fades step the player's volume (`setVolume`, 0–100) every 50 ms along the same smoothstep curve.
- A new video starts with `loadVideoById`. Never cue a video and then call `playVideo` right away: YouTube either fails with error 2 or stays cued. `cueVideoById` is only used to show a preview while the booth is paused.
- The player has no `timeupdate` event, so the deck polls it every 500 ms while it plays.
- YouTube's rules forbid covering the player, so while a video shows, the stage overlay moves below it (`.stage.has-video`).

### Transitions

| From → to | How |
| --- | --- |
| Audio → audio | Overlap crossfade on the audio clock |
| Audio ↔ YouTube | Overlap crossfade: audio clock on one side, volume steps on the other |
| YouTube → YouTube | Dip: fade out over half the crossfade, load the next video, fade in over the other half (one player can't overlap two videos) |

A timer, never `requestAnimationFrame`, ends every fade and pins the final levels. Browsers stop animation frames when the tab is hidden or the screen sleeps, which used to freeze fades halfway and lock out every later transition.

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

## Voice Commands

```text
Mac:   Talk button / V key -> SpeechRecognition (en-US, 3 alternatives) -> runVoiceCommand
Phone: keyboard dictation -> voice box -> remote:command {type: "voice", text} -> booth -> runVoiceCommand
```

- **Parsing** lives in `public/voice.js`. `parseVoiceCommand` normalizes the text (case, punctuation, a leading "hey DJ", a trailing "please"), then matches it against an ordered list of patterns. It returns an action such as `{ action: "volume", delta: 15 }` or `{ action: "playSong", query }`, or `null`. It has no side effects, so `npm test` runs it in Node (`test/voice.test.js`).
- **Running** happens only on the booth. `runVoiceCommand` maps each action to the same setters the sliders and phone commands use (`setVolume`, `setEnergy`, `setCrossfade`, `setAutoDj`), or to next, previous, play/pause, and hype. The result goes into the booth message as `Voice: …`, so every phone sees it. The phone that sent the command shows it under its voice box.
- **Song requests** first look in the queue with `findQueuedTrack`. A track matches when at least 75% of the request's words (ignoring filler like "the", "by", "song") appear in its title and artist. The bar is high because a wrong match is worse than falling back to YouTube's top result.
- **Speech recognition** needs a secure page, so the Talk button only appears where `window.isSecureContext` is true and the browser has the Web Speech API. The booth at `localhost` qualifies; a phone on `http://<lan-ip>` does not. That's why the phone uses its keyboard's dictation instead, which works in any text box. When the recognizer offers several transcripts, the first one that parses as a command wins, because recognizers often rank a near miss first.

## Play History

`rememberPlay` records each track that becomes current and increments its play count. Re-cueing the current track does not count twice.

Prev restarts the current song if it is more than 4 seconds in. Otherwise it pops the history and returns to the song that actually played before, without counting a new play.

## State Storage

Local browser storage keeps:

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
- Runs crossfades and YouTube dips.
- Listens for voice commands and runs them (booth), or forwards them (phone).
- Draws the visualizer.
- Renders booth and remote screens.
- Syncs state over Socket.IO.

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

- Beat detection and BPM-aware mixing.
- Hands-free voice with a wake word ("DJ, next"), and French voice commands.
- Saved playlist manifests.
- Guest-only voting links separate from the DJ remote.
- Album art extraction.
- Keyboard shortcuts.
- Lighting bridge for smart bulbs.
