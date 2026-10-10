# IfyLoop

A browser-based live looping instrument built with Next.js and the Web Audio / MediaRecorder APIs.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Microphone access is requested only when a track is first armed.

## Controls

- `Space`: start or pause the transport
- `1`–`9`: arm an empty track, or queue mute/unmute for a recorded track
- `M`: queue a full mute for the next bar
- `D`, then a track number, then `Enter`: clear a recording
- `←` / `→`: nudge the selected recorded track backward or forward by 5 ms
- `Escape`: leave delete mode

Record, mute, unmute, and full-mute actions are quantized to the next bar. Recordings run for the selected loop length, while muted audio keeps its place in the transport.

Recording starts capturing raw Web Audio samples as soon as a track is armed. The next bar is timestamped on the audio clock, and the finished take is trimmed to that exact sample boundary with a small pre/post-roll margin. This avoids encoded-audio padding and keeps latency adjustments phase-locked.

The global latency control sets the starting offset for every new recording. Each recorded track can then be selected and fine-tuned independently from −250 ms to +250 ms using its on-screen controls or the arrow keys.

## Checks

```bash
npm run build
```
