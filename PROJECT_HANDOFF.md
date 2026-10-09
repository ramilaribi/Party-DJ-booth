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
http://<mac-lan-ip>:4242/?remote=1
```

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
- **Phone count drifted after reconnects.** Clients registered once at page load, and the server kept running totals. Clients now register on every connect, and the server counts live connections instead.

How the fixes were verified:

- Every bug was reproduced first on the code before its fix, in a separate test copy with six silent test tracks.
- With animation frames disabled for the whole run, Auto DJ played all six tracks in a full round and started a second one.
- Prev stepped back through the real play history.
- Instant cuts worked at crossfade 0.
- An offline Web Audio render confirmed the fade curves and final gains.
- A tag on a downloaded track survived a reload, and survived a session where that track was not loaded.
- After a server restart, the booth showed the right phone count as phones joined and left. A scripted client also confirmed that repeat registration and a dropped connection count correctly.

Not verified yet: real music on real speakers. Do the hidden-window crossfade check in [docs/WEEKEND_RUNBOOK.md](docs/WEEKEND_RUNBOOK.md) before the party.

## Known Issues

Found in the 2026-10-09 code review and not fixed yet, most important first:

1. **Session code is never checked.** The code in the QR link is generated but not verified, so any device on the Wi-Fi can control the booth and trigger downloads.
2. **Any socket can overwrite party state.** `display:state` is accepted without checking the sender's role, and Socket.IO allows any origin (`cors: { origin: true }`).
3. **Open-audio boundary is not enforced on download.** The search query is not wrapped in parentheses, so words like `OR` can escape the collection filter. `/api/download` accepts any Internet Archive identifier.
4. **Cue plays immediately.** It jumps to the song instead of queueing it next. The docs now describe this behavior; decide whether a real "play next" action is wanted.
5. **Large libraries are slow.** Each imported file triggers a full queue re-render and a full playlist broadcast. The whole playlist is also resent every 700 ms.
6. **Two booth tabs both play.** Every remote command reaches every open booth tab.
7. **Remote sliders jump while dragging.** Incoming state resets the phone's slider values mid-drag.
8. **Download leftovers.** A failed download leaves a `.download` temp file. Parallel downloads of the same file share one temp path.

## Important Boundary

The app must not become a copyrighted music ripper.

The current search/download feature is intentionally scoped to legal open-audio sources such as Internet Archive open audio collections. Commercial music from Spotify, Apple Music, YouTube, SoundCloud, etc. should not be downloaded unless an official licensed API or user-owned local file flow is added.

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
http://<mac-lan-ip>:4242/?remote=1
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

Before new features, fix Known Issues 1–3: who can control the booth and what it can download.

Then build a PWA install mode:

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
