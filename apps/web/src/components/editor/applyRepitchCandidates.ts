// Applies ai-repitch result candidates as a fresh clip array on the Main Video track.
// Mirrors the candidate→clip mapping in Cami's editor-project-from-content EF
// (buildOpenReelProject, lines 152–193) — kept in sync because the EF version
// produces the canonical shape EVE expects on initial load.

import type { Project, Clip } from "@openreel/core";

export interface RepitchCandidate {
  arc: "hook" | "bridge" | "peak" | "close";
  start_seconds: number;
  end_seconds: number;
  rationale: string;
}

export type RepitchApplyResult =
  | { ok: false; reason: "no_video_track" | "no_video_media" | "no_candidates" | "all_zero_duration" }
  | { ok: true; newClips: Clip[]; trackId: string; newClipCount: number; newTimelineDuration: number };

export function applyRepitchCandidates(
  project: Project,
  candidates: RepitchCandidate[],
): RepitchApplyResult {
  if (!candidates || candidates.length === 0) {
    return { ok: false, reason: "no_candidates" };
  }

  // Find the first video track — Main Video. Fail loud if absent.
  const videoTrack = project.timeline.tracks.find((t) => t.type === "video");
  if (!videoTrack) return { ok: false, reason: "no_video_track" };

  // Find the existing video media item — needed for mediaId on new clips.
  // Take it from the first clip on the video track. If the track has no clips,
  // fall back to the first 'video' MediaItem in the media library.
  const referenceClip = videoTrack.clips[0];
  const mediaId =
    referenceClip?.mediaId ??
    project.mediaLibrary.items.find((m) => m.type === "video")?.id;
  if (!mediaId) return { ok: false, reason: "no_video_media" };

  // Arc → display order (hook first, close last)
  const arcOrder: Record<RepitchCandidate["arc"], number> = {
    hook: 0,
    bridge: 1,
    peak: 2,
    close: 3,
  };
  const sorted = [...candidates].sort((a, b) => arcOrder[a.arc] - arcOrder[b.arc]);

  const nowMs = Date.now();
  const newClips: Clip[] = [];
  let cursor = 0;

  sorted.forEach((cand, idx) => {
    const dur = Math.max(0, cand.end_seconds - cand.start_seconds);
    if (dur <= 0) return; // skip zero-duration

    const clip = {
      id: `clip-${nowMs}-${idx}`,
      mediaId,
      trackId: videoTrack.id,
      startTime: Number(cursor.toFixed(3)),
      duration: Number(dur.toFixed(3)),
      inPoint: Number(cand.start_seconds.toFixed(3)),
      outPoint: Number(cand.end_seconds.toFixed(3)),
      effects: [],
      audioEffects: [],
      transform: makeDefaultTransform(),
      volume: 1.0,
      keyframes: [],
      // Preserve the rationale for downstream display / debugging
      _camiAnnotation: {
        agent: "ai-repitch",
        agentVersion: "v4",
        role: cand.arc,
        rationale: cand.rationale,
      },
    } as unknown as Clip;

    newClips.push(clip);
    cursor += dur;
  });

  if (newClips.length === 0) return { ok: false, reason: "all_zero_duration" };

  return {
    ok: true,
    newClips,
    trackId: videoTrack.id,
    newClipCount: newClips.length,
    newTimelineDuration: Number(cursor.toFixed(3)),
  };
}

// Re-implement makeDefaultTransform locally to avoid coupling to internal types.
// Mirror the editor-project-from-content EF version exactly.
function makeDefaultTransform() {
  return {
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    opacity: 1,
    anchorX: 0.5,
    anchorY: 0.5,
  };
}
