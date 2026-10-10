import JSZip from "jszip";
import type { IfyLoopProject } from "./projects";

export async function createProjectBundle(project: IfyLoopProject, audio: Map<string, Blob>) {
  const zip = new JSZip();
  zip.file("project.json", JSON.stringify(project, null, 2));
  audio.forEach((blob, name) => zip.file(`audio/${name}`, blob));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 4 } });
}

export async function readProjectBundle(file: File) {
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file("project.json");
  if (!manifestFile) throw new Error("This file does not contain an IfyLoop project");
  const project = JSON.parse(await manifestFile.async("text")) as IfyLoopProject;
  if (project.format !== "ifyloop-project" || project.version !== 1) throw new Error("Unsupported IfyLoop project version");
  const audio = new Map<string, Blob>();
  for (const track of project.tracks) if (track.audio) {
    const entry = zip.file(track.audio);
    if (entry) audio.set(track.audio.replace("audio/", ""), await entry.async("blob"));
  }
  return { project, audio };
}
