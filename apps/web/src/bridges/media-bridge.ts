import {
  MediaImportService,
  initializeMediaImportService,
  WaveformGenerator,
  getWaveformGenerator,
} from "@openreel/core";
import type {
  ProcessedMedia,
  WaveformData,
  MediaTrackInfo,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

/**
 * Import progress callback type
 */
export type ImportProgressCallback = (
  completed: number,
  total: number,
  currentFile: string,
) => void;

/**
 * Waveform progress callback type
 */
export type WaveformProgressCallback = (progress: number) => void;

/**
 * Import result with additional UI-specific data
 */
export interface MediaBridgeImportResult {
  /** Whether the import was successful */
  success: boolean;
  /** The processed media item if successful */
  media?: ProcessedMedia;
  /** Error message if import failed */
  error?: string;
  /** Warnings during import */
  warnings?: string[];
  /** Whether waveform was generated */
  hasWaveform: boolean;
}

/**
 * MediaBridge class for connecting UI to media import functionality
 */
export class MediaBridge {
  private mediaImportService: MediaImportService | null = null;
  private waveformGenerator: WaveformGenerator | null = null;
  private initialized = false;

  /**
   * Initialize the media bridge
   * Connects to the MediaImportService and WaveformGenerator
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Initialize the media import service
      this.mediaImportService = await initializeMediaImportService();
      this.waveformGenerator = getWaveformGenerator();
      this.initialized = true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown initialization error";
      throw new Error(`MediaBridge initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Check if the bridge is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Import a media file
   *
   * Decode using MediaBunny and extract metadata
   * Feature: core-ui-integration, Property 10: Media Import Metadata Extraction
   *
   * @param file - The file to import
   * @param generateWaveform - Whether to generate waveform data (default: true)
   * @returns Import result with processed media or error
   */
  async importFile(
    file: File,
    generateWaveform = true,
    quickMode = false,
  ): Promise<MediaBridgeImportResult> {
    if (!this.initialized || !this.mediaImportService) {
      return {
        success: false,
        error: "MediaBridge not initialized",
        hasWaveform: false,
      };
    }

    const projectStateBefore = this.captureProjectState();

    try {
      const result = await this.mediaImportService.importMedia(file, {
        generateThumbnails: !quickMode,
        thumbnailCount: 10,
        thumbnailWidth: 160,
        generateWaveform: generateWaveform && !quickMode,
        waveformSamplesPerSecond: 100,
        useFallback: true,
        quickMode,
      });

      if (!result.success || !result.media) {
        return {
          success: false,
          error: result.error || "Import failed",
          warnings: result.warnings,
          hasWaveform: false,
        };
      }

      const metadata = result.media.metadata;
      if (!this.validateMetadata(metadata)) {
        return {
          success: false,
          error: "Failed to extract valid metadata from media file",
          hasWaveform: false,
        };
      }

      return {
        success: true,
        media: result.media,
        warnings: result.warnings,
        hasWaveform: result.media.waveformData !== null,
      };
    } catch (error) {
      this.restoreProjectState(projectStateBefore);

      const errorMessage =
        error instanceof Error ? error.message : "Unknown import error";
      return {
        success: false,
        error: errorMessage,
        hasWaveform: false,
      };
    }
  }

  /**
   * Validate a URL is reachable via mediabunny UrlSource and extract metadata.
   * Used by importFromCami + loadFromDraft before marking items streamingOnly.
   * quickMode=true → metadata-only, no thumbnails or waveform.
   */
  async importFromUrl(
    url: string,
    name: string,
    size: number,
    contentType: string,
    generateWaveform = false,
    quickMode = true,
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.initialized || !this.mediaImportService) {
      return { success: false, error: "MediaBridge not initialized" };
    }
    try {
      const result = await this.mediaImportService.importMediaFromUrl(url, {
        name, size, contentType, generateWaveform, quickMode,
      });
      return result.success ? { success: true } : { success: false, error: result.error };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  async generateThumbnailsForUrl(
    url: string,
    mediaType: "video" | "audio" | "image",
  ): Promise<{ timestamp: number; dataUrl: string }[]> {
    if (!this.initialized || !this.mediaImportService) return [];
    try {
      const thumbnails = await this.mediaImportService.generateThumbnailsForUrl(url, mediaType, { count: 10, width: 160 });
      return thumbnails.map((t) => ({ timestamp: t.timestamp, dataUrl: t.dataUrl || "" })).filter((t) => t.dataUrl);
    } catch {
      return [];
    }
  }

  async generateWaveformForUrl(url: string): Promise<{ peaks: Float32Array } | null> {
    if (!this.initialized || !this.mediaImportService) return null;
    try {
      const data = await this.mediaImportService.generateWaveformForUrl(url);
      return data ? { peaks: data.peaks } : null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch a streaming-only media item's full content into a Blob.
   * Used by the Export path to materialize items that have no local blob yet.
   */
  async materializeStreaming(
    originalUrl: string,
    name: string,
    mimeType: string,
    onProgress?: (percent: number) => void,
  ): Promise<Blob | null> {
    try {
      const resp = await fetch(originalUrl);
      if (!resp.ok) return null;
      const contentLength = Number(resp.headers.get("content-length") ?? 0);
      if (!resp.body) {
        const blob = await resp.blob();
        onProgress?.(100);
        return blob;
      }
      const reader = resp.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength > 0) {
          onProgress?.(Math.round((received / contentLength) * 100));
        }
      }
      onProgress?.(100);
      const totalLength = chunks.reduce((s, c) => s + c.length, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      return new Blob([merged], { type: mimeType || "application/octet-stream" });
    } catch (error) {
      console.error("[MediaBridge] materializeStreaming failed:", error);
      return null;
    }
  }

  async generateThumbnailsForMedia(
    file: File | Blob,
    mediaType: "video" | "audio" | "image",
  ): Promise<{ timestamp: number; dataUrl: string }[]> {
    if (!this.initialized || !this.mediaImportService) {
      return [];
    }

    try {
      const thumbnails = await this.mediaImportService.generateThumbnailsForMedia(
        file,
        mediaType,
        { count: 10, width: 160 },
      );

      return thumbnails.map((thumb) => ({
        timestamp: thumb.timestamp,
        dataUrl: thumb.dataUrl || "",
      })).filter((t) => t.dataUrl);
    } catch {
      return [];
    }
  }

  /**
   * Import multiple media files
   *
   * @param files - Array of files to import
   * @param onProgress - Optional progress callback
   * @returns Array of import results
   */
  async importFiles(
    files: File[],
    onProgress?: ImportProgressCallback,
  ): Promise<MediaBridgeImportResult[]> {
    if (!this.initialized || !this.mediaImportService) {
      return files.map(() => ({
        success: false,
        error: "MediaBridge not initialized",
        hasWaveform: false,
      }));
    }

    const results: MediaBridgeImportResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      onProgress?.(i, files.length, file.name);

      const result = await this.importFile(file);
      results.push(result);
    }

    onProgress?.(files.length, files.length, "Complete");
    return results;
  }

  /**
   * Generate waveform data for a media file
   *
   * Generate waveform visualization asynchronously
   * Feature: core-ui-integration, Property 11: Waveform Generation
   *
   * @param file - The audio/video file
   * @param mediaId - Unique identifier for caching
   * @param samplesPerSecond - Waveform resolution (default: 100)
   * @returns WaveformData with peaks array proportional to duration
   */
  async generateWaveform(
    file: File | Blob,
    mediaId: string,
    samplesPerSecond = 100,
  ): Promise<WaveformData | null> {
    if (!this.initialized || !this.waveformGenerator) {
      return null;
    }

    try {
      const waveformData = await this.waveformGenerator.generateWaveform(
        file,
        mediaId,
        { samplesPerSecond, enableCaching: true },
      );

      // Validate waveform data
      // Store peaks array proportional to duration
      if (!this.validateWaveformData(waveformData)) {
        return null;
      }

      return waveformData;
    } catch (error) {
      console.error("MediaBridge: Waveform generation error:", error);
      return null;
    }
  }

  /**
   * Extract metadata from a media file without full import
   *
   * Extract metadata (duration, dimensions, codec)
   * Feature: core-ui-integration, Property 10: Media Import Metadata Extraction
   *
   * @param file - The file to analyze
   * @returns MediaTrackInfo with extracted metadata
   */
  async extractMetadata(file: File | Blob): Promise<MediaTrackInfo | null> {
    if (!this.initialized || !this.mediaImportService) {
      return null;
    }

    try {
      // Use the media import service to validate and extract metadata
      const result = await this.mediaImportService.importMedia(file as File, {
        generateThumbnails: false,
        generateWaveform: false,
        useFallback: true,
      });

      if (!result.success || !result.media) {
        return null;
      }

      return result.media.metadata;
    } catch (error) {
      console.error("MediaBridge: Metadata extraction error:", error);
      return null;
    }
  }

  /**
   * Validate extracted metadata
   *
   * Extract metadata (duration, dimensions, codec)
   * Feature: core-ui-integration, Property 10: Media Import Metadata Extraction
   *
   * @param metadata - The metadata to validate
   * @returns true if metadata is valid
   */
  validateMetadata(metadata: MediaTrackInfo): boolean {
    // Check if it's an image (no hasVideo, no hasAudio, but has dimensions)
    const isImage =
      !metadata.hasVideo &&
      !metadata.hasAudio &&
      metadata.width > 0 &&
      metadata.height > 0;

    // Duration must be non-null (can be 0 for images)
    if (metadata.duration === null || metadata.duration === undefined) {
      return false;
    }

    // For non-images, duration must be positive
    if (!isImage && metadata.duration <= 0) {
      return false;
    }

    // For images, validate dimensions
    if (isImage) {
      if (
        metadata.width === null ||
        metadata.width === undefined ||
        metadata.width <= 0
      ) {
        return false;
      }
      if (
        metadata.height === null ||
        metadata.height === undefined ||
        metadata.height <= 0
      ) {
        return false;
      }
      return true;
    }

    // For video files, width and height must be positive
    if (metadata.hasVideo) {
      if (
        metadata.width === null ||
        metadata.width === undefined ||
        metadata.width <= 0
      ) {
        return false;
      }
      if (
        metadata.height === null ||
        metadata.height === undefined ||
        metadata.height <= 0
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate waveform data
   *
   * Store peaks array proportional to duration
   * Feature: core-ui-integration, Property 11: Waveform Generation
   *
   * @param waveformData - The waveform data to validate
   * @returns true if waveform data is valid
   */
  validateWaveformData(waveformData: WaveformData): boolean {
    // Peaks array must exist and have length
    if (!waveformData.peaks || waveformData.peaks.length === 0) {
      return false;
    }

    // Duration must be positive
    if (waveformData.duration <= 0) {
      return false;
    }

    // Peaks length should be proportional to duration
    // Expected length = duration * samplesPerSecond
    const expectedLength = Math.ceil(
      waveformData.duration * waveformData.samplesPerSecond,
    );
    const actualLength = waveformData.peaks.length;

    // Allow some tolerance (within 10% or 10 samples)
    const tolerance = Math.max(expectedLength * 0.1, 10);
    if (Math.abs(actualLength - expectedLength) > tolerance) {
      return false;
    }

    return true;
  }

  /**
   * Get supported file formats
   */
  getSupportedFormats(): {
    video: string[];
    audio: string[];
    image: string[];
  } {
    if (!this.mediaImportService) {
      return { video: [], audio: [], image: [] };
    }
    return this.mediaImportService.getSupportedFormats();
  }

  /**
   * Check if a file format is supported
   *
   * @param file - The file to check
   * @returns true if the format is supported
   */
  async isFormatSupported(file: File | Blob): Promise<boolean> {
    if (!this.mediaImportService) {
      return false;
    }

    const validation = await this.mediaImportService.validateFormat(file);
    return validation.supported;
  }

  /**
   * Capture current project state for rollback
   *
   * Maintain current state on failed import
   * Feature: core-ui-integration, Property 13: Failed Import State Preservation
   */
  private captureProjectState(): {
    mediaLibraryIds: string[];
    timelineClipIds: string[];
  } {
    const projectState = useProjectStore.getState();
    const project = projectState.project;

    return {
      mediaLibraryIds: project.mediaLibrary.items.map((m) => m.id),
      timelineClipIds: project.timeline.tracks.flatMap((t) =>
        t.clips.map((c) => c.id),
      ),
    };
  }

  /**
   * Restore project state on failed import
   *
   * Maintain current state on failed import
   * Feature: core-ui-integration, Property 13: Failed Import State Preservation
   *
   * Note: This is a safety mechanism. In practice, we don't modify the project
   * state until import is successful, so this is mainly for edge cases.
   */
  private restoreProjectState(_stateBefore: {
    mediaLibraryIds: string[];
    timelineClipIds: string[];
  }): void {
    // In the current implementation, we don't modify project state until
    // import is successful, so no rollback is needed. This method exists
    // as a safety mechanism for future changes.
  }

  /**
   * Dispose of the media bridge and clean up resources
   */
  dispose(): void {
    this.mediaImportService = null;
    this.waveformGenerator = null;
    this.initialized = false;
  }
}

// Singleton instance
let mediaBridgeInstance: MediaBridge | null = null;

/**
 * Get the shared MediaBridge instance
 */
export function getMediaBridge(): MediaBridge {
  if (!mediaBridgeInstance) {
    mediaBridgeInstance = new MediaBridge();
  }
  return mediaBridgeInstance;
}

/**
 * Initialize the shared MediaBridge
 */
export async function initializeMediaBridge(): Promise<MediaBridge> {
  const bridge = getMediaBridge();
  await bridge.initialize();
  return bridge;
}

/**
 * Dispose of the shared MediaBridge
 */
export function disposeMediaBridge(): void {
  if (mediaBridgeInstance) {
    mediaBridgeInstance.dispose();
    mediaBridgeInstance = null;
  }
}
