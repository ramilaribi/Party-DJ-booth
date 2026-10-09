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

Mac browser
  public/app.js
    local audio file import
    Web Audio graph
    two-deck crossfade
    visualizer canvas
    queue state
    remote command handler

Phone browser
  public/app.js
    remote UI
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

## Audio Graph

The Mac uses two audio elements:

- Deck A
- Deck B

When crossfading:

1. Current deck continues playing.
2. Next deck loads the target song.
3. Next deck starts at volume 0.
4. Both gain curves are scheduled on the `AudioContext` clock with `setValueCurveAtTime`, using a smoothstep shape over the crossfade length.
5. A timer fires when the fade ends, pins the final gains, and stops the old deck.
6. Active deck switches.

The fade runs on the audio clock instead of `requestAnimationFrame`. Browsers stop animation frames when the tab is hidden or the screen sleeps, which used to freeze the fade halfway and lock out every later transition.

Every direct gain change goes through `setDeckGain`, which clears leftover fade automation first. In Web Audio, setting a value inside a scheduled curve's time range throws `NotSupportedError`.

Both decks route through:

```text
MediaElementSource -> GainNode -> AnalyserNode -> speakers
```

The `AnalyserNode` drives the canvas visualizer.

## Auto DJ

With Auto DJ on and at least three tracks loaded, `chooseNextIndex` picks the next track in two steps:

1. Keep only the tracks with the fewest plays this session, so every track plays once before any track repeats.
2. Rank those by this score and take the lowest:

```text
|track energy - energy target| - votes × 8
```

That keeps the room near the current energy mode and lets crowd votes move songs up within a round, without letting two favorites alternate forever.

With Auto DJ off, or with fewer than three tracks, songs play in list order.

Auto DJ starts the crossfade when the remaining time drops to the crossfade length. In manual mode, the next song starts when the current one ends.

## Play History

`rememberPlay` records each track that becomes current and increments its play count. Re-cueing the current track does not count twice.

Prev restarts the current song if it is more than 4 seconds in. Otherwise it pops the history and returns to the song that actually played before, without counting a new play.

## State Storage

Local browser storage keeps:

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
- Downloads selected audio files into `music-downloads/`.
- Keeps a small `.music-library.json` manifest.
- Keeps the latest public booth state in memory.
- Relays remote commands.
- Decides who is the booth and who is a paired phone.

`public/app.js`

- Detects Mac booth vs phone remote from URL params.
- Handles file import.
- Handles music search and download actions.
- Controls playback.
- Runs crossfades.
- Draws the visualizer.
- Renders booth and remote screens.
- Syncs state over Socket.IO.

`public/styles.css`

- Responsive booth layout.
- Phone remote layout.
- Stage, queue, controls, and visual direction.

## Known Browser Limitation

A remote command from the phone may not be allowed to start audio until the Mac page has received a direct user gesture. Press Play once on the Mac after loading music. This unlocks the audio session for the rest of the party.

## Future Upgrade Ideas

- Beat detection and BPM-aware mixing.
- Saved playlist manifests.
- Guest-only voting links separate from the DJ remote.
- Album art extraction.
- Keyboard shortcuts.
- Lighting bridge for smart bulbs.
