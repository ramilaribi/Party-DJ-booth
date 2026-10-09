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

1. Mac opens `/`.
2. Phone opens `/?remote=1`.
3. Both connect to Socket.IO.
4. Mac registers as `display`.
5. Phone registers as `remote`.
6. Mac broadcasts state with `display:state`.
7. Phone sends commands with `remote:command`.
8. Server broadcasts commands as `player:command`.
9. Mac handles commands and rebroadcasts updated state.

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
