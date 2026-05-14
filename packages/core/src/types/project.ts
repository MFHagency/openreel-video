import type { Timeline } from "./timeline";
import type { TextClip } from "../text/types";
import type { ShapeClip, SVGClip, StickerClip } from "../graphics/types";

export interface ProjectSettings {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly sampleRate: number;
  readonly channels: number;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly modifiedAt: number;
  readonly settings: ProjectSettings;
  readonly mediaLibrary: MediaLibrary;
  readonly timeline: Timeline;
  readonly textClips?: TextClip[];
  readonly shapeClips?: ShapeClip[];
  readonly svgClips?: SVGClip[];
  readonly stickerClips?: StickerClip[];
  /** Cami platform linkage metadata. Set when project was loaded from a Cami draft. */
  readonly _camiMeta?: CamiMeta;
}

/** Cami platform linkage. Persisted with project to IndexedDB so refresh preserves it. */
export interface CamiMeta {
  readonly draftId: string | null;
  readonly creatorId: string | null;
  readonly contentFileId: string | null;
  /** Phase 5: per-draft HS256 JWT scoped to this draft's creator. Used as Authorization header on all Cami EF calls. Refreshed via load-draft on 401. */
  readonly draft_jwt?: string | null;
}

export interface MediaLibrary {
  readonly items: MediaItem[];
}

export interface MediaItem {
  readonly id: string;
  readonly name: string;
  readonly type: "video" | "audio" | "image";
  readonly fileHandle: FileSystemFileHandle | null;
  readonly blob: Blob | null;
  readonly metadata: MediaMetadata;
  readonly thumbnailUrl: string | null;
  readonly waveformData: Float32Array | null;
  readonly filmstripThumbnails?: FilmstripThumbnail[];
  readonly isPlaceholder?: boolean;
  readonly originalUrl?: string;
  /** File hint stored in JSON for cross-session/cross-machine asset matching */
  readonly sourceFile?: { name: string; size: number; lastModified: number; folder?: string };
  /** True while a background KieAI generation task is in progress */
  readonly isPending?: boolean;
  /** True when polling exhausted all retries — shows manual retry button */
  readonly kieaiError?: boolean;
  /** KieAI task ID used to poll for completion */
  readonly kieaiTaskId?: string;
  /**
   * When true, blob is null and media is served via originalUrl using mediabunny
   * UrlSource (Range requests). Set by importFromCami / loadFromDraft after
   * Phase 4b.4. isPlaceholder=false, blob=null, originalUrl=<R2 URL>.
   */
  readonly streamingOnly?: boolean;
}

/** Thumbnail for filmstrip display in timeline */
export interface FilmstripThumbnail {
  readonly timestamp: number;
  readonly url: string;
}

export interface MediaMetadata {
  readonly duration: number; // In seconds
  readonly width: number; // For video/image
  readonly height: number; // For video/image
  readonly frameRate: number; // For video
  readonly codec: string;
  readonly sampleRate: number; // For audio
  readonly channels: number; // For audio
  readonly fileSize: number;
}
