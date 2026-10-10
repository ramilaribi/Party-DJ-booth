# Party DJ Booth

Party DJ Booth is a local web app for a house party setup:

- Your Mac is the main music player and visual booth.
- Your phone is the DJ remote, paired by scanning a QR code.
- Your playlist stays local on the Mac.
- Friends can use the phone view to vote or cue songs if you let them hold the remote.

The app does not upload your music anywhere. The browser reads the audio files you choose during the session. Search downloads are saved locally on the Mac from open audio sources.

## Requirements

- macOS with a modern browser (Chrome or Safari).
- Node.js 18 or newer (20.12 or newer to read the YouTube key from `.env`).
- Mac and phone on the same Wi-Fi network.
- Optional: a free YouTube Data API key for YouTube search (see [YouTube Search And Play](#youtube-search-and-play)).

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

The QR link carries a session code that pairs your phone with the booth. The code changes every time the server starts, so scan the QR code again after a restart.

> **Important:** press Play on the Mac once after loading music. Browsers require one local click before a page can play audio. After that, the phone remote can control the booth.

## What You Get

The Mac booth has:

- Local music import for audio files and folders.
- Legal music search from open audio collections, with one-click local downloads.
- YouTube search and play through YouTube's official player, with the video on the stage.
- Full-screen style now-playing stage with a canvas party visualizer.
- Real audio playback in the browser.
- Play, pause, previous, next, and hype controls, plus a master volume.
- Voice control: press Talk (or V) and say a command.
- DJ mixer: two decks with spinning platters, bass/mid/treble EQ, a filter sweep, tempo with key lock, automatic BPM detection, Sync, and a hot cue.
- Auto mix with beat-matched transitions, or Manual mix with a crossfader. Both decks play your files or YouTube.
- Seven transition styles: Crossfade, Bass swap, Filter sweep, Echo out, Brake, Cut on the beat, and Mix it up.
- Energy control and an Auto DJ that plays every track before repeating.
- Queue with Play now, Play next, voting, and energy tagging.
- A Sound check that walks you through setup before guests arrive.
- QR code for phone pairing.

The phone remote has:

- Play, pause, previous, next, and hype controls.
- Music search and download to the Mac.
- YouTube search with Play now, Add to queue, Add all, and YouTube playlist import.
- One-tap buttons for recent searches.
- Voice commands through the phone keyboard's dictation key.
- Volume, energy, and crossfade sliders, and the transition style.
- Live now-playing progress.
- Queue browsing with Play now, Play next, and Vote.

## Best Weekend Setup

1. Put the Mac near the speakers.
2. Connect speakers using Bluetooth, USB audio, HDMI, or the headphone output.
3. Start the app with `npm start`.
4. Open `http://localhost:4242` on the Mac.
5. Load the playlist files or folder.
6. Search and download any extra open-audio tracks you want.
7. Press Play on the Mac once.
8. Scan the QR code from your phone.
9. Press **Sound check** (under the QR code) and work through anything that isn't green.
10. Put the Mac browser in full screen.
11. Use the phone as the booth controller.

For a full checklist, see [docs/WEEKEND_RUNBOOK.md](docs/WEEKEND_RUNBOOK.md).

### Sound check

The **Sound check** button under the QR code counts what's left to do, and opens a checklist:

- **Booth and audio:** the booth is connected, audio is unlocked, music is loaded, and the volume is up.
- **Phone:** a phone is paired.
- **Transitions:** you've heard one and they sound right.
- **YouTube:** search is set up, and a YouTube song has played with sound.
- **Voice:** a voice command has worked.
- **Mac:** it stays awake, and notifications are off.

Each row turns green on its own when it's true, and most have a one-click fix: **Unlock audio**, **Set to 80%**, **Show the QR code**, **Mix next**, **Talk**, and **Keep awake**. Keep awake uses the browser's screen wake lock, so the Mac won't sleep while the booth is open. The two rows you confirm yourself (transitions and notifications) stay checked for the rest of the day.

For a working list of future party-experience improvements, see
[docs/EXPERIENCE_UPGRADES.md](docs/EXPERIENCE_UPGRADES.md).

## Search And Download Music

Use the Find Music card on the Mac or phone.

1. Search a song name, artist, or vibe.
2. Pick a result from the open audio collections.
3. Press Download.
4. The file is saved into `music-downloads/`.
5. The downloaded track is added to the live queue.

This feature searches Internet Archive open audio collections such as open source audio, netlabels, and the Live Music Archive. Items marked stream-only are left out, and files larger than 60 MB are skipped. The server only downloads items that this search can return, so other Internet Archive items are refused. It is designed for legal downloadable tracks, not copyrighted commercial music ripping.

## Supported Music

The app accepts common browser-playable audio files:

- MP3
- M4A / AAC
- WAV
- OGG
- FLAC and AIFF, depending on browser support

Apple Music or Spotify streaming playlists cannot be imported directly because those services do not expose raw audio files to a local browser app. Exported or downloaded local files work.

Search quality depends on what the open audio collections contain.

## YouTube Search And Play

Switch the Find Music card to **YouTube** to search YouTube from the Mac or the phone. Each result has **Play now** and **Add to queue**. Videos play through YouTube's official player on the booth stage. Nothing from YouTube is ever downloaded.

Setup, once:

1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable **YouTube Data API v3**.
2. Under **APIs & Services → Credentials**, create an API key. Restricting it to YouTube Data API v3 is recommended.
3. Save it in the project folder (copy `.env.example` to `.env`, or run the command below), then restart the server:

```bash
printf 'YOUTUBE_API_KEY=%s\n' 'PASTE_YOUR_KEY_HERE' > .env
```

The terminal prints `YouTube search: on` when the key is loaded. Reading `.env` needs Node.js 20.12 or newer. On older versions, run `YOUTUBE_API_KEY=... npm start` instead. `.env` is gitignored, and the key stays on the Mac: phones search through the server.

### Adding a whole style or artist (Raï, The Weeknd, …)

- **Search and Add all:** search "raï" or "the weeknd", then press **Add all** at the top of the results to queue all of them at once.
- **Import a playlist:** paste a YouTube playlist link (any link with `list=` in it) into the YouTube search box and press Search. The booth imports up to 100 playable videos. Add all queues them. A playlist costs about 4 searches' worth of quota, against 100 for a single search.
- **Recent searches:** every search you make shows up as a button under the box on that device, so "Raï" or "The Weeknd" is one tap the next time.
- **Your own files:** for the best sound (EQ, beat matching, effects), add MP3s you own with **Choose a music folder**.

Good to know:

- The free quota allows about 100 searches a day.
- YouTube audio plays inside YouTube's player, so YouTube songs get no visualizer bars, EQ, filter, or tempo. The crossfader, volume, and cue still work.
- Crossfades work between any two songs, files or YouTube. Between two YouTube videos, both play side by side on the stage during the mix.
- Ads can appear, and some videos block playback outside YouTube. The booth skips a video that won't play and says why.
- Open the booth in a visible window. Browsers block a video from starting with sound in a tab that has never been on screen.
- If the terminal says `YouTube search: off`, the server didn't find the key. Check `.env` and restart the server.

## Voice Control

Talk to the booth from the Mac or your phone.

**On the Mac:** press **Talk** in the Voice card, or the **V** key, and say a command. The first time, the browser asks for the microphone. Chrome needs an internet connection for speech recognition. Safari uses macOS Dictation, so turn it on in System Settings > Keyboard.

**On the phone:** tap the Voice box, tap the **microphone on your keyboard** (iPhone and Android keyboards both have one), say the command, and tap **Go**. The booth runs it and the answer shows under the box. This uses your phone's own dictation, so it works over the normal Wi-Fi link with no setup.

You can also type any command in either box.

| Say | What happens |
| --- | --- |
| "next", "skip", "go back" | Next or previous song |
| "pause", "stop the music", "play", "resume" | Pause or resume |
| "louder", "quieter", "volume 60", "mute", "unmute" | Master volume |
| "more energy", "calm it down", "energy 75" | Energy target |
| "peak", "groove", "warm up", "afterglow" | Jump to a room mode |
| "hype", "drop the beat" | Hype moment |
| "crossfade 8 seconds", "auto DJ off" | Booth settings |
| "manual mix", "auto mix", "fade" | Mixer mode, and an auto fade in Manual mix |
| "transition echo out", "use the bass swap", "mix it up" | Transition style |
| "play One More Time by Daft Punk" | Plays it now: from the queue if it's there, otherwise YouTube's top result |
| "add Get Lucky to the queue" | Adds YouTube's top result to the queue |
| "play Get Lucky next" | Puts it in Up next, from the queue or YouTube |

Starting with "hey DJ" or ending with "please" is fine. Commands are in English, and the Mac listens in English whatever your system language is.

## DJ Mixing

The Mixer panel under the stage has deck A, deck B, and the controls between them. Either deck can hold one of your files or a YouTube video, and the booth alternates between them, so every song change overlaps two decks.

Files get the full channel: EQ, filter, tempo, BPM, Sync, and beat matching. YouTube's audio stays inside YouTube's player, so a YouTube deck gets the crossfader, volume, platter, and cue. Its strip says "YouTube: volume and crossfader only", and the other controls are greyed out.

### Transitions

Pick a style in the mixer's **Transition** menu (or on the phone), then press **Mix next**. Auto DJ uses the same style when it changes songs by itself. The length is your **Crossfade seconds** setting.

| Style | What you hear | Works with |
| --- | --- | --- |
| Crossfade | One song smoothly replaces the other | Everything |
| Bass swap | The next song comes in without its bass; halfway through the basses swap, so the low end never doubles up | File to file |
| Filter sweep | A high-pass rises through the old song, draining it to a thin hiss while the next one fades in | From a file |
| Echo out | The old song fires a tempo-synced echo and drops out, leaving its echoes ringing over the next one | From a file |
| Brake | The old song slows to a stop like a turntable losing power, then the next song drops in | From a file |
| Cut on the beat | An instant switch, timed to the old song's next beat when its tempo is known | Everything |
| Mix it up | A different style each time, from the ones that work for those two songs | Everything |

If a style needs a file and the outgoing song is on YouTube, the booth uses a crossfade for that change. The mixer shows the last transition it used.

### Auto mix (default)

The booth changes songs for you with your transition style. With **Beat match** on, it lines up the next song's tempo and beats with the current one first. Afterwards it drifts back to the song's own tempo over 8 seconds. Beat matching needs two files whose tempos are within 8% of each other, counting half and double time.

### Manual mix

1. Click **Manual mix**. The crossfader unlocks, and each queue row gets **A** and **B** buttons.
2. Load a song onto the deck the room isn't hearing, with its A or B button.
3. Press that deck's **Play**, and **Sync** to match its tempo and beats to the other deck.
4. Move the **crossfader**, or press **Auto fade** to glide across over your crossfade time.

Next, Cue, Play now, and voice song requests still work. They load the song on the free deck and fade over. With **Auto DJ flow** on, the booth also fades to the next song by itself if the live deck is about to end and the other deck isn't playing, so the music never stops.

### Deck controls

| Control | What it does |
| --- | --- |
| Platter | Spins while the deck plays, faster or slower with the tempo, with the YouTube thumbnail as its label. On a file, drag it right or left to nudge the song ahead or back (±4% while you hold it), to line up beats by ear |
| BPM | Detected automatically the first time a song is loaded or comes up next, then remembered |
| Tempo | ±8%. The readout shows the BPM you're playing at. In Manual mix it stays where you set it when you load the next song; Auto mix plays each song at its own tempo |
| Key lock | Keeps the pitch steady when you change tempo (on by default) |
| High, Mid, Low | EQ from −26 dB (nearly a kill) to +6 dB |
| Filter | Left sweeps a low-pass, right a high-pass, center is open |
| Cue | Click to set a cue point, click again to jump back to it, right-click to clear it |
| Sync | Matches this deck's tempo (and beats, when both play) to the other deck |

Double-click any slider to put it back in the middle.

BPM detection works best on music with a steady beat, which covers most dance music. Songs without a clear beat show "no steady beat" and simply aren't beat-matched.

## Party Controls

### Volume

The master volume slider (Mac and phone) sets the level for both your files and YouTube. It's saved on the Mac. Use it together with the Mac's own volume: keep the Mac fairly high and ride the booth slider during the party.

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

### Next, Prev, Play now, and Play next

- **Next** skips to the upcoming song shown under *Next* on the booth, with your transition.
- **Prev** restarts the current song if it is more than 4 seconds in. Otherwise it goes back to the song that actually played before.
- **Play now** (queue rows and search results) switches to that song right away.
- **Play next** puts the song right after the current one without interrupting it. Requests line up in the order they were asked for, marked "Up next", "Up next #2", and so on, and they come before Auto DJ's own picks. Press **Cancel next** to take one off. Voice works too: "play Get Lucky next".

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
- Use the exact phone link shown under the QR code. It includes the session code.
- If the phone says **Scan the QR code again**, the server was restarted and the code changed. Scan the new QR code on the Mac.
- Keep the server terminal open.
- If macOS asks about accepting network connections, allow it.
- If hotel, venue, or guest Wi-Fi blocks device-to-device traffic, use a personal hotspot or your own router.

## Network Safety

- **Phones need the QR code.** The remote link carries a random session code. Devices on the Wi-Fi without it cannot control the booth, search, download, or read your downloaded files.
- **The booth only runs on the Mac.** Open it at `http://localhost:4242`. Opening the booth from another device, or through the Mac's network address, shows **Open the booth on the Mac**.
- **Only the booth sets what is playing.** Phones send commands such as Next or Vote, and the booth decides.
- **Other websites are shut out.** A web page open in the Mac's browser cannot connect to the booth or read the session code.
- **Your YouTube key stays on the Mac.** Phones and the booth page search through the server, so the key never reaches a browser.

Anyone you give the QR code or link to can control the booth until the server restarts. Run the booth on your own network or a personal hotspot, not on shared public Wi-Fi.

## Development

| Command         | What it does                               |
| --------------- | ------------------------------------------ |
| `npm start`     | Runs the server on port 4242.              |
| `npm run dev`   | Runs the server and restarts on changes.   |
| `npm run check` | Syntax-checks the server and browser code. |
| `npm test`      | Runs the voice and mixing tests.           |

Use another port with `PORT=5000 npm start`.

## Files

```text
server.js                 Local web server, phone sync, search and download API
public/index.html         Booth and remote markup
public/styles.css         Visual design and responsive layout
public/app.js             Player, queue, mixer, Auto DJ, visualizer, voice, remote logic
public/mixing.js          BPM detection, beat matching, crossfader and filter curves
public/voice.js           Voice command parser and song matching
test/mixing.test.js       Tests for the mixing maths and BPM detection
test/voice.test.js        Tests for the voice command parser
docs/WEEKEND_RUNBOOK.md   Practical party checklist
docs/ARCHITECTURE.md      Technical structure
PROJECT_HANDOFF.md        Project status, known issues, and next steps
.env.example              Template for .env (YouTube API key)
```

Downloaded tracks (`music-downloads/`), their manifest (`.music-library.json`), and your `.env` stay on the Mac and are not committed.

## Stop the App

In the terminal running the app, press:

```text
Control+C
```
