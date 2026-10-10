"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TrackStatus = "empty" | "queued" | "recording" | "playing" | "muted" | "mute-queued" | "unmute-queued";
type Track = { id: number; name: string; status: TrackStatus; blobUrl?: string; duration?: number; latencyMs: number };

const COLORS = ["#d8ff5f", "#ff7965", "#77d8ff", "#c5a1ff", "#ffca68", "#70e4b4", "#ff98cb", "#a8b6ff", "#e7f08a"];
const INITIAL_TRACKS = 4;
const LATENCY_STEP = 5;
const LATENCY_LIMIT = 250;

function Icon({ name, size = 18 }: { name: "play" | "pause" | "trash" | "plus" | "volume" | "mic"; size?: number }) {
  const paths = {
    play: <path d="m8 5 11 7-11 7V5Z" fill="currentColor" />,
    pause: <><path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    volume: <><path d="M5 10v4h3l4 4V6l-4 4H5Z" /><path d="M15 9c1.5 1.5 1.5 4.5 0 6m2-8c3 3 3 7 0 10" /></>,
    mic: <><rect x="9" y="4" width="6" height="11" rx="3" /><path d="M6 12a6 6 0 0 0 12 0m-6 6v3m-3 0h6" /></>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}

export default function Looper() {
  const [bpm, setBpm] = useState(120);
  const [bars, setBars] = useState(4);
  const [playing, setPlaying] = useState(false);
  const [metronome, setMetronome] = useState(true);
  const [metroVolume, setMetroVolume] = useState(64);
  const [globalLatency, setGlobalLatency] = useState(0);
  const [beat, setBeat] = useState(0);
  const [bar, setBar] = useState(1);
  const [tracks, setTracks] = useState<Track[]>(() => Array.from({ length: INITIAL_TRACKS }, (_, i) => ({ id: i + 1, name: `Track ${i + 1}`, status: "empty", latencyMs: 0 })));
  const [selectedTrack, setSelectedTrack] = useState<number | null>(null);
  const [deleteMode, setDeleteMode] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [notice, setNotice] = useState("Press space to start the loop");
  const [micReady, setMicReady] = useState(false);

  const audioContext = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startTime = useRef(0);
  const transportTimer = useRef<number | null>(null);
  const queuedTimers = useRef<Map<number, number>>(new Map());
  const audioEls = useRef<Map<number, HTMLAudioElement>>(new Map());
  const tracksRef = useRef(tracks);
  const playingRef = useRef(playing);

  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  const beatSeconds = 60 / bpm;
  const barMs = beatSeconds * 4 * 1000;
  const loopMs = barMs * bars;

  const clampLatency = useCallback((value: number) => Math.max(-LATENCY_LIMIT, Math.min(LATENCY_LIMIT, value)), []);

  const playbackOffset = useCallback((latencyMs: number) => {
    const elapsed = performance.now() - startTime.current;
    return (((elapsed - latencyMs) % loopMs + loopMs) % loopMs) / 1000;
  }, [loopMs]);

  const getContext = useCallback(() => {
    if (!audioContext.current) audioContext.current = new AudioContext();
    void audioContext.current.resume();
    return audioContext.current;
  }, []);

  const nextBarDelay = useCallback(() => {
    if (!playingRef.current) return 0;
    const elapsed = performance.now() - startTime.current;
    const position = elapsed % barMs;
    return Math.max(10, barMs - position);
  }, [barMs]);

  const tick = useCallback(() => {
    if (!playingRef.current) return;
    const elapsed = performance.now() - startTime.current;
    const nextBeat = Math.floor(elapsed / (beatSeconds * 1000)) % 4;
    const nextBar = Math.floor(elapsed / barMs) % bars + 1;
    setBeat(nextBeat);
    setBar(nextBar);
  }, [barMs, bars, beatSeconds]);

  useEffect(() => {
    if (!playing) return;
    transportTimer.current = window.setInterval(tick, 25);
    return () => { if (transportTimer.current) window.clearInterval(transportTimer.current); };
  }, [playing, tick]);

  useEffect(() => {
    if (!playing || !metronome) return;
    const ctx = getContext();
    const click = () => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = beat === 0 ? 1260 : 900;
      gain.gain.setValueAtTime((metroVolume / 100) * 0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.045);
      osc.connect(gain).connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.05);
    };
    click();
  }, [beat, getContext, metronome, metroVolume, playing]);

  const syncAudios = useCallback(() => {
    tracksRef.current.forEach(track => {
      const audio = audioEls.current.get(track.id);
      if (!audio || !track.blobUrl) return;
      audio.loop = true;
      audio.currentTime = Math.min(playbackOffset(track.latencyMs), Math.max(0, (audio.duration || loopMs / 1000) - 0.02));
      audio.muted = track.status === "muted" || track.status === "mute-queued";
      void audio.play().catch(() => undefined);
    });
  }, [loopMs, playbackOffset]);

  const togglePlay = useCallback(() => {
    getContext();
    setPlaying(value => {
      if (!value) {
        startTime.current = performance.now();
        setBeat(0); setBar(1); setNotice("Loop running — actions land on the next bar");
        window.setTimeout(syncAudios, 0);
      } else {
        audioEls.current.forEach(audio => audio.pause());
        setNotice("Loop paused");
      }
      playingRef.current = !value;
      return !value;
    });
  }, [getContext, syncAudios]);

  const updateTrack = useCallback((id: number, patch: Partial<Track>) => {
    setTracks(prev => prev.map(track => track.id === id ? { ...track, ...patch } : track));
  }, []);

  const nudgeTrack = useCallback((id: number, direction: -1 | 1) => {
    const track = tracksRef.current.find(item => item.id === id);
    if (!track?.blobUrl) { setNotice(`Record Track ${id} before adjusting its latency`); return; }
    const latencyMs = clampLatency(track.latencyMs + direction * LATENCY_STEP);
    updateTrack(id, { latencyMs });
    setSelectedTrack(id);
    const audio = audioEls.current.get(id);
    if (audio && playingRef.current) audio.currentTime = Math.min(playbackOffset(latencyMs), Math.max(0, (audio.duration || loopMs / 1000) - 0.02));
    setNotice(`Track ${id} latency ${latencyMs > 0 ? "+" : ""}${latencyMs} ms`);
  }, [clampLatency, loopMs, playbackOffset, updateTrack]);

  const queueMuteToggle = useCallback((id: number) => {
    const track = tracksRef.current.find(item => item.id === id);
    if (!track || !track.blobUrl) return;
    const willMute = track.status !== "muted" && track.status !== "mute-queued";
    updateTrack(id, { status: willMute ? "mute-queued" : "unmute-queued" });
    setNotice(`${willMute ? "Mute" : "Unmute"} queued for Track ${id}`);
    const timer = window.setTimeout(() => {
      const audio = audioEls.current.get(id);
      if (audio) audio.muted = willMute;
      updateTrack(id, { status: willMute ? "muted" : "playing" });
      setNotice(`Track ${id} ${willMute ? "muted" : "playing"}`);
    }, nextBarDelay());
    queuedTimers.current.set(id, timer);
  }, [nextBarDelay, updateTrack]);

  const ensureMic = useCallback(async () => {
    if (!stream.current) stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    setMicReady(true);
    return stream.current;
  }, []);

  const queueRecord = useCallback(async (id: number) => {
    const track = tracksRef.current.find(item => item.id === id);
    if (!playingRef.current) { setNotice("Start the loop before recording"); return; }
    if (!track) return;
    if (track.blobUrl || track.status !== "empty") { queueMuteToggle(id); return; }
    try {
      const mic = await ensureMic();
      updateTrack(id, { status: "queued" });
      setNotice(`Track ${id} armed — recording starts next bar`);
      const timer = window.setTimeout(() => {
        chunks.current = [];
        const mediaRecorder = new MediaRecorder(mic);
        recorder.current = mediaRecorder;
        mediaRecorder.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data); };
        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType });
          const blobUrl = URL.createObjectURL(blob);
          const audio = new Audio(blobUrl);
          audio.loop = true;
          audioEls.current.set(id, audio);
          updateTrack(id, { status: "playing", blobUrl, duration: loopMs / 1000, latencyMs: globalLatency });
          setSelectedTrack(id);
          audio.currentTime = Math.min(playbackOffset(globalLatency), Math.max(0, loopMs / 1000 - 0.02));
          void audio.play().catch(() => undefined);
          setNotice(`Track ${id} captured and looping`);
        };
        mediaRecorder.start();
        updateTrack(id, { status: "recording" });
        setNotice(`Recording Track ${id}…`);
        window.setTimeout(() => { if (mediaRecorder.state === "recording") mediaRecorder.stop(); }, loopMs);
      }, nextBarDelay());
      queuedTimers.current.set(id, timer);
    } catch {
      setNotice("Microphone access is needed to record");
    }
  }, [ensureMic, globalLatency, loopMs, nextBarDelay, playbackOffset, queueMuteToggle, updateTrack]);

  const deleteTrack = useCallback((id: number) => {
    const old = tracksRef.current.find(item => item.id === id);
    if (old?.blobUrl) URL.revokeObjectURL(old.blobUrl);
    const audio = audioEls.current.get(id);
    if (audio) { audio.pause(); audioEls.current.delete(id); }
    updateTrack(id, { status: "empty", blobUrl: undefined, duration: undefined, latencyMs: 0 });
    setSelectedTrack(current => current === id ? null : current);
    setDeleteTarget(null); setDeleteMode(false); setNotice(`Track ${id} cleared`);
  }, [updateTrack]);

  const handleTrackAction = useCallback((id: number) => {
    if (deleteMode) {
      const target = tracksRef.current.find(item => item.id === id);
      if (target?.blobUrl) { setDeleteTarget(id); setNotice(`Press Enter to clear Track ${id}`); }
      return;
    }
    void queueRecord(id);
  }, [deleteMode, queueRecord]);

  const fullMute = useCallback(() => {
    if (!playingRef.current) { setNotice("Start the loop before queuing a full mute"); return; }
    const occupied = tracksRef.current.filter(track => track.blobUrl);
    if (!occupied.length) { setNotice("There are no recorded tracks to mute"); return; }
    occupied.forEach(track => updateTrack(track.id, { status: "mute-queued" }));
    setNotice("Full mute queued for the next bar");
    window.setTimeout(() => {
      occupied.forEach(track => { const audio = audioEls.current.get(track.id); if (audio) audio.muted = true; updateTrack(track.id, { status: "muted" }); });
      setNotice("All tracks muted — loop is still running");
    }, nextBarDelay());
  }, [nextBarDelay, updateTrack]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.code === "Space") { event.preventDefault(); togglePlay(); return; }
      if (event.key.toLowerCase() === "m") { fullMute(); return; }
      if (event.key.toLowerCase() === "d") { setDeleteMode(true); setDeleteTarget(null); setNotice("Delete mode — choose a numbered track"); return; }
      if (event.key === "Escape") { setDeleteMode(false); setDeleteTarget(null); setNotice("Delete cancelled"); return; }
      if (event.key === "Enter" && deleteTarget) { deleteTrack(deleteTarget); return; }
      if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && selectedTrack) {
        event.preventDefault();
        nudgeTrack(selectedTrack, event.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      const number = Number(event.key);
      if (number >= 1 && number <= tracksRef.current.length) handleTrackAction(number);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteTarget, deleteTrack, fullMute, handleTrackAction, nudgeTrack, selectedTrack, togglePlay]);

  useEffect(() => () => {
    stream.current?.getTracks().forEach(track => track.stop());
    queuedTimers.current.forEach(timer => window.clearTimeout(timer));
    audioEls.current.forEach(audio => audio.pause());
  }, []);

  const loopProgress = useMemo(() => ((bar - 1) * 4 + beat + 1) / (bars * 4) * 100, [bar, bars, beat]);

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><i /><i /><i /><i /></span><span>IFY/<b>LOOP</b></span></div>
        <div className="session-name"><span className="live-dot" />UNTITLED SESSION</div>
        <button className="help" aria-label="Keyboard shortcuts">?</button>
      </header>

      <section className="transport" aria-label="Transport controls">
        <button className={`play ${playing ? "active" : ""}`} onClick={togglePlay} aria-label={playing ? "Pause loop" : "Start loop"}><Icon name={playing ? "pause" : "play"} size={23} /></button>
        <div className="tempo-control">
          <span className="control-label">TEMPO</span>
          <div className="tempo-value"><button onClick={() => setBpm(Math.max(40, bpm - 1))}>−</button><strong>{bpm}</strong><small>BPM</small><button onClick={() => setBpm(Math.min(240, bpm + 1))}>+</button></div>
        </div>
        <div className="divider" />
        <label className="select-control"><span className="control-label">LOOP LENGTH</span><select value={bars} onChange={event => setBars(Number(event.target.value))} disabled={playing}><option value={1}>1 BAR</option><option value={2}>2 BARS</option><option value={4}>4 BARS</option><option value={8}>8 BARS</option><option value={16}>16 BARS</option></select></label>
        <div className="divider" />
        <div className="metro-control"><span className="control-label">METRONOME</span><div><button className={`toggle ${metronome ? "on" : ""}`} onClick={() => setMetronome(!metronome)} aria-label="Toggle metronome"><span /></button><Icon name="volume" /><input aria-label="Metronome volume" type="range" min="0" max="100" value={metroVolume} onChange={event => setMetroVolume(Number(event.target.value))} /></div></div>
        <div className="divider" />
        <div className="latency-global"><span className="control-label">NEW TRACK LATENCY</span><div><button onClick={() => setGlobalLatency(value => clampLatency(value - LATENCY_STEP))} aria-label="Decrease global latency">−</button><strong>{globalLatency > 0 ? "+" : ""}{globalLatency}</strong><small>MS</small><button onClick={() => setGlobalLatency(value => clampLatency(value + LATENCY_STEP))} aria-label="Increase global latency">+</button></div></div>
      </section>

      <section className="workspace">
        <div className="workspace-head">
          <div><p className="eyebrow">LIVE ARRANGEMENT</p><h1>Build your loop</h1><p className="subhead">Everything lands on the one. Stay in the flow.</p></div>
          <div className="bar-counter"><span>BAR</span><strong>{String(bar).padStart(2, "0")}</strong><em>/ {String(bars).padStart(2, "0")}</em></div>
        </div>

        <div className="timeline" aria-label={`Bar ${bar} of ${bars}`}><span style={{ width: `${loopProgress}%` }} /><div className="beat-dots">{[0,1,2,3].map(item => <i key={item} className={item === beat && playing ? "active" : ""} />)}</div></div>

        <div className="track-list">
          {tracks.map((track, index) => {
            const empty = track.status === "empty";
            const muted = track.status === "muted" || track.status === "mute-queued";
            const queued = track.status.includes("queued");
            return (
              <article className={`track ${empty ? "empty" : "filled"} ${muted ? "is-muted" : ""} ${selectedTrack === track.id ? "selected" : ""}`} key={track.id} style={{ "--track-color": COLORS[index] } as React.CSSProperties} onClick={() => { if (!empty) setSelectedTrack(track.id); }}>
                <button className="track-key" onClick={() => handleTrackAction(track.id)} aria-label={`${empty ? "Record" : "Mute or unmute"} Track ${track.id}`}>{track.id}</button>
                <div className="track-info"><strong>{track.name}</strong><span>{track.status === "empty" ? "READY TO RECORD" : track.status.replace("-", " ").toUpperCase()}</span></div>
                <div className="waveform" aria-hidden>{Array.from({ length: 52 }, (_, i) => <i key={i} style={{ height: empty ? 2 : `${18 + ((i * 17 + track.id * 11) % 42)}%` }} />)}</div>
                {queued && <span className="queued-pill">NEXT BAR</span>}
                {!empty && !queued && <div className="track-latency" aria-label={`Track ${track.id} latency`}><button onClick={() => nudgeTrack(track.id, -1)} aria-label={`Shift Track ${track.id} backward 5 milliseconds`}>−</button><span>{track.latencyMs > 0 ? "+" : ""}{track.latencyMs}<small>ms</small></span><button onClick={() => nudgeTrack(track.id, 1)} aria-label={`Shift Track ${track.id} forward 5 milliseconds`}>+</button></div>}
                {!empty && <button className="mini-delete" onClick={() => { setDeleteMode(true); setDeleteTarget(track.id); }} aria-label={`Delete Track ${track.id}`}><Icon name="trash" size={17} /></button>}
                <button className={`track-action ${track.status === "recording" ? "recording" : ""}`} onClick={() => handleTrackAction(track.id)}><span />{empty || track.status === "queued" || track.status === "recording" ? "REC" : muted ? "UNMUTE" : "MUTE"}</button>
              </article>
            );
          })}
        </div>

        {tracks.length < 9 && <button className="add-track" onClick={() => setTracks(prev => [...prev, { id: prev.length + 1, name: `Track ${prev.length + 1}`, status: "empty", latencyMs: 0 }])}><Icon name="plus" /> ADD TRACK <span>{tracks.length}/9</span></button>}
      </section>

      <footer>
        <div className="status"><span className={playing ? "pulse" : ""} />{notice}</div>
        <div className="shortcuts"><span><kbd>SPACE</kbd> PLAY / PAUSE</span><span><kbd>1–9</kbd> REC / MUTE</span><span><kbd>← →</kbd> LATENCY</span><span><kbd>M</kbd> FULL MUTE</span><span><kbd>D</kbd> DELETE</span></div>
        <span className="mic-status"><Icon name="mic" size={15} /> {micReady ? "MIC READY" : "MIC ON RECORD"}</span>
      </footer>

      {deleteTarget && <div className="modal-backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><span className="warning"><Icon name="trash" size={24} /></span><p className="eyebrow">DESTRUCTIVE ACTION</p><h2 id="delete-title">Clear Track {deleteTarget}?</h2><p>This recording will be removed and the track will become vacant.</p><div><button onClick={() => { setDeleteTarget(null); setDeleteMode(false); }}>CANCEL <kbd>ESC</kbd></button><button className="danger" onClick={() => deleteTrack(deleteTarget)}>CLEAR TRACK <kbd>↵</kbd></button></div></div></div>}
    </main>
  );
}
