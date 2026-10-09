# Party DJ Booth

Party DJ Booth is a local web app for a house party setup:

- Your Mac is the main music player and visual booth.
- Your phone is the DJ remote, paired by scanning a QR code.
- Your playlist stays local on the Mac.
- Friends can use the phone view to vote or cue songs if you let them hold the remote.

The app does not upload your music anywhere. The browser reads the audio files you choose during the session. Search downloads are saved locally on the Mac from open audio sources.

## Requirements

- macOS with a modern browser (Chrome or Safari).
- Node.js 18 or newer.
- Mac and phone on the same Wi-Fi network.

## Quick Start

```bash
git clone https://github.com/ramilaribi/Party-DJ-booth.git
cd Party-DJ-booth
npm install
npm start
```

Open the Mac player:

```text
http://localhost:4242
```

On the Mac screen, choose your audio files or a music folder. Then scan the QR code with your phone while both devices are on the same Wi-Fi.

> **Important:** press Play on the Mac once after loading music. Browsers require one local click before a page can play audio. After that, the phone remote can control the booth.

## What You Get

The Mac booth has:

- Local music import for audio files and folders.
- Legal music search from open audio collections, with one-click local downloads.
- Full-screen style now-playing stage with a canvas party visualizer.
- Real audio playback in the browser.
- Play, pause, previous, next, and hype controls.
- Two-deck crossfade between tracks.
- Energy control and an Auto DJ that plays every track before repeating.
- Queue with cue, vote, and energy tagging.
- QR code for phone pairing.

The phone remote has:

- Play, pause, previous, next, and hype controls.
- Music search and download to the Mac.
- Energy and crossfade sliders.
- Live now-playing progress.
- Queue browsing with cue and vote actions.

## Best Weekend Setup

1. Put the Mac near the speakers.
2. Connect speakers using Bluetooth, USB audio, HDMI, or the headphone output.
3. Start the app with `npm start`.
4. Open `http://localhost:4242` on the Mac.
5. Load the playlist files or folder.
6. Search and download any extra open-audio tracks you want.
7. Press Play on the Mac once.
8. Scan the QR code from your phone.
9. Put the Mac browser in full screen.
10. Use the phone as the booth controller.

For a full checklist, see [docs/WEEKEND_RUNBOOK.md](docs/WEEKEND_RUNBOOK.md).

## Search And Download Music

Use the Find Music card on the Mac or phone.

1. Search a song name, artist, or vibe.
2. Pick a result from the open audio collections.
3. Press Download.
4. The file is saved into `music-downloads/`.
5. The downloaded track is added to the live queue.

This feature searches Internet Archive open audio collections such as open source audio, netlabels, and the Live Music Archive. Files larger than 60 MB are skipped. It is designed for legal downloadable tracks, not copyrighted commercial music ripping.

## Supported Music

The app accepts common browser-playable audio files:

- MP3
- M4A / AAC
- WAV
- OGG
- FLAC and AIFF, depending on browser support

Apple Music or Spotify streaming playlists cannot be imported directly because those services do not expose raw audio files to a local browser app. Exported or downloaded local files work.

Search quality depends on what the open audio collections contain.

## Party Controls

### Energy

| Range  | Room mode |
| ------ | --------- |
| 0–27   | Afterglow |
| 28–47  | Warmup    |
| 48–71  | Groove    |
| 72–100 | Peak      |

Each track gets an energy guess from its file name. Words like *remix*, *club*, or *house* suggest Peak (82). Words like *chill*, *acoustic*, or *intro* suggest Warmup (32). Everything else starts at 55. Use the Warm, Groove, and Peak buttons in the queue to correct a track. Your tags are remembered in this browser on the Mac, for both local files and downloads.

### Auto DJ

With Auto DJ on and at least three tracks loaded:

- Every track plays once before any track repeats.
- Within that round, the next song is the closest match to the energy target, and each crowd vote moves a song up.
- The crossfade starts automatically before the current song ends.

With Auto DJ off, songs play in list order and cut over when each song ends.

### Next, Prev, and Cue

- **Next** skips to the upcoming song shown under *Next* on the booth, with a crossfade.
- **Prev** restarts the current song if it is more than 4 seconds in. Otherwise it goes back to the song that actually played before.
- **Cue** switches to the chosen song right away, crossfading into it if music is playing.

### Crossfade

- 0 seconds means instant cuts.
- 4–7 seconds is good for most parties.
- 8–12 seconds is smoother for warmup and late-night sets.

Crossfades run on the browser's audio clock, so they still finish if the booth window is hidden or the screen sleeps.

### Hype

- Creates a 7-second visual hit on the Mac screen.
- Useful before a chorus, drop, or room reset.

## Phone Cannot Connect

Try these checks:

- Make sure phone and Mac are on the same Wi-Fi.
- Use the exact phone link shown under the QR code.
- Keep the server terminal open.
- If macOS asks about accepting network connections, allow it.
- If hotel, venue, or guest Wi-Fi blocks device-to-device traffic, use a personal hotspot or your own router.

## Network Safety

The phone remote has no password. Anyone on the same Wi-Fi who opens the remote link can control the booth and trigger downloads. Run the booth on your own network or a personal hotspot, not on shared public Wi-Fi.

## Development

| Command         | What it does                               |
| --------------- | ------------------------------------------ |
| `npm start`     | Runs the server on port 4242.              |
| `npm run dev`   | Runs the server and restarts on changes.   |
| `npm run check` | Syntax-checks `server.js` and `app.js`.    |

Use another port with `PORT=5000 npm start`.

## Files

```text
server.js                 Local web server, phone sync, search and download API
public/index.html         Booth and remote markup
public/styles.css         Visual design and responsive layout
public/app.js             Player, queue, crossfade, Auto DJ, visualizer, remote logic
docs/WEEKEND_RUNBOOK.md   Practical party checklist
docs/ARCHITECTURE.md      Technical structure
PROJECT_HANDOFF.md        Project status, known issues, and next steps
```

Downloaded tracks (`music-downloads/`) and their manifest (`.music-library.json`) stay on the Mac and are not committed.

## Stop the App

In the terminal running the app, press:

```text
Control+C
```
