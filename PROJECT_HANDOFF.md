# Party DJ Booth - Project Handoff

## Project Summary

Party DJ Booth is a local-first party music web app built for one personal setup:

- Mac browser acts as the main DJ booth and audio player.
- Phone browser acts as the remote controller.
- Music files stay local on the Mac.
- The app can search legal open-audio sources and download tracks locally into the project.
- The experience is designed as a premium private party control room, not a public streaming platform.

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

## Important Boundary

The app must not become a copyrighted music ripper.

The current search/download feature is intentionally scoped to legal open-audio sources such as Internet Archive open audio collections. Commercial music from Spotify, Apple Music, YouTube, SoundCloud, etc. should not be downloaded unless an official licensed API or user-owned local file flow is added.

## How To Run

From the project folder:

```bash
cd /Users/macbook/Documents/Codex/2026-10-09/can-x20/outputs/party-dj-booth
npm install
npm start
```

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

Build a PWA install mode:

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

Current local state:

- The project is local only.
- It has not been published.
- It is saved under:

```text
/Users/macbook/Documents/Codex/2026-10-09/can-x20/outputs/party-dj-booth
```

Recommended access policy:

- Do not deploy publicly.
- Do not move into a shared public folder.
- Keep downloaded music ignored and local.
- If a real `brama` macOS group exists, assign the project to that group and use group-only permissions.
- If no group exists, keep handoff files private to the current macOS user.

Suggested macOS permission model for a real team group:

```bash
chgrp -R brama /Users/macbook/Documents/Codex/2026-10-09/can-x20/outputs/party-dj-booth
chmod -R o-rwx /Users/macbook/Documents/Codex/2026-10-09/can-x20/outputs/party-dj-booth
chmod -R g+rwX /Users/macbook/Documents/Codex/2026-10-09/can-x20/outputs/party-dj-booth
```

Do not run this unless the `brama` group exists and is the intended team group.

## Current Open Questions

- Is `Brama` an actual macOS group, a company/team name, or a project label?
- Should the future PWA be named `Brama Booth`, `Party DJ Booth`, or something more personal?
- Should guests ever get a vote-only page separate from the DJ remote?

## Handoff Note

Do not change the core direction unless the owner asks:

This is a private local party booth for one person’s Mac and phone, not a public SaaS music product.
