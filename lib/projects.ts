export type ProjectSource = "opfs" | "folder";

export type SavedTrack = {
  id: number;
  name: string;
  audio?: string;
  latencyMs: number;
  volume: number;
  muted: boolean;
  eq: number[];
  reverb: number;
};

export type IfyLoopProject = {
  format: "ifyloop-project";
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  tempo: number;
  loopBars: number;
  globalLatencyMs: number;
  tracks: SavedTrack[];
};

export type ProjectSummary = Pick<IfyLoopProject, "id" | "name" | "updatedAt" | "tempo" | "loopBars"> & { source: ProjectSource };

export const newProject = (name: string): IfyLoopProject => {
  const now = new Date().toISOString();
  return { format: "ifyloop-project", version: 1, id: crypto.randomUUID(), name: name.trim() || "Untitled Loop", createdAt: now, updatedAt: now, tempo: 120, loopBars: 4, globalLatencyMs: 0, tracks: [] };
};
