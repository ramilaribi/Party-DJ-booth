# Party DJ Booth - Project Handoff

## Project Summary

Party DJ Booth is a local-first party music web app built for one personal setup:

- Mac browser acts as the main DJ booth and audio player.
- Phone browser acts as the remote controller.
- Music files stay local on the Mac.
- The app can search legal open-audio sources and download tracks locally into the project.
- The experience is designed as a premium private party control room, not a public streaming platform.

Repository:

```text
https://github.com/ramilaribi/Party-DJ-booth   (public, branch main)
```

Local checkout:

```text
/Users/macbook/Desktop/party-dj-booth
```

Current local app URL:

```text
http://localhost:4242
```

Current phone remote URL format:

```text
http://<mac-lan-ip>:4242/?remote=1&session=<code>
```

The session code is random and changes every time the server starts. The QR code on the booth and the terminal output always show the current link.

## Current Status

Built and verified:

- Local web server with Express.
- Socket.IO realtime sync between Mac and phone.
- QR code for phone remote pairing.
- Local file and folder audio import.
- Browser audio playback with two-deck crossfade.
- Canvas visualizer.
- Queue management.
- Phone remote controls.
- Energy slider and Auto DJ flow.
- Search and local download from open audio collections.
- Private club-style UI redesign.
- Documentation and weekend runbook.

Validation already run:

- `npm run check`
- API session smoke test
- Search endpoint smoke test
- Socket.IO remote-control sync test
- Duplicate HTML ID check
- JS selector check
- Live server CSS/HTML smoke checks

Fixed on 2026-10-09:

- **Auto DJ repeated two songs.** It only excluded the current track, so with similar energy tags it alternated between the same two songs forever. Tracks now count their plays, and Auto DJ picks from the least-played ones, so every track plays once before any repeats. Prev now uses the real play history instead of list order.
- **Crossfades froze in hidden tabs.** Fades ran on `requestAnimationFrame`, which stops when the tab is hidden or the screen sleeps. The booth then went silent and ignored Next. Fades are now scheduled on the `AudioContext` clock.
- **Energy tags were wiped.** Saving a tag rewrote the stored tags from only the tracks loaded that session, and downloaded tracks never read their saved tag. `saveTrackPrefs` now merges one track's tag into what is stored, and downloads read their tag on load.
- **Phone count drifted after reconnects.** Clients registered once at page load, and the server kept running totals. Clients now declare their role in the Socket.IO handshake, which is resent on every reconnect, and the server counts live connections instead.
- **Session code was never checked.** Any device on the Wi-Fi could control the booth, search, download, and read the session code from `/api/session`. Phones now need the code from the QR link, and the booth must be a browser on the Mac at `localhost`. The code is now 6 random bytes from `crypto` instead of `Math.random`.
- **Any socket could overwrite party state.** Only the booth may send `display:state` now. The permissive Socket.IO CORS setting is gone, and every handshake and API call must come from the same origin, so other websites open in the Mac's browser cannot connect. A `Host` check also stops DNS-rebinding pages from posing as the booth.
- **Downloads ignored the open-audio boundary.** `/api/download` accepted any Internet Archive item. It now runs the same filtered search as the search box and refuses anything not found. Stream-only items are excluded from both, and the search text is wrapped in parentheses. Note: the "OR escapes the filter" risk from the code review did not reproduce, because the Internet Archive search kept the filter applied, so the parentheses are a safeguard rather than a fix.

How the fixes were verified:

- Every bug was reproduced first on the code before its fix, in a separate test copy with six silent test tracks.
- With animation frames disabled for the whole run, Auto DJ played all six tracks in a full round and started a second one.
- Prev stepped back through the real play history.
- Instant cuts worked at crossfade 0.
- An offline Web Audio render confirmed the fade curves and final gains.
- A tag on a downloaded track survived a reload, and survived a session where that track was not loaded.
- After a server restart, the booth showed the right phone count as phones joined and left. A scripted client also confirmed that repeat registration and a dropped connection count correctly.
- A scripted security test plays the booth, a paired phone, an unpaired Wi-Fi device (connecting through the Mac's network address), and a malicious web page (foreign `Origin`, spoofed `Host`). On the old code 10 of 16 checks failed, and the old server downloaded a LibriVox audiobook from outside the open collections. On the new code all 20 checks pass, including refusing a stream-only item and a 78rpm record, while a paired phone can still search and download open audio.
- In the browser, the booth at `localhost` connected and showed a QR link with the code, and a remote page linked, searched, and sent Hype.

Not verified yet:

- Real music on real speakers. Do the hidden-window crossfade check in [docs/WEEKEND_RUNBOOK.md](docs/WEEKEND_RUNBOOK.md) before the party.
- A real phone scanning the QR code. The in-app browser used for testing would not open the Mac's network address, so the phone-side "Scan the QR code again" message was only checked by the scripted test, not on screen.

## Known Issues

Found in the 2026-10-09 code review and not fixed yet, most important first:

1. **Cue plays immediately.** It jumps to the song instead of queueing it next. The docs now describe this behavior; decide whether a real "play next" action is wanted.
2. **Large libraries are slow.** Each imported file triggers a full queue re-render and a full playlist broadcast. The whole playlist is also resent every 700 ms.
3. **Two booth tabs both play.** Every remote command reaches every open booth tab.
4. **Remote sliders jump while dragging.** Incoming state resets the phone's slider values mid-drag.
5. **Download leftovers.** A failed download leaves a `.download` temp file. Parallel downloads of the same file share one temp path.
6. **Pairing ends when the server restarts.** The session code is regenerated on every start, so phones must scan the QR code again. This is safer, but an installed PWA would need a way to keep or renew pairing.

## Important Boundary

The app must not become a copyrighted music ripper.

The current search/download feature is intentionally scoped to legal open-audio sources such as Internet Archive open audio collections. Commercial music from Spotify, Apple Music, YouTube, SoundCloud, etc. should not be downloaded unless an official licensed API or user-owned local file flow is added.

The server enforces this on both search and download (see the Open-Audio Boundary section in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)). One caveat: `opensource_audio` (Community Audio) is user-uploaded and not rights-checked by the Internet Archive. Netlabels and the Live Music Archive are curated. Decide whether Community Audio should stay in the filter or be limited to items with a license URL.

## How To Run

Requires Node.js 18 or newer.

```bash
git clone https://github.com/ramilaribi/Party-DJ-booth.git
cd Party-DJ-booth
npm install
npm start
```

The existing local checkout is at `/Users/macbook/Desktop/party-dj-booth`.

Then open:

```text
http://localhost:4242
```

The terminal prints the phone remote URL using the Mac LAN IP.

## Key Files

```text
server.js
```

Local server, QR session endpoint, Socket.IO relay, search API, download API, local music serving.

```text
public/index.html
```

Single-page app markup for both Mac booth and phone remote.

```text
public/styles.css
```

Full visual design, desktop booth layout, mobile remote layout, responsive behavior.

```text
public/app.js
```

Client logic for booth/remote mode, playlist loading, audio playback, crossfade, queue rendering, visualizer, remote commands, search, and download actions.

```text
music-downloads/
```

Local folder where downloaded open-audio tracks are saved. It is ignored by git.

```text
.music-library.json
```

Local manifest for downloaded tracks. It is ignored by git.

## Phone App / QR Download Idea

The current QR code opens the phone remote in the browser. It is not a native phone app yet.

The best next step is to make the phone remote a PWA, not a native app. A PWA can be opened from a QR code and installed to the phone home screen:

- QR 1: opens the live controller for the current party session.
- QR 2: opens an install page for the phone app/PWA.

Recommended future behavior:

1. Mac booth shows two QR codes:
   - `Controller QR`
   - `Install Phone App QR`
2. Controller QR opens:

```text
http://<mac-lan-ip>:4242/?remote=1&session=<code>
```

3. Install QR opens:

```text
http://<mac-lan-ip>:4242/install
```

4. `/install` explains:
   - On iPhone: Share -> Add to Home Screen.
   - On Android: browser install prompt or Add to Home screen.
5. The installed PWA still needs the Mac server running on the same Wi-Fi to control the booth.

Important limitation:

- iPhone cannot install a native app directly from a QR code unless it goes through the App Store, TestFlight, enterprise MDM, or Apple-approved distribution.
- Android can install APKs from a QR link, but that creates security and trust friction.
- PWA is the safest and fastest route for this project.

## Recommended Next Dev Task

The network-safety issues from the code review are fixed.

On 2026-10-09 the owner asked for bigger features: YouTube search and playback, DJ mixing, and voice control. Their scope and order are still being agreed, so check with the owner before starting. Downloading from YouTube stays out of scope under the Important Boundary above.

The earlier plan was a PWA install mode:

- Add `public/manifest.webmanifest`.
- Add app icons.
- Add a lightweight service worker for shell caching.
- Add `/install` route or install overlay.
- Add second QR code in the Mac booth for install.
- Keep the existing controller QR unchanged.
- Make the PWA name something personal, for example `Brama Booth`.

Acceptance criteria:

- QR controller still opens the remote immediately.
- QR install page is readable on iPhone and Android.
- App can be added to home screen.
- Installed PWA opens directly into remote mode when the Mac server is available.
- If Mac server is unavailable, the installed app shows a clear reconnect state.

## Privacy / Visibility Requirement

User requested:

```text
Save the project, but do not make it available for all users and sessions on this Mac.
Make it visible only for team/dev Brama.
```

Current state:

- The source code was pushed to a **public** GitHub repository on 2026-10-09 at the owner's request: <https://github.com/ramilaribi/Party-DJ-booth>.
- Downloaded music (`music-downloads/`) and its manifest (`.music-library.json`) are gitignored and stay on the Mac.
- The local checkout is at `/Users/macbook/Desktop/party-dj-booth`, inside the owner's private Desktop folder.
- The app itself still runs only on the local network; nothing is deployed to a server.

Recommended access policy:

- Keep downloaded music ignored and local.
- Do not deploy the app to a public server.
- To limit the code to the Brama team, make the repository private and add team members as collaborators:

```bash
gh repo edit ramilaribi/Party-DJ-booth --visibility private --accept-visibility-change-consequences
```

- If a real `brama` macOS group exists, assign the local checkout to that group and use group-only permissions.
- If no group exists, keep handoff files private to the current macOS user.

Suggested macOS permission model for a real team group:

```bash
chgrp -R brama /Users/macbook/Desktop/party-dj-booth
chmod -R o-rwx /Users/macbook/Desktop/party-dj-booth
chmod -R g+rwX /Users/macbook/Desktop/party-dj-booth
```

Do not run this unless the `brama` group exists and is the intended team group.

## Current Open Questions

- Should the GitHub repository stay public, or become private for the Brama team?
- Is `Brama` an actual macOS group, a company/team name, or a project label?
- Should the future PWA be named `Brama Booth`, `Party DJ Booth`, or something more personal?
- Should guests ever get a vote-only page separate from the DJ remote?

## Handoff Note

Do not change the core direction unless the owner asks:

This is a private local party booth for one person’s Mac and phone, not a public SaaS music product.
