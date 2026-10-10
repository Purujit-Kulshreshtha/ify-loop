"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FOLDER_CONFIG_KEY, getRememberedFolder, listProjects, rememberFolder, saveProject } from "@/lib/project-storage";
import { newProject, type ProjectSource, type ProjectSummary } from "@/lib/projects";
import { readProjectBundle } from "@/lib/project-bundle";

export default function ProjectLibrary() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [name, setName] = useState("");
  const [folderName, setFolderName] = useState<string | null>(null);
  const [folderReady, setFolderReady] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const local = await listProjects("opfs");
      let linked: ProjectSummary[] = [];
      const config = localStorage.getItem(FOLDER_CONFIG_KEY);
      if (config) {
        const parsed = JSON.parse(config) as { name: string };
        setFolderName(parsed.name);
        const handle = await getRememberedFolder();
        if (handle && await (handle as any).queryPermission({ mode: "readwrite" }) === "granted") {
          setFolderReady(true);
          linked = await listProjects("folder");
        }
      }
      setProjects([...linked, ...local].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load projects"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const connectFolder = async () => {
    try {
      setBusy("Opening folder…");
      let handle = await getRememberedFolder();
      if (!handle || await (handle as any).requestPermission({ mode: "readwrite" }) !== "granted") {
        const picker = (window as any).showDirectoryPicker;
        if (!picker) throw new Error("Folder linking is not supported in this browser. You can still use local projects and .ifyloop files.");
        handle = await picker({ mode: "readwrite", id: "ifyloop-projects", startIn: "music" });
      }
      await rememberFolder(handle!);
      setFolderName(handle!.name); setFolderReady(true); setMessage(`Linked ${handle!.name}`);
      await refresh();
    } catch (error) { if ((error as DOMException).name !== "AbortError") setMessage(error instanceof Error ? error.message : "Could not link folder"); }
    finally { setBusy(""); }
  };

  const create = async () => {
    const project = newProject(name);
    const source: ProjectSource = folderReady ? "folder" : "opfs";
    setBusy("Creating project…");
    try { await saveProject(source, project); router.push(`/project/${project.id}?source=${source}`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not create project"); setBusy(""); }
  };

  const importBundle = async (file?: File) => {
    if (!file) return;
    setBusy("Importing project…");
    try {
      const { project, audio } = await readProjectBundle(file);
      project.id = crypto.randomUUID(); project.updatedAt = new Date().toISOString();
      const source: ProjectSource = folderReady ? "folder" : "opfs";
      await saveProject(source, project, audio);
      router.push(`/project/${project.id}?source=${source}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not import project"); setBusy(""); }
  };

  return <main className="library-page">
    <header className="library-nav"><div className="brand"><span className="brand-mark"><i /><i /><i /><i /></span><span>IFY/<b>LOOP</b></span></div><span>LOCAL PROJECT LIBRARY</span></header>
    <section className="library-hero" data-tutorial="library-hero"><p className="eyebrow">YOUR SOUND, STORED LOCALLY</p><h1>Pick up where<br />the loop left off.</h1><p>Projects autosave on this device. Link a folder for a visible library, or move sessions between machines with an .ifyloop file.</p>
      <div className="new-project" data-tutorial="new-project"><input aria-label="New project name" placeholder="Name your next loop" value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void create(); }} /><button onClick={() => void create()} disabled={!!busy}>CREATE PROJECT <span>↗</span></button></div>
    </section>
    <section className="library-content">
      <div className="library-heading"><div><p className="eyebrow">PROJECTS</p><h2>Your sessions</h2></div><div className="library-actions"><button data-tutorial="import" onClick={() => fileInput.current?.click()}>IMPORT .IFYLOOP</button><button data-tutorial="folder" className={folderReady ? "connected" : ""} onClick={() => void connectFolder()}>{folderReady ? `● ${folderName}` : folderName ? `RECONNECT ${folderName}` : "LINK PROJECTS FOLDER"}</button><input ref={fileInput} type="file" accept=".ifyloop,application/zip" hidden onChange={event => void importBundle(event.target.files?.[0])} /></div></div>
      {message && <div className="library-message">{message}<button onClick={() => setMessage("")}>×</button></div>}
      {loading ? <div className="project-grid" data-tutorial="project-grid">{[1,2,3].map(item => <div className="project-card skeleton" key={item} />)}</div> : projects.length ? <div className="project-grid" data-tutorial="project-grid">{projects.map(project => <button className="project-card" key={`${project.source}-${project.id}`} onClick={() => { setBusy(`Loading ${project.name}…`); router.push(`/project/${project.id}?source=${project.source}`); }}><div className="project-wave">{Array.from({length:28},(_,i)=><i key={i} style={{height:`${20+(i*23)%68}%`}} />)}</div><span className="source-pill">{project.source === "folder" ? folderName || "FOLDER" : "THIS BROWSER"}</span><h3>{project.name}</h3><p>{project.tempo} BPM · {project.loopBars} BARS</p><time>{new Date(project.updatedAt).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}</time></button>)}</div> : <div className="empty-library" data-tutorial="project-grid"><span>01</span><h3>No saved loops yet</h3><p>Create a project above, or import an .ifyloop session.</p></div>}
    </section>
    {busy && <div className="loading-overlay"><div className="loading-mark"><i /><i /><i /><i /></div><strong>{busy}</strong><span>Preparing audio and project data</span></div>}
  </main>;
}
