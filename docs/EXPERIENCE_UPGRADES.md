# Experience Upgrade Backlog

Use this as the working list for making Party DJ Booth more useful during a real party. These are product ideas, not committed implementation instructions. Pick one item at a time, define the desired behavior, then build and verify it.

## Recommended Order

1. Preflight / Sound Check Mode (done 2026-10-10)
2. Real Play Next (done 2026-10-10)
3. Guest Vote QR
4. Better Phone Remote
5. Party Recovery Button
6. PWA Install Mode
7. Queue Sections
8. Smart DJ Suggestions
9. Theme / Venue Modes
10. Waveform Preview

## 1. Preflight / Sound Check Mode

**Status: done (2026-10-10).** Built as a Sound check button and checklist dialog; see Sound check in the README.

A guided checklist before guests arrive.

Useful checks:

- Server is running and booth is open at `localhost`.
- Audio has been unlocked with one Mac click.
- At least one track is loaded.
- Phone remote is paired.
- Crossfade works.
- YouTube search is configured, if a key is present.
- YouTube playback starts with sound, if the party will use YouTube.
- Voice command input works.
- Mac sleep and notifications have been considered.

Possible UI:

- A `Sound Check` button near the QR card.
- A modal or side panel with check rows.
- Each check can be automatic where possible, or manually confirmed with a button.

Why it helps:

- Reduces setup mistakes.
- Makes the app safer to rely on before people arrive.

## 2. Real Play Next

**Status: done (2026-10-10).** Play now and Play next on queue rows, search results, the phone, and voice; see the README.

Separate "play this now" from "put this after the current song."

Current behavior:

- `Cue` jumps to the selected song immediately.

Desired behavior:

- `Play now` starts the song immediately.
- `Play next` moves the song to the next slot after the current track.
- `Cue` can either be renamed to `Play now`, or kept only for immediate action.

Why it helps:

- Lets the DJ accept requests without interrupting the current song.
- Makes phone control less risky.

## 3. Guest Vote QR

Add a second QR code for guests with limited permissions.

Desired guest actions:

- See now playing.
- Browse the queue.
- Vote for songs.
- Optionally submit a request.

Guest actions should not include:

- Play / pause.
- Previous / next.
- Hype.
- Volume.
- Energy.
- Crossfade.
- Downloads, unless explicitly allowed.

Possible access model:

- Keep the current QR as the DJ remote.
- Add a guest QR with a different role and token.
- Server and Socket.IO events enforce role permissions.

Why it helps:

- Friends can participate without getting full control of the booth.

## 4. Better Phone Remote

Make the remote feel like a reliable controller under party conditions.

Potential improvements:

- Sticky transport controls.
- Larger now-playing area.
- One-tap energy presets.
- Clear `Play now`, `Play next`, and `Vote` actions.
- Prevent sliders from jumping while the user is dragging.
- Better disconnected / rescan state.
- Larger touch targets for one-handed use.

Why it helps:

- The phone is the main live-control surface once the Mac is in full screen.

## 5. Party Recovery Button

Add one obvious action for getting music back when something goes wrong.

Possible behavior:

- Resume the audio context.
- Re-apply master volume.
- Try to resume the active deck.
- Reconnect or rebuild the YouTube player if needed.
- Show the exact manual next step if the browser blocks playback.

Possible label:

- `Recover Audio`
- `Get Music Back`

Why it helps:

- A party failure should have one visible recovery move, not a debugging session.

## 6. PWA Install Mode

Make the phone remote installable from the browser.

Possible pieces:

- `public/manifest.webmanifest`.
- App icons.
- Lightweight service worker for shell caching.
- `/install` page.
- Second QR code for install instructions.

Important behavior:

- The controller QR should still open the live remote immediately.
- The installed app should explain clearly when the Mac server is unavailable.
- Pairing still depends on the current Mac server session unless a renewal flow is added.

Why it helps:

- Makes the remote feel like a personal phone app without native app distribution.

## 7. Queue Sections

Split the queue into clearer party flow.

Possible sections:

- Now.
- Up next.
- Later.
- Played.

Useful details:

- Show played songs without letting them dominate the live queue.
- Make Auto DJ's next pick easy to understand.
- Keep manual ordering simple.

Why it helps:

- A long single list gets hard to scan during the party.

## 8. Smart DJ Suggestions

Add light guidance without taking control away.

Possible suggestions:

- `Good next match`.
- `Close BPM`.
- `Big energy jump`.
- `Already played recently`.
- `YouTube track: no EQ or visualizer`.
- `Too far for beat match`.

Possible placement:

- Queue row badges.
- A small suggestion line near the mixer.
- Search result hints.

Why it helps:

- Makes the app feel smarter while still staying local-first and predictable.

## 9. Theme / Venue Modes

Add quick visual and energy presets.

Possible modes:

- House Party.
- Club.
- Chill.
- Late Night.

Each mode could change:

- Visualizer intensity.
- Accent colors.
- Default energy.
- Hype style.
- Stage density.

Why it helps:

- Lets the booth fit the room without manual styling changes.

## 10. Waveform Preview

Show a compact waveform and beat grid for local tracks.

Possible scope:

- Start with the active deck and next deck only.
- Reuse decoded audio from BPM analysis where practical.
- Show beat markers when BPM is known.
- Keep YouTube tracks as thumbnail / progress only.

Why it helps:

- Makes manual mixing more useful and more DJ-like.

Risk:

- Higher implementation complexity and memory use than the other items.
- Best saved until the mixer behavior is stable.

