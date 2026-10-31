# Fake Phone (RMT)

A virtual phone for making mock text conversations, calls and voice-overs, exported as vertical MP4 videos.

## Run

Double-click `Fake Phone.bat`, or:

```
node server.js
```

Then open http://localhost:5190. Needs Node 18+ (no npm install). ffmpeg on PATH is used to write the MP4.

## Desktop app (Windows + Mac installers)

- **Windows:** `FakePhone-Setup-<version>.exe` installs Fake Phone as a normal app (Start menu + desktop shortcut, pick the folder, uninstall from Settings > Apps). Not code-signed, so SmartScreen may say "Windows protected your PC": More info > Run anyway.
- **Mac:** `FakePhone-<version>-mac-arm64.dmg` (Apple Silicon, M1 and newer) or `-mac-x64.dmg` (Intel). Drag Fake Phone to Applications. It is ad-hoc signed, not signed with an Apple Developer ID, so the first open is blocked: System Settings > Privacy & Security > Open Anyway (once).

Nothing else to install: Electron, ffmpeg and the fonts are inside.

- Videos go to `Documents/Fake Phone` (Export tab > Change folder… to move them).
- Projects and keys live in the app's user folder (`%APPDATA%\Fake Phone`, `~/Library/Application Support/Fake Phone`), kept on uninstall. They are separate from the browser version's; move a project across with Save / Open project file.
- `desktop.log` in that folder has the start line and any page errors.

### Releases (GitHub builds them)

The repo is private: [trapartzbeats-ai/FakePhone](https://github.com/trapartzbeats-ai/FakePhone). `.github/workflows/build.yml` builds the Mac (arm64 + x64) and Windows installers on GitHub's machines and runs the smoke test on each built app. To release a version: bump `"version"` in `package.json`, commit, then

```
git tag v0.2.0
git push origin main v0.2.0
```

The installers appear under Releases (and as run artifacts). The repo is private, so only people with access to it can download from there: send the .dmg / .exe itself to anyone else. Actions > Build installers > Run workflow builds without a release.

### Build locally

```
npm install
npm run desktop                                # run from source
npm run dist                                   # Windows: dist/FakePhone-Setup-<version>.exe
npm run dist:mac                               # on a Mac: dist/FakePhone-<version>-mac-<arch>.dmg
node tools/desktop-smoke.mjs                   # 20 checks from source (throwaway data in D:\Cache\fakephone-smoke)
node tools/desktop-smoke.mjs "C:\...\Fake Phone.exe"   # the same checks on an installed copy
```

The page loads from `fakephone://app` (a secure origin, so WebCodecs and the mic work, and saved projects keep one origin) and every request is passed to `server.js`, which runs inside the app on a free port. `tools/fetch-fonts.mjs` refreshes the local fonts, `tools/make-icon.py` the installer icon. The bundled ffmpeg (ffmpeg-static, gyan.dev essentials build) is GPL: its license is in `resources/ffmpeg`.

## What it does

- **Chat apps:** iMessage, Text (green), Android Messages, WhatsApp, Instagram DM. Light/dark. iPhone (Dynamic Island / notch) or Android hardware, framed on a background (gradient, color, image or green screen) or full-screen 9:16.
- **Script:** type in the box under the script (Enter adds, Tab switches who is talking), or paste a whole script (see below). Drag lines to reorder; Ctrl+Z/Ctrl+Shift+Z undo/redo (Cmd on a Mac).
- **Animation:** typing bubbles, the keyboard typing your text key by key, type-then-delete hesitation (types a draft, holds delete, types the real line), bubbles popping in, reactions, Delivered/Read (blue ticks / Seen), unsend, timestamps, images and GIFs, big emoji.
- **Send effects:** Slam, Loud, Gentle, Invisible Ink on bubbles; Confetti, Balloons, Fireworks, Love, Lasers, Celebration, Spotlight, Echo over the screen, each with its own sound.
- **Camera:** per message (zoom in on it, punch-in, shake) or as camera beats (zoom that stays and follows the newest bubble, slow push-in, back to full view, shake). Zooms follow their target as the chat scrolls and never crop it; curves come from the Motion tab.
- **Voice notes:** audio bubbles with a waveform drawn from the real audio; theirs play after they land (WhatsApp shows "recording audio…"), yours can be recorded live (recording bar runs while the voice plays) or sent then played.
- **Screens:** chat, messages list with swipe-to-delete, lock screen with notifications, notification banners, incoming/outgoing calls (answered with a running timer and spoken lines, declined, missed).
- **Sound:** synthesized phone sounds (send, receive, notifications, key clicks, ringtone, hang up...), each replaceable with your own file. Background music (Sound tab) fades in/out and dips automatically under every voice.
- **Voices:** per message / call line / voice-over: ElevenLabs AI voice (your key, stored only in this browser), a mic recording (silence trimmed), or an audio file. A whole-video narration take can be recorded over playback. Captions optional.
- **Motion:** every animation runs on a PulseCore curve (`app/js/vendor/pulse`, easing + spring physics); the Motion tab sets the curve and length per animation.
- **Export:** rendered frame by frame (WebCodecs H.264 + an offline audio mix, muxed by ffmpeg) into `exports/` (desktop app: `Documents\Fake Phone`). 1080x1920 or 720x1280, 30/60 fps.
- **Projects** autosave in the browser (IndexedDB). "Save project file" writes one .json with images and audio inside.

## Script format

```
Anthony: Save 10% off a new party at Smith's!
---
me: can i book a party online?
Anthony: Yes! Just follow the link above
me: ~~I can't, I'm sick~~ yeah I'll be there   types the draft, deletes it, sends the rest
me: ~~actually~~                                typed and deleted, never sent
Anthony: 🎤 bring the speaker                    voice note (text = what is said)
Anthony: I GOT THE JOB {slam} {confetti} {zoom}   effects + camera tags after the text
[camera push center 1.3 5]                        zoom|push|reset|shake, on last|typing|header|center, amount, seconds
[shake 2]
[typing 2]            typing bubble that goes away (fake-out)
[pause 1.5]
[read]                Read receipt / blue ticks / Seen
[react heart]         heart like dislike haha !! ? or any emoji
[unsend]
[time Today 9:41 AM]
[notify Mom: did you book it??]
[call in Anthony answer]     in/out, answer/decline/missed
> Anthony: Hey, you there?   lines spoken on the call
> me: yeah what's up
[inbox] [chat] [lock]        change screen
[delete Spam Likely]         swipe to delete in the messages list
narrator: And that's when everything changed...
[sound boom]
```

Lines above `---` are already on screen when the video starts.

## Layout

- `server.js` - static server, ElevenLabs/GIPHY proxy, export muxing (ffmpeg)
- `desktop/main.js` - the Electron app (window, `fakephone://` protocol, bundled ffmpeg, exports folder)
- `app/fonts/` - local copies of Anton, Inter, Roboto, Noto Color Emoji (SIL OFL)
- `app/js/timeline.js` - compiles the script into a timed timeline (everything is a function of time, so scrubbing and export are exact)
- `app/js/render/` - canvas phone renderer (chat, keyboard, screens, compositor)
- `app/js/editor.js`, `panels.js`, `ui.js` - the editor
- `app/js/audio.js`, `voice.js`, `export.js` - sound, voices, video export
- `app/dev/sheet.html` - render sheet for checking looks (`?theme=whatsapp&dark=1&save=name` writes `exports/_dev/name.png`)
