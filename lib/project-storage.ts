import type { IfyLoopProject, ProjectSource, ProjectSummary } from "./projects";

const DB_NAME = "ifyloop-handles";
const HANDLE_KEY = "projects-folder";
export const FOLDER_CONFIG_KEY = "ifyloop.projects-folder";

function openHandlesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("handles");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function rememberFolder(handle: FileSystemDirectoryHandle) {
  const db = await openHandlesDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  localStorage.setItem(FOLDER_CONFIG_KEY, JSON.stringify({ name: handle.name, configured: true }));
}

export async function getRememberedFolder(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openHandlesDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction("handles").objectStore("handles").get(HANDLE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function opfsProjects() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("projects", { create: true });
}

async function sourceRoot(source: ProjectSource) {
  if (source === "opfs") return opfsProjects();
  const folder = await getRememberedFolder();
  if (!folder) throw new Error("Projects folder is not connected");
  return folder;
}

async function readJson(handle: FileSystemDirectoryHandle) {
  const fileHandle = await handle.getFileHandle("project.json");
  return JSON.parse(await (await fileHandle.getFile()).text()) as IfyLoopProject;
}

export async function listProjects(source: ProjectSource): Promise<ProjectSummary[]> {
  const root = await sourceRoot(source);
  const projects: ProjectSummary[] = [];
  for await (const entry of (root as any).values()) {
    if (entry.kind !== "directory") continue;
    try {
      const project = await readJson(entry);
      if (project.format === "ifyloop-project") projects.push({ id: project.id, name: project.name, updatedAt: project.updatedAt, tempo: project.tempo, loopBars: project.loopBars, source });
    } catch { /* Ignore unrelated folders. */ }
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveProject(source: ProjectSource, project: IfyLoopProject, audio: Map<string, Blob> = new Map()) {
  const root = await sourceRoot(source);
  const directory = await root.getDirectoryHandle(project.id, { create: true });
  const audioDirectory = await directory.getDirectoryHandle("audio", { create: true });
  for (const [name, blob] of Array.from(audio.entries())) {
    const fileHandle = await audioDirectory.getFileHandle(name, { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write(blob);
    await writer.close();
  }
  const manifestHandle = await directory.getFileHandle("project.json", { create: true });
  const writer = await manifestHandle.createWritable();
  await writer.write(JSON.stringify(project, null, 2));
  await writer.close();
}

export async function loadProject(source: ProjectSource, id: string) {
  const root = await sourceRoot(source);
  const directory = await root.getDirectoryHandle(id);
  const project = await readJson(directory);
  const audio = new Map<string, ArrayBuffer>();
  for (const track of project.tracks) {
    if (!track.audio) continue;
    const audioDir = await directory.getDirectoryHandle("audio");
    const file = await (await audioDir.getFileHandle(track.audio.replace("audio/", ""))).getFile();
    audio.set(track.audio, await file.arrayBuffer());
  }
  return { project, audio };
}

export async function copyProjectToSource(project: IfyLoopProject, audio: Map<string, Blob>, source: ProjectSource) {
  await saveProject(source, project, audio);
}
