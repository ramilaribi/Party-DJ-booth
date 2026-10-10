# Weekend Runbook

Use this when you are setting up before people arrive.

## One Hour Before

1. Charge the Mac and phone.
2. Connect the Mac to the party speakers.
3. Confirm the playlist files are on the Mac.
4. Put the Mac and phone on the same Wi-Fi.
5. Run:

```bash
npm start
```

6. Open this exact address on the Mac. The booth only runs at `localhost`:

```text
http://localhost:4242
```

7. Load the music folder.
8. Search and download any extra open-audio tracks you want ready.
9. Press Play once on the Mac to unlock browser audio.
10. Scan the QR code with your phone.
11. If you plan to use YouTube, check the terminal says `YouTube search: on`. Queue the YouTube songs you already know you want.
12. Press **Sound check** under the QR code and fix anything that isn't green. Press **Keep awake** there so the Mac doesn't sleep.
13. Check the QR card now shows **Guests** (it switches by itself once your phone is paired). That's the code to share. If you have a TV, press **Show big for guests**.

## Sound Check

Play three kinds of songs:

- A warmup song.
- A peak song.
- A late-night song.

Check:

- Speaker volume is strong but not distorted.
- Next and previous work from the phone's bottom bar, and each tap flashes.
- The phone's energy presets (Warmup, Groove, Peak) move the booth's energy.
- Crossfade works.
- Crossfade still works with the booth hidden: put another window in front during a fade and listen for the next song coming in.
- The QR code opens the remote.
- Find **Get music back** on the Mac and the phone. Press it once while music plays: it should say the booth is playing fine.
- A second phone scans the **Guests** code, can vote, and its song request shows up in **Song requests** on the Mac.
- A YouTube song plays with sound, and crossfades in and out of one of your own files.
- The Mixer shows a BPM for the playing song and the next one. A Next between two dance tracks should sound beat-matched.
- Try two or three Transition styles with **Mix next**, so you know which ones suit your music.
- Voice works: press V on the Mac and say "next". Allow the microphone if the browser asks. On the phone, try "louder" with the keyboard mic.
- YouTube volume sits close to your files. If YouTube is much louder or quieter, adjust the Mac volume for the mix you'll play most.
- The Mac does not sleep.

Recommended Mac settings:

- Turn off sleep while plugged in.
- Turn off notifications or use Focus mode.
- Keep the browser in full screen.
- Keep the server terminal open.

## During The Party

Start around energy 40-55. Move toward 75-90 when people are dancing.

Use Auto DJ when the room is moving well. It plays every track once before repeating, so load enough music to cover the night.

Use **Play now** from the phone when a specific song should play right now. It crossfades straight into that song. Use **Play next** when it should come right after the current song instead.

Leave the booth on Auto mix with Beat match on for most of the night. Pick a Transition style that suits the room: Crossfade or Bass swap while people dance, Echo out or Brake for a dramatic change, Mix it up for variety. Switch to Manual mix when you want to play DJ: load the next song on the free deck with its A or B button, press Sync (two files), and bring it in with the crossfader. Keep Auto DJ flow on, so if you get distracted the booth fades to the next song by itself before the live deck runs out.

Before the party, queue a few styles in one go: search "raï" or an artist and press **Add all**, or paste a YouTube playlist link into the YouTube search to import it.

Use voice when your hands are busy: "next", "louder", "more energy", or "play" and a song name. Speak close to the microphone. A loud room makes the Mac's built-in mic guess wrong, and the phone's keyboard mic held near your mouth works better.

Use votes as a signal, not a command. If a song gets votes but would kill the room, leave it for later.

Check **Song requests** on the Mac or your phone now and then. A request that's already in your queue has **Play next**; for the rest, **Search** finds it. Press **Done** when you've dealt with one. If requests get silly, turn off **Take song requests**. Guests can still vote.

If someone asks for a song you do not have, use Find Music. Open audio searches legal collections and saves matching downloads on the Mac. YouTube finds almost anything and plays it on the booth right away, but it needs internet and can show ads.

## Recovery Moves

If audio stops:

1. Press **Get music back** on the Mac or your phone, and read what it says. If the button is pulsing, the booth already noticed the song stopped moving.
2. If it asks you to click the booth page or bring the booth window to the front, do that, then press it again.
3. If it says the booth is playing fine, the problem is outside the browser: check the Mac's volume, the speaker cable or Bluetooth, and System Settings > Sound > Output.
4. Last resort: refresh the Mac page and load the playlist again.

If a YouTube song won't play:

1. The booth skips it by itself and shows why (removed, private, or not allowed outside YouTube).
2. If no YouTube song starts at all, check the internet connection, and make sure the booth window has been on screen since you opened it.
3. If search says the daily limit is used up, use Open audio or your own files until midnight Pacific time.

If the phone remote disconnects:

The banner at the top of the phone says why: **Reconnecting** (Wi-Fi), **The booth isn't open** (the Mac page closed), or **This link is out of date** (server restarted). Taps aren't sent while it shows, so nothing fires late.

1. Keep music playing on the Mac.
2. Re-scan the QR code. After a server restart this is required, because the session code in the link changes. Guests need to scan the new **Guests** code too.
3. Check same Wi-Fi.

If Wi-Fi blocks the phone:

1. Use your phone hotspot.
2. Connect the Mac to that hotspot.
3. Restart the app and scan the new QR code.

## Best Default Settings

- Energy: 52 for early party.
- Energy: 78 for dancing.
- Crossfade: 5 seconds.
- Auto DJ: on.

## Nice Extra Setup

If you have a TV or projector, mirror or extend the Mac screen and put the booth in full screen. The canvas visualizer is made to look good at a distance.
