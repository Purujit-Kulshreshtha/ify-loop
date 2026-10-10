# IfyLoop

A browser-based live looping instrument built with Next.js and the Web Audio / MediaRecorder APIs.

## Projects and local storage

The home page is a local project library. New projects autosave into the browser's Origin Private File System unless a projects folder is linked, in which case new projects and their WAV files are written there instead.

- `Link Projects Folder` remembers the selected directory handle in IndexedDB and its display configuration in localStorage. Browsers may occasionally require the folder permission to be renewed.
- `Export` downloads a portable `.ifyloop` ZIP bundle containing `project.json` and an `audio/` directory of WAV files.
- `Import .ifyloop` creates a new local copy of a portable project.
- Project audio is decoded into working memory when the editor opens; a loading overlay is shown during that process.

The versioned `project.json` manifest stores transport, latency, volume, mute, EQ, and reverb settings non-destructively. There is no server or cloud storage.

## Interactive tutorial

First-time visitors are offered a 16-step guided tour that spotlights the real project and editor controls. It covers creating and reopening projects, folder linking, import/export, transport, tempo, loop length, metronome, recording, wired-headphone monitoring, latency compensation, effects, and saving. The tour waits for required actions and continues across page navigation; progress and completion are stored locally. It can be replayed from the `?` button in the editor.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Microphone access is requested only when a track is first armed.

## Controls

- `Space`: start or pause the transport
- `1`–`9`: arm an empty track, or queue mute/unmute for a recorded track
- `M`: toggle full mute on the next bar; pressing it again restores the tracks that were active before the full mute
- `D`, then a track number, then `Enter`: clear a recording
- `←` / `→`: nudge the selected recorded track backward or forward by 5 ms
- `Escape`: leave delete mode

Record, mute, unmute, and full-mute actions are quantized to the next bar. Recordings run for the selected loop length, while muted audio keeps its place in the transport.

Recording starts capturing raw Web Audio samples as soon as a track is armed. The next bar is timestamped on the audio clock, and the finished take is trimmed to that exact sample boundary. Wrapped head and tail samples provide the latency margins without delaying playback or cutting off the first beat.

The global latency control sets the starting offset for every new recording. Each recorded track can then be selected and fine-tuned independently from −250 ms to +250 ms using its on-screen controls or the arrow keys.

Click any displayed BPM or latency value to type an exact number, then press `Enter` or click away to apply it.

## Track effects

- Per-track volume runs from 0% to 150%.
- The FX drawer provides seven EQ bands at 60 Hz, 150 Hz, 400 Hz, 1 kHz, 2.4 kHz, 6 kHz, and 12 kHz, each with ±12 dB of gain.
- Reverb provides a 0–100% wet level with a 2.4-second decay. The reverb processor sits after the mute gate, so an existing tail continues naturally after the track is muted.
- Effect values update the active Web Audio graph immediately and can also be typed directly.

## Checks

```bash
npm run build
```
