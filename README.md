<p align="center">English | <a href="README.fr.md">Français</a></p>

<p align="center">
  <img src="app/src-tauri/icons/128x128@2x.png" width="112" alt="Bobine Subs icon">
</p>

<h1 align="center">Bobine Subs</h1>

<p align="center">
  <b>Put subtitles back in sync with the ones already in the video</b>: offset, drift and jumps, across languages.
</p>

<p align="center">
  <a href="https://github.com/MarcValat/BobineSubs/releases/latest"><img src="https://img.shields.io/github/v/release/MarcValat/BobineSubs?label=version" alt="Latest version"></a>
  <img src="https://img.shields.io/badge/Windows-10%20%7C%2011%20(x64)-0078D6?logo=windows" alt="Windows 10 | 11 (x64)">
  <img src="https://img.shields.io/badge/Linux-Debian%20%7C%20Ubuntu%20(.deb)-E95420?logo=linux&logoColor=white" alt="Linux: Debian | Ubuntu (.deb)">
  <img src="https://img.shields.io/badge/UI-Fran%C3%A7ais-555" alt="UI: French">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL%20v3-blue" alt="GPL v3 license"></a>
</p>

<p align="center">
  <a href="https://github.com/MarcValat/BobineSubs/releases/latest"><img src="https://img.shields.io/badge/Download-Windows%20%7C%20Linux-2ea44f?style=for-the-badge" alt="Download for Windows or Linux"></a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/main-en-dark.png">
  <img src="docs/screenshots/main-en-light.png" alt="Bobine Subs: a season's episodes on the left; on the right, the offset over time, then the reference's lines and the subtitles' before and after correction">
</picture>

## Why

Subtitles found separately rarely line up with the video: a few tenths of a second early, an offset that slowly **drifts** because they were made for another frame rate (25 fps instead of 23.976), or **jumps** where the video was cut differently (a longer ad break, a missing scene). Fixing them by hand, line after line, takes forever.

But the video often already holds well-timed subtitles, in another language. What they share with the ones to fix isn't the text but the **rhythm**: the same lines appear at the same moments, with the same pauses in between. Bobine Subs compares that rhythm and retimes every line.

## Features

- 🎯 **Finds all three kinds of desync**: constant offset, drift (the usual frame rates: 23.976, 24, 25 fps), jumps, each segment with a confidence score.
- 🌍 **Across languages**: English original against a French dub's subtitles, Japanese against English… only when lines appear matters.
- 💿 **Any reference**: SRT and ASS, but also Blu-ray (PGS) and DVD (VobSub) image subtitles, of which only the timing is read.
- 👀 **Check before exporting**: the offset curve, and a loupe showing the reference's lines next to the ones to fix, before and after, with their text; the files worth a look flagged "To check".
- ✏️ **Correct by hand if needed**: drag a segment or a boundary, split, remove a false detection, **align** a line on the right one in one click, change one line's times or take it out, undo / redo.
- 🧹 **A cleanup of the usual faults**: extra spaces, stuck dashes, French punctuation, mixed apostrophes, subtitle sites' ads, overlapping or too short lines; each fix shown before and after, to keep or refuse.
- 📦 **A clean export**: a new MKV where the corrected track replaces the original or is added, nothing re-encoded, its name and flags as you choose, or the subtitle file alone. The original file is never changed.
- 🗂️ **A whole season in one pass**: videos that each hold both tracks, or videos and the subtitles to fix (SRT/ASS files or other videos) matched by episode number (`S01E03`, `1x03`…); tracks picked by number, language or name, or by hand file by file.
- 🖱️ **Drag and drop** files or whole folders, French or English, light or dark theme, adjustable interface size, automatic updates.

## Install

**Windows 10 and 11:**

1. Download `Bobine.Subs_x.y.z_x64-setup.exe` from the [latest release](https://github.com/MarcValat/BobineSubs/releases/latest).
2. Run it. The installer isn't signed with a certificate, so Windows SmartScreen may say *"Windows protected your PC"*: click **More info**, then **Run anyway**.

**Linux** (Ubuntu 22.04 or newer, Debian and their derivatives: Linux Mint, Pop!_OS…):

1. Download `Bobine.Subs_x.y.z_amd64.deb` from the [latest release](https://github.com/MarcValat/BobineSubs/releases/latest).
2. Install it from its folder with `sudo apt install ./Bobine.Subs_x.y.z_amd64.deb`, then start it from the applications menu or with `syncsubtitles`.

Nothing else to install: the analysis engine and ffmpeg come with the app. When a new version comes out, the app offers it and installs it in one click (on Linux, after asking for your password).

## How it works

1. **Add the videos** (or drop them, or a folder, on the window), in one of two modes: **Multitrack files** when each video holds both the well-timed subtitles and those to fix, **File pairs** when the subtitles to fix are separate (SRT/ASS files, or other videos). Pick the **reference** and the tracks **to correct** once for every file.
2. **Analyze**: the curve shows the segments found. Check in the loupe that lines fall in front of the right ones, and adjust the segments by hand if something's off.
3. **Export**: new MKVs (next to the originals: `Film.synced.mkv`, or in a folder of your choice), or the subtitles alone.

📖 The [user guide](docs/guide.md) covers everything in detail: reading the result, the segment editor, the cleanup, file pairs, FAQ.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/editor-en-dark.png">
  <img src="docs/screenshots/editor-en-light.png" alt="The segment editor: offset chart with draggable boundaries, loupe on the lines with one picked to align, segment table">
</picture>

## Good to know

- The reference must hold **the same lines** as the subtitles to fix. A "forced" track (only signs and foreign-language passages) has too few: the app leaves it out when it picks the reference, and warns if you force it.
- Lines that aren't dialogue (`[Music]`, `(laughs)`, song lyrics, ASS signs and karaoke) are ignored for syncing, but retimed like the others.
- When the subtitles hold a scene the video doesn't have (an extended cut's, say), its lines are left out; one to three lines at that scene's edges may be decided wrong: the summary lists every line left out, and "Keep" puts one back.
- The subtitles to fix must be text (SRT, ASS): image subtitles can be a reference, not be retimed.

## For developers

- [`engine/`](engine/README.md): the Python engine (reading tracks, detection, retiming, muxing, local HTTP server); usable on its own as a command line tool.
- [`app/`](app/README.md): the app (Tauri + React/TypeScript), which drives the engine; building, packaging and publishing a release.

## License

Copyright © 2026 Marc Valat. Bobine Subs is free software, released under the [GNU General Public License v3](LICENSE): you may use, study, share and modify it, and any version you distribute, modified or not, must stay under the same license with its source code available.

The installer also ships [FFmpeg](https://ffmpeg.org/) (a [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) build, through [imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg)), which Bobine Subs runs as a separate program. That build is also under the GPL v3; its source code is available from FFmpeg and gyan.dev.

The interface uses the [Inter](https://rsms.me/inter/) font (bundled through [Fontsource](https://fontsource.org/fonts/inter)), under the [SIL Open Font License 1.1](https://openfontlicense.org/).
