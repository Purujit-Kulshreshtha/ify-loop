"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type Step = { page: "home" | "editor" | "any"; target?: string; title: string; body: string; mode?: "next" | "wait-project" | "wait-open" | "go-home"; tip?: string };

const STORAGE_KEY = "ifyloop.tutorial";
const steps: Step[] = [
  { page: "home", target: "[data-tutorial='library-hero']", title: "Welcome to IfyLoop", body: "This is your local project library. Nothing is uploaded: sessions live in this browser or inside a folder you choose." },
  { page: "home", target: "[data-tutorial='folder']", title: "Link a projects folder", body: "Choose a folder to keep visible project.json and WAV files on your computer. If you skip this, projects still autosave privately in the browser." },
  { page: "home", target: "[data-tutorial='import']", title: "Move projects anywhere", body: "Import an .ifyloop bundle from another machine. Inside the editor, Export creates the same portable file with the manifest and every recorded WAV." },
  { page: "home", target: "[data-tutorial='new-project']", title: "Create your first project", body: "Give the loop a name and press Create Project. The tutorial will continue automatically inside your new session.", mode: "wait-project", tip: "Type a name and create a project to continue" },
  { page: "editor", target: "[data-tutorial='play']", title: "Start the transport", body: "Spacebar or this button starts the loop. Recording is only available while the transport is running, and every performance action lands on a musical bar boundary." },
  { page: "editor", target: "[data-tutorial='tempo']", title: "Set the tempo", body: "Use − and +, or click the BPM number to type an exact tempo. Set this before recording so the loop duration remains stable." },
  { page: "editor", target: "[data-tutorial='loop-length']", title: "Choose the loop length", body: "Select how many bars one complete loop contains. It locks while the transport is playing to protect synchronization." },
  { page: "editor", target: "[data-tutorial='metronome']", title: "Keep time", body: "Toggle the metronome and adjust its level. The higher click marks beat one, where queued recordings and mute changes become active." },
  { page: "editor", target: "[data-tutorial='tracks']", title: "Record and manage tracks", body: "Click a track number—or press 1–9—to arm an empty track. Once recorded, the same control queues mute or unmute. D, a track number, and Enter clears a take." },
  { page: "editor", target: "[data-tutorial='latency']", title: "Compensate for latency", body: "Audio interfaces and browsers add a small delay. Set the global value once for every new recording, then select a recorded track and use its ± controls or arrow keys for fine adjustment. Negative values pull audio earlier; positive values delay it." },
  { page: "editor", target: "[data-tutorial='tracks']", title: "Shape each track", body: "Every recorded track gets volume, latency, and an FX drawer with seven EQ bands and reverb. Muting stops new input while the existing reverb tail continues naturally." },
  { page: "editor", target: "[data-tutorial='project-actions']", title: "Save and export", body: "Changes autosave after you edit. Save writes immediately; Export downloads a portable .ifyloop project. Watch the status beside the project name for confirmation." },
  { page: "editor", target: "[data-tutorial='home-button']", title: "Return to the library", body: "Go home to see the updated project card and open any saved session. Let's head back now.", mode: "go-home" },
  { page: "home", target: "[data-tutorial='project-grid']", title: "Open an existing project", body: "Your projects are sorted by recent activity. Select the project you just created; its WAV tracks will be decoded into working memory before the editor appears.", mode: "wait-open", tip: "Open a project to continue" },
  { page: "editor", title: "You’re ready to loop", body: "Start the transport, build one track at a time, and trust the bar. You can replay this guided tour anytime from the ? button." }
];

export default function Tutorial() {
  const pathname = usePathname();
  const router = useRouter();
  const [prompt, setPrompt] = useState(false);
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const current = steps[step];
  const page = pathname === "/" ? "home" : pathname.startsWith("/project/") ? "editor" : "any";

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) setPrompt(true);
    else {
      try {
        const parsed = JSON.parse(saved) as { status?: string; step?: number };
        if (parsed.status === "active") {
          const stored = Math.max(0, Math.min(steps.length - 1, parsed.step ?? 0));
          const here = window.location.pathname.startsWith("/project/") ? "editor" : "home";
          const resumeAt = steps[stored].page === here ? stored : here === "editor" ? 4 : 0;
          setStep(resumeAt); setActive(true);
        }
      } catch { localStorage.removeItem(STORAGE_KEY); setPrompt(true); }
    }
    const launch = () => {
      const start = window.location.pathname.startsWith("/project/") ? 4 : 0;
      setPrompt(false); setStep(start); setActive(true); localStorage.setItem(STORAGE_KEY, JSON.stringify({ status: "active", step: start }));
    };
    window.addEventListener("ifyloop-tutorial", launch);
    return () => window.removeEventListener("ifyloop-tutorial", launch);
  }, []);

  useEffect(() => {
    if (!active) return;
    if (current.mode === "wait-project" && page === "editor") setStep(value => value + 1);
    if (current.mode === "wait-open" && page === "editor") setStep(value => value + 1);
  }, [active, current.mode, page]);

  useEffect(() => { if (active) localStorage.setItem(STORAGE_KEY, JSON.stringify({ status: "active", step })); }, [active, step]);

  const updateRect = useCallback(() => {
    if (!active || !current.target || current.page !== page) { setRect(null); return; }
    const element = document.querySelector(current.target);
    if (!element) { setRect(null); return; }
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setRect(element.getBoundingClientRect()), 250);
  }, [active, current, page]);

  useLayoutEffect(() => { updateRect(); window.addEventListener("resize", updateRect); return () => window.removeEventListener("resize", updateRect); }, [updateRect]);

  const finish = () => { setActive(false); setPrompt(false); localStorage.setItem(STORAGE_KEY, JSON.stringify({ status: "complete" })); };
  const skip = () => { setActive(false); setPrompt(false); localStorage.setItem(STORAGE_KEY, JSON.stringify({ status: "skipped" })); };
  const next = () => {
    if (current.mode === "go-home") { router.push("/"); setStep(value => value + 1); return; }
    if (step === steps.length - 1) { finish(); return; }
    setStep(value => value + 1);
  };

  if (prompt) return <div className="tutorial-prompt-backdrop"><div className="tutorial-prompt"><span className="tutorial-spark">↗</span><p className="eyebrow">FIRST TIME HERE?</p><h2>Learn to use IfyLoop</h2><p>Take a quick interactive tour through projects, recording, timing, effects, and local saving.</p><div><button onClick={skip}>SKIP FOR NOW</button><button className="primary" onClick={() => { setPrompt(false); setActive(true); setStep(0); }}>LEARN TO USE</button></div></div></div>;
  if (!active || current.page !== "any" && current.page !== page) return null;

  const tipTop = rect ? Math.min(window.innerHeight - 290, rect.bottom + 18) : window.innerHeight / 2 - 145;
  const tipLeft = rect ? Math.max(16, Math.min(window.innerWidth - 376, rect.left)) : window.innerWidth / 2 - 180;
  const waiting = current.mode === "wait-project" || current.mode === "wait-open";
  return <div className="tutorial-layer" aria-live="polite">
    {rect && <div className="tutorial-spotlight" style={{ top: rect.top - 7, left: rect.left - 7, width: rect.width + 14, height: rect.height + 14 }} />}
    <aside className="tutorial-tip" style={{ top: Math.max(16, tipTop), left: tipLeft }}>
      <div className="tutorial-progress"><span>TIP {String(step + 1).padStart(2, "0")}</span><span>{step + 1} / {steps.length}</span></div>
      <h3>{current.title}</h3><p>{current.body}</p>
      {current.tip && <div className="tutorial-wait"><i />{current.tip}</div>}
      <div className="tutorial-buttons"><button onClick={skip}>EXIT TOUR</button><div>{step > 0 && !waiting && steps[step - 1].page === page && <button onClick={() => setStep(value => value - 1)}>BACK</button>}<button className="primary" disabled={waiting} onClick={next}>{step === steps.length - 1 ? "FINISH" : current.mode === "go-home" ? "GO TO LIBRARY" : "NEXT"}</button></div></div>
    </aside>
  </div>;
}
