"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { audioBufferToWav } from "@/lib/audio-files";
import { createProjectBundle } from "@/lib/project-bundle";
import { loadProject as loadStoredProject, saveProject } from "@/lib/project-storage";
import type { IfyLoopProject, ProjectSource } from "@/lib/projects";

type TrackStatus = "empty" | "queued" | "recording" | "playing" | "muted" | "mute-queued" | "unmute-queued";
type Track = { id: number; name: string; status: TrackStatus; hasRecording: boolean; duration?: number; latencyMs: number; volume: number; eq: number[]; reverb: number };
type PlaybackNode = { source: AudioBufferSourceNode; volume: GainNode; eq: BiquadFilterNode[]; mute: GainNode; dry: GainNode; convolver: ConvolverNode; wet: GainNode };
type PcmChunk = { at: number; channels: Float32Array[] };
type ActiveCapture = {
  trackId: number;
  input: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  silentGain: GainNode;
  chunks: PcmChunk[];
  targetTime: number;
  startTimer: number;
  stopTimer: number;
};

const COLORS = ["#27e6c1", "#5ff0d4", "#20c9aa", "#8cf7e1", "#16ad92", "#b7fff0", "#3ddbbd", "#75e8d1", "#2fc7ac"];
const INITIAL_TRACKS = 4;
const LATENCY_STEP = 5;
const LATENCY_LIMIT = 250;
const CAPTURE_MARGIN_SECONDS = LATENCY_LIMIT / 1000;
const EQ_BANDS = [60, 150, 400, 1000, 2400, 6000, 12000];

const makeTrack = (id: number): Track => ({ id, name: `Track ${id}`, status: "empty", hasRecording: false, latencyMs: 0, volume: 100, eq: EQ_BANDS.map(() => 0), reverb: 0 });

type EditableNumberProps = {
  value: number;
  onCommit: (value: number) => void;
  min: number;
  max: number;
  label: string;
  suffix?: string;
  signed?: boolean;
  className?: string;
};

function EditableNumber({ value, onCommit, min, max, label, suffix, signed = false, className = "" }: EditableNumberProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) { setDraft(String(value)); inputRef.current?.select(); }
  }, [editing, value]);

  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) onCommit(Math.max(min, Math.min(max, Math.round(parsed))));
    setEditing(false);
  };

  if (editing) {
    return <input ref={inputRef} className={`editable-number-input ${className}`} aria-label={label} type="number" inputMode="numeric" min={min} max={max} value={draft} onClick={event => event.stopPropagation()} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setEditing(false); }} />;
  }

  return <button type="button" className={`editable-number ${className}`} aria-label={`${label}: ${value}. Click to edit`} onClick={event => { event.stopPropagation(); setEditing(true); }}><span>{signed && value > 0 ? "+" : ""}{value}</span>{suffix && <small>{suffix}</small>}</button>;
}

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

export default function Looper({ projectId, source }: { projectId: string; source: ProjectSource }) {
  const router = useRouter();
  const [bpm, setBpm] = useState(120);
  const [bars, setBars] = useState(4);
  const [playing, setPlaying] = useState(false);
  const [metronome, setMetronome] = useState(true);
  const [metroVolume, setMetroVolume] = useState(64);
  const [globalLatency, setGlobalLatency] = useState(0);
  const [beat, setBeat] = useState(0);
  const [bar, setBar] = useState(1);
  const [tracks, setTracks] = useState<Track[]>(() => Array.from({ length: INITIAL_TRACKS }, (_, i) => makeTrack(i + 1)));
  const [selectedTrack, setSelectedTrack] = useState<number | null>(null);
  const [effectsTrack, setEffectsTrack] = useState<number | null>(null);
  const [deleteMode, setDeleteMode] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [notice, setNotice] = useState("Press space to start the loop");
  const [micReady, setMicReady] = useState(false);
  const [projectName, setProjectName] = useState("Loading project…");
  const [loadingProject, setLoadingProject] = useState(true);
  const [saveStatus, setSaveStatus] = useState("LOADING");

  const audioContext = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const startTime = useRef(0);
  const audioStartTime = useRef(0);
  const transportTimer = useRef<number | null>(null);
  const queuedTimers = useRef<Map<number, number>>(new Map());
  const audioBuffers = useRef<Map<number, AudioBuffer>>(new Map());
  const wavCache = useRef<Map<number, { buffer: AudioBuffer; blob: Blob }>>(new Map());
  const playbackNodes = useRef<Map<number, PlaybackNode>>(new Map());
  const impulseResponse = useRef<AudioBuffer | null>(null);
  const activeCapture = useRef<ActiveCapture | null>(null);
  const fullMuteActive = useRef(false);
  const fullMuteRestore = useRef<Set<number>>(new Set());
  const projectMeta = useRef<Pick<IfyLoopProject, "createdAt">>({ createdAt: new Date().toISOString() });
  const projectLoaded = useRef(false);
  const tracksRef = useRef(tracks);
  const playingRef = useRef(playing);

  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  const beatSeconds = 60 / bpm;
  const barMs = beatSeconds * 4 * 1000;
  const loopMs = barMs * bars;

  const clampLatency = useCallback((value: number) => Math.max(-LATENCY_LIMIT, Math.min(LATENCY_LIMIT, value)), []);

  const getContext = useCallback(() => {
    if (!audioContext.current) audioContext.current = new AudioContext();
    void audioContext.current.resume();
    return audioContext.current;
  }, []);

  const buildManifest = useCallback((): IfyLoopProject => ({
    format: "ifyloop-project",
    version: 1,
    id: projectId,
    name: projectName,
    createdAt: projectMeta.current.createdAt,
    updatedAt: new Date().toISOString(),
    tempo: bpm,
    loopBars: bars,
    globalLatencyMs: globalLatency,
    tracks: tracks.map(track => ({ id: track.id, name: track.name, audio: track.hasRecording ? `audio/track-${String(track.id).padStart(2, "0")}.wav` : undefined, latencyMs: track.latencyMs, volume: track.volume, muted: track.status === "muted", eq: track.eq, reverb: track.reverb }))
  }), [bars, bpm, globalLatency, projectId, projectName, tracks]);

  const collectAudio = useCallback(() => {
    const files = new Map<string, Blob>();
    audioBuffers.current.forEach((buffer, id) => {
      let cached = wavCache.current.get(id);
      if (!cached || cached.buffer !== buffer) { cached = { buffer, blob: audioBufferToWav(buffer) }; wavCache.current.set(id, cached); }
      files.set(`track-${String(id).padStart(2, "0")}.wav`, cached.blob);
    });
    return files;
  }, []);

  const persistProject = useCallback(async () => {
    if (!projectLoaded.current) return;
    setSaveStatus("SAVING");
    const manifest = buildManifest();
    await saveProject(source, manifest, collectAudio());
    setSaveStatus("SAVED");
    return manifest;
  }, [buildManifest, collectAudio, source]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingProject(true); setSaveStatus("LOADING");
      try {
        const { project, audio } = await loadStoredProject(source, projectId);
        const ctx = getContext();
        audioBuffers.current.clear();
        for (const track of project.tracks) if (track.audio && audio.has(track.audio)) {
          const decoded = await ctx.decodeAudioData(audio.get(track.audio)!.slice(0));
          audioBuffers.current.set(track.id, decoded);
        }
        if (cancelled) return;
        projectMeta.current = { createdAt: project.createdAt };
        setProjectName(project.name); setBpm(project.tempo); setBars(project.loopBars); setGlobalLatency(project.globalLatencyMs);
        const count = Math.min(9, Math.max(INITIAL_TRACKS, ...project.tracks.map(track => track.id), 0));
        const restored = Array.from({ length: count }, (_, index) => {
          const saved = project.tracks.find(track => track.id === index + 1);
          if (!saved) return makeTrack(index + 1);
          return { ...makeTrack(saved.id), name: saved.name, hasRecording: !!saved.audio && audioBuffers.current.has(saved.id), status: saved.audio ? (saved.muted ? "muted" : "playing") as TrackStatus : "empty" as TrackStatus, latencyMs: saved.latencyMs, volume: saved.volume, eq: saved.eq, reverb: saved.reverb };
        });
        tracksRef.current = restored; setTracks(restored); projectLoaded.current = true; setSaveStatus("SAVED");
      } catch (error) { setNotice(error instanceof Error ? error.message : "Could not load project"); setSaveStatus("LOAD ERROR"); }
      finally { if (!cancelled) setLoadingProject(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [getContext, projectId, source]);

  useEffect(() => {
    if (!projectLoaded.current) return;
    setSaveStatus("UNSAVED");
    const timer = window.setTimeout(() => { void persistProject().catch(() => setSaveStatus("SAVE ERROR")); }, 900);
    return () => window.clearTimeout(timer);
  }, [bpm, bars, globalLatency, tracks, persistProject]);

  const getImpulseResponse = useCallback((ctx: AudioContext) => {
    if (impulseResponse.current) return impulseResponse.current;
    const duration = 2.4;
    const buffer = ctx.createBuffer(2, Math.round(ctx.sampleRate * duration), ctx.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.7);
    }
    impulseResponse.current = buffer;
    return buffer;
  }, []);

  const nextBarDelay = useCallback(() => {
    if (!playingRef.current) return 0;
    const elapsed = audioContext.current
      ? (audioContext.current.currentTime - audioStartTime.current) * 1000
      : performance.now() - startTime.current;
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

  const stopPlaybackNode = useCallback((id: number) => {
    const node = playbackNodes.current.get(id);
    if (!node) return;
    try { node.source.stop(); } catch { /* already stopped */ }
    node.source.disconnect();
    node.volume.disconnect();
    node.eq.forEach(filter => filter.disconnect());
    node.mute.disconnect();
    node.dry.disconnect();
    node.convolver.disconnect();
    node.wet.disconnect();
    playbackNodes.current.delete(id);
  }, []);

  const startTrackPlayback = useCallback((id: number, latencyOverride?: number) => {
    const ctx = getContext();
    const buffer = audioBuffers.current.get(id);
    const track = tracksRef.current.find(item => item.id === id);
    if (!buffer || !track || !playingRef.current) return;
    stopPlaybackNode(id);
    const latencyMs = latencyOverride ?? track.latencyMs;
    const loopSeconds = loopMs / 1000;
    const loopStart = CAPTURE_MARGIN_SECONDS - latencyMs / 1000;
    const phase = ((ctx.currentTime - audioStartTime.current) % loopSeconds + loopSeconds) % loopSeconds;
    const source = ctx.createBufferSource();
    const volume = ctx.createGain();
    const eq = EQ_BANDS.map((frequency, index) => {
      const filter = ctx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = frequency;
      filter.Q.value = 1.15;
      filter.gain.value = track.eq[index];
      return filter;
    });
    const mute = ctx.createGain();
    const dry = ctx.createGain();
    const convolver = ctx.createConvolver();
    const wet = ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = loopStart;
    source.loopEnd = loopStart + loopSeconds;
    volume.gain.value = track.volume / 100;
    mute.gain.value = track.status === "muted" || track.status === "mute-queued" ? 0 : 1;
    dry.gain.value = 1;
    convolver.buffer = getImpulseResponse(ctx);
    wet.gain.value = track.reverb / 100 * 0.75;
    source.connect(volume);
    let chain: AudioNode = volume;
    eq.forEach(filter => { chain.connect(filter); chain = filter; });
    chain.connect(mute);
    mute.connect(dry).connect(ctx.destination);
    mute.connect(convolver).connect(wet).connect(ctx.destination);
    source.start(0, loopStart + phase);
    playbackNodes.current.set(id, { source, volume, eq, mute, dry, convolver, wet });
  }, [getContext, getImpulseResponse, loopMs, stopPlaybackNode]);

  const syncAudios = useCallback(() => {
    tracksRef.current.forEach(track => { if (track.hasRecording) startTrackPlayback(track.id); });
  }, [startTrackPlayback]);

  const togglePlay = useCallback(() => {
    const ctx = getContext();
    setPlaying(value => {
      if (!value) {
        startTime.current = performance.now();
        audioStartTime.current = ctx.currentTime;
        setBeat(0); setBar(1); setNotice("Loop running — actions land on the next bar");
        window.setTimeout(syncAudios, 0);
      } else {
        playbackNodes.current.forEach((_, id) => stopPlaybackNode(id));
        setNotice("Loop paused");
      }
      playingRef.current = !value;
      return !value;
    });
  }, [getContext, stopPlaybackNode, syncAudios]);

  const updateTrack = useCallback((id: number, patch: Partial<Track>) => {
    setTracks(prev => {
      const next = prev.map(track => track.id === id ? { ...track, ...patch } : track);
      tracksRef.current = next;
      return next;
    });
  }, []);

  const setTrackMutedNode = useCallback((id: number, muted: boolean) => {
    const node = playbackNodes.current.get(id);
    const ctx = audioContext.current;
    if (!node || !ctx) return;
    node.mute.gain.cancelScheduledValues(ctx.currentTime);
    node.mute.gain.setValueAtTime(node.mute.gain.value, ctx.currentTime);
    node.mute.gain.linearRampToValueAtTime(muted ? 0 : 1, ctx.currentTime + 0.015);
  }, []);

  const setTrackVolume = useCallback((id: number, value: number) => {
    const volume = Math.max(0, Math.min(150, Math.round(value)));
    updateTrack(id, { volume });
    const node = playbackNodes.current.get(id);
    if (node && audioContext.current) node.volume.gain.setTargetAtTime(volume / 100, audioContext.current.currentTime, 0.01);
  }, [updateTrack]);

  const setTrackEq = useCallback((id: number, band: number, value: number) => {
    const track = tracksRef.current.find(item => item.id === id);
    if (!track) return;
    const gain = Math.max(-12, Math.min(12, Math.round(value)));
    const eq = track.eq.map((current, index) => index === band ? gain : current);
    updateTrack(id, { eq });
    const node = playbackNodes.current.get(id);
    if (node && audioContext.current) node.eq[band].gain.setTargetAtTime(gain, audioContext.current.currentTime, 0.01);
  }, [updateTrack]);

  const setTrackReverb = useCallback((id: number, value: number) => {
    const reverb = Math.max(0, Math.min(100, Math.round(value)));
    updateTrack(id, { reverb });
    const node = playbackNodes.current.get(id);
    if (node && audioContext.current) node.wet.gain.setTargetAtTime(reverb / 100 * 0.75, audioContext.current.currentTime, 0.02);
  }, [updateTrack]);

  const nudgeTrack = useCallback((id: number, direction: -1 | 1) => {
    const track = tracksRef.current.find(item => item.id === id);
    if (!track?.hasRecording) { setNotice(`Record Track ${id} before adjusting its latency`); return; }
    const latencyMs = clampLatency(track.latencyMs + direction * LATENCY_STEP);
    updateTrack(id, { latencyMs });
    setSelectedTrack(id);
    if (playingRef.current) startTrackPlayback(id, latencyMs);
    setNotice(`Track ${id} latency ${latencyMs > 0 ? "+" : ""}${latencyMs} ms`);
  }, [clampLatency, startTrackPlayback, updateTrack]);

  const setTrackLatency = useCallback((id: number, value: number) => {
    const track = tracksRef.current.find(item => item.id === id);
    if (!track?.hasRecording) return;
    const latencyMs = clampLatency(value);
    updateTrack(id, { latencyMs });
    setSelectedTrack(id);
    if (playingRef.current) startTrackPlayback(id, latencyMs);
    setNotice(`Track ${id} latency ${latencyMs > 0 ? "+" : ""}${latencyMs} ms`);
  }, [clampLatency, startTrackPlayback, updateTrack]);

  const queueMuteToggle = useCallback((id: number) => {
    const track = tracksRef.current.find(item => item.id === id);
    if (!track || !track.hasRecording) return;
    const willMute = track.status !== "muted" && track.status !== "mute-queued";
    updateTrack(id, { status: willMute ? "mute-queued" : "unmute-queued" });
    setNotice(`${willMute ? "Mute" : "Unmute"} queued for Track ${id}`);
    const timer = window.setTimeout(() => {
      setTrackMutedNode(id, willMute);
      updateTrack(id, { status: willMute ? "muted" : "playing" });
      setNotice(`Track ${id} ${willMute ? "muted" : "playing"}`);
    }, nextBarDelay());
    queuedTimers.current.set(id, timer);
  }, [nextBarDelay, setTrackMutedNode, updateTrack]);

  const ensureMic = useCallback(async () => {
    if (!stream.current) stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    setMicReady(true);
    return stream.current;
  }, []);

  const finishCapture = useCallback((capture: ActiveCapture, latencyMs: number) => {
    if (activeCapture.current !== capture) return;
    capture.processor.onaudioprocess = null;
    capture.input.disconnect();
    capture.processor.disconnect();
    capture.silentGain.disconnect();
    activeCapture.current = null;

    const ctx = getContext();
    const sampleRate = ctx.sampleRate;
    const loopSeconds = loopMs / 1000;
    const loopFrames = Math.round(loopSeconds * sampleRate);
    const marginFrames = Math.round(CAPTURE_MARGIN_SECONDS * sampleRate);
    const frameCount = loopFrames + marginFrames * 2;
    const channelCount = capture.chunks[0]?.channels.length || 1;
    const buffer = ctx.createBuffer(channelCount, frameCount, sampleRate);
    const totalFrames = capture.chunks.reduce((sum, chunk) => sum + chunk.channels[0].length, 0);
    const firstTime = capture.chunks[0]?.at ?? capture.targetTime;
    const sourceStart = Math.round((capture.targetTime - firstTime) * sampleRate);

    for (let channel = 0; channel < channelCount; channel += 1) {
      const flattened = new Float32Array(totalFrames);
      let writeAt = 0;
      capture.chunks.forEach(chunk => {
        const samples = chunk.channels[Math.min(channel, chunk.channels.length - 1)];
        flattened.set(samples, writeAt);
        writeAt += samples.length;
      });
      const loopData = new Float32Array(loopFrames);
      const readAt = Math.max(0, sourceStart);
      const destinationAt = Math.max(0, -sourceStart);
      const available = Math.min(flattened.length - readAt, loopFrames - destinationAt);
      if (available > 0) loopData.set(flattened.subarray(readAt, readAt + available), destinationAt);

      buffer.copyToChannel(loopData.subarray(loopFrames - marginFrames), channel, 0);
      buffer.copyToChannel(loopData, channel, marginFrames);
      buffer.copyToChannel(loopData.subarray(0, marginFrames), channel, marginFrames + loopFrames);
    }

    audioBuffers.current.set(capture.trackId, buffer);
    updateTrack(capture.trackId, { status: "playing", hasRecording: true, duration: loopSeconds, latencyMs });
    setSelectedTrack(capture.trackId);
    if (playingRef.current) startTrackPlayback(capture.trackId, latencyMs);
    setNotice(`Track ${capture.trackId} trimmed to the bar and looping`);
  }, [getContext, loopMs, startTrackPlayback, updateTrack]);

  const queueRecord = useCallback(async (id: number) => {
    const track = tracksRef.current.find(item => item.id === id);
    if (!playingRef.current) { setNotice("Start the loop before recording"); return; }
    if (!track) return;
    if (track.hasRecording || track.status !== "empty") { queueMuteToggle(id); return; }
    if (activeCapture.current) { setNotice(`Finish recording Track ${activeCapture.current.trackId} first`); return; }
    try {
      const mic = await ensureMic();
      const ctx = getContext();
      const delaySeconds = nextBarDelay() / 1000;
      const targetTime = ctx.currentTime + delaySeconds;
      const input = ctx.createMediaStreamSource(mic);
      const processor = ctx.createScriptProcessor(2048, 2, 2);
      const silentGain = ctx.createGain();
      const capturedChunks: PcmChunk[] = [];
      silentGain.gain.value = 0;
      processor.onaudioprocess = event => {
        const channels = Array.from({ length: event.inputBuffer.numberOfChannels }, (_, channel) => new Float32Array(event.inputBuffer.getChannelData(channel)));
        capturedChunks.push({ at: event.playbackTime, channels });
      };
      input.connect(processor);
      processor.connect(silentGain).connect(ctx.destination);
      updateTrack(id, { status: "queued" });
      setNotice(`Capturing Track ${id} pre-roll — loop begins next bar`);
      const startTimer = window.setTimeout(() => {
        updateTrack(id, { status: "recording" });
        setNotice(`Recording Track ${id}…`);
      }, delaySeconds * 1000);
      const capture = { trackId: id, input, processor, silentGain, chunks: capturedChunks, targetTime, startTimer, stopTimer: 0 };
      capture.stopTimer = window.setTimeout(() => finishCapture(capture, globalLatency), (delaySeconds + loopMs / 1000) * 1000);
      activeCapture.current = capture;
      queuedTimers.current.set(id, startTimer);
    } catch {
      setNotice("Microphone access is needed to record");
    }
  }, [ensureMic, finishCapture, getContext, globalLatency, loopMs, nextBarDelay, queueMuteToggle, updateTrack]);

  const deleteTrack = useCallback((id: number) => {
    stopPlaybackNode(id);
    audioBuffers.current.delete(id);
    wavCache.current.delete(id);
    updateTrack(id, { status: "empty", hasRecording: false, duration: undefined, latencyMs: 0 });
    setSelectedTrack(current => current === id ? null : current);
    setDeleteTarget(null); setDeleteMode(false); setNotice(`Track ${id} cleared`);
  }, [stopPlaybackNode, updateTrack]);

  const handleTrackAction = useCallback((id: number) => {
    if (deleteMode) {
      const target = tracksRef.current.find(item => item.id === id);
      if (target?.hasRecording) { setDeleteTarget(id); setNotice(`Press Enter to clear Track ${id}`); }
      return;
    }
    void queueRecord(id);
  }, [deleteMode, queueRecord]);

  const fullMute = useCallback(() => {
    if (!playingRef.current) { setNotice("Start the loop before queuing a full mute"); return; }
    const occupied = tracksRef.current.filter(track => track.hasRecording);
    if (!occupied.length) { setNotice("There are no recorded tracks to mute"); return; }
    const restoring = fullMuteActive.current;
    const affected = restoring
      ? occupied.filter(track => fullMuteRestore.current.has(track.id))
      : occupied.filter(track => track.status !== "muted" && track.status !== "mute-queued");
    if (!restoring) fullMuteRestore.current = new Set(affected.map(track => track.id));
    affected.forEach(track => updateTrack(track.id, { status: restoring ? "unmute-queued" : "mute-queued" }));
    setNotice(`${restoring ? "Full unmute" : "Full mute"} queued for the next bar`);
    window.setTimeout(() => {
      affected.forEach(track => {
        setTrackMutedNode(track.id, !restoring);
        updateTrack(track.id, { status: restoring ? "playing" : "muted" });
      });
      fullMuteActive.current = !restoring;
      if (restoring) fullMuteRestore.current.clear();
      setNotice(restoring ? "Previous tracks restored" : "All active tracks muted — effects are ringing out");
    }, nextBarDelay());
  }, [nextBarDelay, setTrackMutedNode, updateTrack]);

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
    if (activeCapture.current) {
      window.clearTimeout(activeCapture.current.startTimer);
      window.clearTimeout(activeCapture.current.stopTimer);
      activeCapture.current.processor.onaudioprocess = null;
      activeCapture.current.input.disconnect();
      activeCapture.current.processor.disconnect();
      activeCapture.current.silentGain.disconnect();
    }
    playbackNodes.current.forEach(node => { try { node.source.stop(); } catch { /* already stopped */ } });
  }, []);

  const loopProgress = useMemo(() => ((bar - 1) * 4 + beat + 1) / (bars * 4) * 100, [bar, bars, beat]);

  const exportProject = useCallback(async () => {
    try {
      setSaveStatus("EXPORTING");
      const manifest = await persistProject() || buildManifest();
      const bundle = await createProjectBundle(manifest, collectAudio());
      const url = URL.createObjectURL(bundle);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${projectName.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-|-$/g, "") || "ifyloop-project"}.ifyloop`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSaveStatus("SAVED");
    } catch { setSaveStatus("EXPORT ERROR"); }
  }, [buildManifest, collectAudio, persistProject, projectName]);

  return (
    <main>
      <header className="topbar editor-topbar">
        <div className="brand"><span className="brand-mark"><i /><i /><i /><i /></span><span>IFY/<b>LOOP</b></span></div>
        <div className="session-name"><span className="live-dot" />{projectName.toUpperCase()} <small>{saveStatus}</small></div>
        <div className="editor-actions" data-tutorial="project-actions"><button onClick={() => void persistProject()}>SAVE</button><button onClick={() => void exportProject()}>EXPORT</button><button onClick={() => window.dispatchEvent(new Event("ifyloop-tutorial"))} aria-label="Learn to use IfyLoop">?</button><button data-tutorial="home-button" onClick={() => router.push("/")} aria-label="Back to projects">⌂</button></div>
      </header>

      <section className="transport" aria-label="Transport controls">
        <button data-tutorial="play" className={`play ${playing ? "active" : ""}`} onClick={togglePlay} aria-label={playing ? "Pause loop" : "Start loop"}><Icon name={playing ? "pause" : "play"} size={23} /></button>
        <div className="tempo-control" data-tutorial="tempo">
          <span className="control-label">TEMPO</span>
          <div className="tempo-value"><button onClick={() => setBpm(Math.max(40, bpm - 1))}>−</button><EditableNumber value={bpm} onCommit={setBpm} min={40} max={240} label="Tempo in BPM" suffix="BPM" className="tempo-edit" /><button onClick={() => setBpm(Math.min(240, bpm + 1))}>+</button></div>
        </div>
        <div className="divider" />
        <label className="select-control" data-tutorial="loop-length"><span className="control-label">LOOP LENGTH</span><select value={bars} onChange={event => setBars(Number(event.target.value))} disabled={playing}><option value={1}>1 BAR</option><option value={2}>2 BARS</option><option value={4}>4 BARS</option><option value={8}>8 BARS</option><option value={16}>16 BARS</option></select></label>
        <div className="divider" />
        <div className="metro-control" data-tutorial="metronome"><span className="control-label">METRONOME</span><div><button className={`toggle ${metronome ? "on" : ""}`} onClick={() => setMetronome(!metronome)} aria-label="Toggle metronome"><span /></button><Icon name="volume" /><input aria-label="Metronome volume" type="range" min="0" max="100" value={metroVolume} onChange={event => setMetroVolume(Number(event.target.value))} /></div></div>
        <div className="divider" />
        <div className="latency-global" data-tutorial="latency"><span className="control-label">NEW TRACK LATENCY</span><div><button onClick={() => setGlobalLatency(value => clampLatency(value - LATENCY_STEP))} aria-label="Decrease global latency">−</button><EditableNumber value={globalLatency} onCommit={value => setGlobalLatency(clampLatency(value))} min={-LATENCY_LIMIT} max={LATENCY_LIMIT} label="New track latency in milliseconds" suffix="MS" signed className="latency-edit" /><button onClick={() => setGlobalLatency(value => clampLatency(value + LATENCY_STEP))} aria-label="Increase global latency">+</button></div></div>
      </section>

      <section className="workspace">
        <div className="workspace-head">
          <div><p className="eyebrow">LIVE ARRANGEMENT</p><h1>Build your loop</h1><p className="subhead">Everything lands on the one. Stay in the flow.</p></div>
          <div className="bar-counter"><span>BAR</span><strong>{String(bar).padStart(2, "0")}</strong><em>/ {String(bars).padStart(2, "0")}</em></div>
        </div>

        <div className="timeline" aria-label={`Bar ${bar} of ${bars}`}><span style={{ width: `${loopProgress}%` }} /><div className="beat-dots">{[0,1,2,3].map(item => <i key={item} className={item === beat && playing ? "active" : ""} />)}</div></div>

        <div className="track-list" data-tutorial="tracks">
          {tracks.map((track, index) => {
            const empty = track.status === "empty";
            const muted = track.status === "muted" || track.status === "mute-queued";
            const queued = track.status.includes("queued");
            return (
              <div className={`track-shell ${effectsTrack === track.id ? "effects-open" : ""}`} key={track.id} style={{ "--track-color": COLORS[index] } as React.CSSProperties}>
                <article className={`track ${empty ? "empty" : "filled"} ${muted ? "is-muted" : ""} ${selectedTrack === track.id ? "selected" : ""}`} onClick={() => { if (!empty) setSelectedTrack(track.id); }}>
                  <button className="track-key" onClick={() => handleTrackAction(track.id)} aria-label={`${empty ? "Record" : "Mute or unmute"} Track ${track.id}`}>{track.id}</button>
                  <div className="track-info"><strong>{track.name}</strong><span>{track.status === "empty" ? "READY TO RECORD" : track.status.replace("-", " ").toUpperCase()}</span></div>
                  <div className="waveform" aria-hidden>{Array.from({ length: 52 }, (_, i) => <i key={i} style={{ height: empty ? 2 : `${18 + ((i * 17 + track.id * 11) % 42)}%` }} />)}</div>
                  <div className="track-volume"><div><span>VOL</span>{!empty && <EditableNumber value={track.volume} onCommit={value => setTrackVolume(track.id, value)} min={0} max={150} label={`Track ${track.id} volume percentage`} suffix="%" className="volume-edit" />}</div><input aria-label={`Track ${track.id} volume`} type="range" min="0" max="150" value={track.volume} disabled={empty} onChange={event => setTrackVolume(track.id, Number(event.target.value))} /></div>
                  {queued && <span className="queued-pill">NEXT BAR</span>}
                  {!empty && !queued && <div className="track-latency" aria-label={`Track ${track.id} latency`}><button onClick={() => nudgeTrack(track.id, -1)} aria-label={`Shift Track ${track.id} backward 5 milliseconds`}>−</button><EditableNumber value={track.latencyMs} onCommit={value => setTrackLatency(track.id, value)} min={-LATENCY_LIMIT} max={LATENCY_LIMIT} label={`Track ${track.id} latency in milliseconds`} suffix="ms" signed className="track-latency-edit" /><button onClick={() => nudgeTrack(track.id, 1)} aria-label={`Shift Track ${track.id} forward 5 milliseconds`}>+</button></div>}
                  {!empty && <button className={`fx-button ${effectsTrack === track.id ? "active" : ""}`} onClick={() => setEffectsTrack(current => current === track.id ? null : track.id)} aria-label={`${effectsTrack === track.id ? "Close" : "Open"} effects for Track ${track.id}`}>FX</button>}
                  {!empty && <button className="mini-delete" onClick={() => { setDeleteMode(true); setDeleteTarget(track.id); }} aria-label={`Delete Track ${track.id}`}><Icon name="trash" size={17} /></button>}
                  <button className={`track-action ${track.status === "recording" ? "recording" : ""}`} onClick={() => handleTrackAction(track.id)}><span />{empty || track.status === "queued" || track.status === "recording" ? "REC" : muted ? "UNMUTE" : "MUTE"}</button>
                </article>
                {effectsTrack === track.id && track.hasRecording && <section className="effects-panel" aria-label={`Effects for Track ${track.id}`}>
                  <div className="effects-title"><span>TRACK {track.id} / EFFECTS</span><small>Changes are live</small></div>
                  <div className="eq-section"><span className="effect-label">7-BAND EQ</span><div className="eq-bands">{EQ_BANDS.map((frequency, band) => <label className="eq-band" key={frequency}><EditableNumber value={track.eq[band]} onCommit={value => setTrackEq(track.id, band, value)} min={-12} max={12} label={`Track ${track.id} ${frequency} hertz EQ gain`} suffix="dB" signed className="eq-edit" /><input aria-label={`Track ${track.id} ${frequency} hertz EQ`} type="range" min="-12" max="12" step="1" value={track.eq[band]} onChange={event => setTrackEq(track.id, band, Number(event.target.value))} /><span>{frequency >= 1000 ? `${frequency / 1000}k` : frequency}</span></label>)}</div></div>
                  <div className="reverb-section"><span className="effect-label">REVERB</span><div><input aria-label={`Track ${track.id} reverb`} type="range" min="0" max="100" value={track.reverb} onChange={event => setTrackReverb(track.id, Number(event.target.value))} /><EditableNumber value={track.reverb} onCommit={value => setTrackReverb(track.id, value)} min={0} max={100} label={`Track ${track.id} reverb amount`} suffix="%" className="reverb-edit" /></div><small>2.4 SEC DECAY</small></div>
                </section>}
              </div>
            );
          })}
        </div>

        {tracks.length < 9 && <button className="add-track" onClick={() => setTracks(prev => [...prev, makeTrack(prev.length + 1)])}><Icon name="plus" /> ADD TRACK <span>{tracks.length}/9</span></button>}
      </section>

      <footer>
        <div className="status"><span className={playing ? "pulse" : ""} />{notice}</div>
        <div className="shortcuts"><span><kbd>SPACE</kbd> PLAY / PAUSE</span><span><kbd>1–9</kbd> REC / MUTE</span><span><kbd>← →</kbd> LATENCY</span><span><kbd>M</kbd> FULL MUTE</span><span><kbd>D</kbd> DELETE</span></div>
        <span className="mic-status"><Icon name="mic" size={15} /> {micReady ? "MIC READY" : "MIC ON RECORD"}</span>
      </footer>

      {deleteTarget && <div className="modal-backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><span className="warning"><Icon name="trash" size={24} /></span><p className="eyebrow">DESTRUCTIVE ACTION</p><h2 id="delete-title">Clear Track {deleteTarget}?</h2><p>This recording will be removed and the track will become vacant.</p><div><button onClick={() => { setDeleteTarget(null); setDeleteMode(false); }}>CANCEL <kbd>ESC</kbd></button><button className="danger" onClick={() => deleteTrack(deleteTarget)}>CLEAR TRACK <kbd>↵</kbd></button></div></div></div>}
      {loadingProject && <div className="loading-overlay"><div className="loading-mark"><i /><i /><i /><i /></div><strong>Loading {projectName}</strong><span>Decoding tracks into working memory</span></div>}
    </main>
  );
}
