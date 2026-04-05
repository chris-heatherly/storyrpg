/**
 * Video Generation Service
 *
 * Handles video generation using Google Veo 3.1 via the Gemini API.
 * Takes a still image and animation instructions, produces an animated MP4 clip.
 * Supports image-to-video mode where the still image serves as the first frame.
 */

import * as ExpoFileSystem from 'expo-file-system';
import { VideoSettingsConfig, DEFAULT_VIDEO_SETTINGS } from '../config';
import { VideoAnimationInstruction } from '../../types';
import { isNativeRuntime, isWebRuntime } from '../../utils/runtimeEnv';
import { PROXY_CONFIG } from '../../config/endpoints';
import type { VideoGenerationDiagnostic } from '../utils/pipelineOutputWriter';

let nodeFs: any;
let nodePath: any;

if (!isNativeRuntime()) {
  try {
    const req = typeof eval !== 'undefined' ? eval('require') : undefined;
    if (typeof req === 'function') {
      const isRealNode = typeof process !== 'undefined' && process.versions && process.versions.node;
      if (isRealNode) {
        nodeFs = req('fs');
        nodePath = req('path');
      }
    }
  } catch (e) {}
}

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface VideoGenerationConfig {
  enabled?: boolean;
  apiKey?: string;
  model?: string;
  durationSeconds?: number;
  resolution?: string;
  aspectRatio?: string;
  outputDirectory?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  retryBackoffMultiplier?: number;
  maxConcurrent?: number;
  /** Max time to wait for a single video generation operation (ms) */
  pollTimeoutMs?: number;
  /** Interval between polling checks (ms) */
  pollIntervalMs?: number;
}

export interface GeneratedVideo {
  instruction: VideoAnimationInstruction;
  videoPath?: string;
  videoUrl?: string;
  durationSeconds?: number;
  metadata?: {
    model: string;
    resolution: string;
    aspectRatio: string;
    generationTimeMs: number;
  };
}

type DownloadableVideoRef =
  | string
  | {
      uri?: string;
      downloadUri?: string;
      mimeType?: string;
      name?: string;
    };

export type VideoJobEvent =
  | { type: 'job_added'; job: { id: string; identifier: string; status: string; sourceImageUrl?: string; metadata?: { sceneId?: string; beatId?: string } } }
  | { type: 'job_updated'; id: string; updates: { status: string; progress?: string; videoUrl?: string } }
  | { type: 'job_removed'; id: string };

export class VideoGenerationService {
  private config: VideoGenerationConfig;
  private outputDir: string;
  private listeners: ((event: VideoJobEvent) => void)[] = [];
  private diagnostics: VideoGenerationDiagnostic[] = [];

  private maxRetries: number;
  private retryDelayMs: number;
  private retryBackoffMultiplier: number;
  private pollTimeoutMs: number;
  private pollIntervalMs: number;
  private lastRequestTime: number = 0;
  private minRequestInterval: number = 5000;

  private _activeConcurrency: number = 0;
  private _concurrencyLimit: number;
  private _concurrencyQueue: Array<() => void> = [];
  private _generatedIdentifiers = new Set<string>();

  public pipelineMetrics = {
    videosGenerated: 0,
    videosFailed: 0,
    totalGenerationTimeMs: 0,
    pollRetries: 0,
  };

  constructor(config: VideoGenerationConfig) {
    this.config = config;
    this.outputDir = config.outputDirectory || './generated-videos';
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 10000;
    this.retryBackoffMultiplier = config.retryBackoffMultiplier ?? 2;
    this.pollTimeoutMs = config.pollTimeoutMs ?? 300_000; // 5 min default
    this.pollIntervalMs = config.pollIntervalMs ?? 10_000; // 10s between polls
    this._concurrencyLimit = config.maxConcurrent ?? DEFAULT_VIDEO_SETTINGS.maxConcurrent;
    this.ensureDirectory(this.outputDir);
  }

  public setOutputDirectory(dir: string): void {
    this.outputDir = dir;
    this.ensureDirectory(dir);
  }

  public onEvent(listener: (event: VideoJobEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private emit(event: VideoJobEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch (_) {}
    }
  }

  public clearDiagnostics(): void {
    this.diagnostics = [];
  }

  public getDiagnostics(): VideoGenerationDiagnostic[] {
    return [...this.diagnostics];
  }

  private recordDiagnostic(diagnostic: VideoGenerationDiagnostic): void {
    this.diagnostics.push(diagnostic);
  }

  /**
   * Generate a video clip from a still image and animation instructions.
   */
  async generateVideo(
    instruction: VideoAnimationInstruction,
    sourceImageData: string,
    sourceMimeType: string,
    identifier: string,
    metadata?: { sceneId?: string; beatId?: string },
    sourceImageUrl?: string,
  ): Promise<GeneratedVideo> {
    if (!this.config.enabled) {
      this.recordDiagnostic({
        timestamp: new Date().toISOString(),
        sceneId: metadata?.sceneId,
        beatId: metadata?.beatId,
        identifier,
        sourceImageUrl,
        stage: 'veo_generation',
        status: 'skipped',
        message: 'Video generation disabled in config',
      });
      return { instruction, videoPath: undefined, videoUrl: undefined };
    }

    const sanitizedId = identifier.replace(/[^a-zA-Z0-9_\-./]/g, '').replace(/-+/g, '-');
    const jobId = `video-${sanitizedId}-${Date.now()}`;

    if (this._generatedIdentifiers.has(sanitizedId)) {
      console.log(`[VideoGenService] Identifier dedup HIT for "${sanitizedId}" — skipping`);
      this.recordDiagnostic({
        timestamp: new Date().toISOString(),
        sceneId: metadata?.sceneId,
        beatId: metadata?.beatId,
        identifier: sanitizedId,
        sourceImageUrl,
        stage: 'veo_generation',
        status: 'skipped',
        message: 'Skipped duplicate video identifier',
      });
      return { instruction, videoPath: undefined, videoUrl: undefined };
    }
    this._generatedIdentifiers.add(sanitizedId);

    this.emit({ type: 'job_added', job: { id: jobId, identifier: sanitizedId, status: 'pending', sourceImageUrl, metadata } });

    await this.acquireConcurrencySlot();
    const startTime = Date.now();
    try {
      const result = await this.generateWithVeo(instruction, sourceImageData, sourceMimeType, sanitizedId, jobId);
      this.pipelineMetrics.videosGenerated++;
      this.pipelineMetrics.totalGenerationTimeMs += Date.now() - startTime;
      this.emit({ type: 'job_updated', id: jobId, updates: { status: 'completed', videoUrl: result.videoUrl } });
      this.recordDiagnostic({
        timestamp: new Date().toISOString(),
        sceneId: metadata?.sceneId,
        beatId: metadata?.beatId,
        identifier: sanitizedId,
        sourceImageUrl,
        stage: 'veo_generation',
        status: 'completed',
        message: 'Video generated successfully',
        model: result.metadata?.model,
        durationSeconds: result.durationSeconds,
        resolution: result.metadata?.resolution,
        aspectRatio: result.metadata?.aspectRatio,
        videoPath: result.videoPath,
        videoUrl: result.videoUrl,
      });
      return result;
    } catch (error) {
      this.pipelineMetrics.videosFailed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[VideoGenService] Video generation failed for ${sanitizedId}: ${errorMsg}`);
      this.emit({ type: 'job_updated', id: jobId, updates: { status: 'failed', progress: errorMsg } });
      this.recordDiagnostic({
        timestamp: new Date().toISOString(),
        sceneId: metadata?.sceneId,
        beatId: metadata?.beatId,
        identifier: sanitizedId,
        sourceImageUrl,
        stage: 'veo_generation',
        status: 'failed',
        message: errorMsg,
        attempts: this.maxRetries,
        model: this.config.model || DEFAULT_VIDEO_SETTINGS.model,
        durationSeconds: this.config.durationSeconds || DEFAULT_VIDEO_SETTINGS.durationSeconds,
        resolution: this.config.resolution || DEFAULT_VIDEO_SETTINGS.resolution,
        aspectRatio: this.config.aspectRatio || DEFAULT_VIDEO_SETTINGS.aspectRatio,
      });
      return { instruction, videoPath: undefined, videoUrl: undefined };
    } finally {
      this.releaseConcurrencySlot();
    }
  }

  private async generateWithVeo(
    instruction: VideoAnimationInstruction,
    sourceImageData: string,
    sourceMimeType: string,
    identifier: string,
    jobId: string
  ): Promise<GeneratedVideo> {
    const env = typeof process !== 'undefined' ? process.env : {} as any;
    const apiKey = this.config.apiKey || env.EXPO_PUBLIC_GEMINI_API_KEY || env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('No API key configured for Veo video generation');
    }

    const model = this.config.model || DEFAULT_VIDEO_SETTINGS.model;
    const duration = this.config.durationSeconds || DEFAULT_VIDEO_SETTINGS.durationSeconds;
    const resolution = this.config.resolution || DEFAULT_VIDEO_SETTINGS.resolution;
    const aspectRatio = this.config.aspectRatio || DEFAULT_VIDEO_SETTINGS.aspectRatio;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await this.enforceRateLimit();

        this.emit({ type: 'job_updated', id: jobId, updates: { status: 'generating', progress: `Attempt ${attempt}/${this.maxRetries}` } });

        // Strip data URI prefix if present
        const cleanBase64 = sourceImageData.replace(/^data:[^;]+;base64,/, '');

        const requestBody = {
          instances: [{
            prompt: instruction.composedPrompt,
            image: {
              bytesBase64Encoded: cleanBase64,
              mimeType: sourceMimeType,
            },
          }],
          parameters: {
            sampleCount: 1,
            durationSeconds: duration,
            resolution,
            aspectRatio,
          },
        };

        const url = `${GEMINI_API_BASE}/${model}:predictLongRunning?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Veo API returned ${response.status}: ${errorBody}`);
        }

        const operation = await response.json();
        const operationName = operation.name;

        if (!operationName) {
          throw new Error('Veo API did not return an operation name');
        }

        this.emit({ type: 'job_updated', id: jobId, updates: { status: 'polling', progress: `Operation: ${operationName}` } });

        const result = await this.pollOperation(operationName, apiKey, jobId);
        const filteredReason = this.extractFilteredReason(result);
        if (filteredReason) {
          throw new Error(`Veo media filtered response: ${filteredReason}`);
        }

        const videoData = await this.extractVideoFromResult(result, apiKey);
        if (!videoData) {
          throw new Error(this.summarizeNoVideoResult(result));
        }

        const videoPath = await this.saveVideo(videoData.base64, identifier);
        const videoUrl = this.toVideoHttpUrl(videoPath);

        return {
          instruction,
          videoPath,
          videoUrl,
          durationSeconds: duration,
          metadata: {
            model,
            resolution,
            aspectRatio,
            generationTimeMs: Date.now() - (this.lastRequestTime || Date.now()),
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`[VideoGenService] Attempt ${attempt}/${this.maxRetries} failed: ${lastError.message}`);

        if (attempt < this.maxRetries) {
          const delay = this.retryDelayMs * Math.pow(this.retryBackoffMultiplier, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Video generation failed after all retries');
  }

  private async pollOperation(
    operationName: string,
    apiKey: string,
    jobId: string
  ): Promise<any> {
    const startTime = Date.now();

    while (Date.now() - startTime < this.pollTimeoutMs) {
      await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
      this.pipelineMetrics.pollRetries++;

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKey}`;
        const response = await fetch(url, { method: 'GET' });

        if (!response.ok) {
          console.warn(`[VideoGenService] Poll returned ${response.status}, will retry...`);
          continue;
        }

        const result = await response.json();
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        this.emit({ type: 'job_updated', id: jobId, updates: { status: 'polling', progress: `Waiting... ${elapsed}s elapsed` } });

        if (result.done) {
          if (result.error) {
            throw new Error(`Veo operation failed: ${JSON.stringify(result.error)}`);
          }
          return result;
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Veo operation failed:')) {
          throw error;
        }
        console.warn(`[VideoGenService] Poll error (will retry): ${error instanceof Error ? error.message : error}`);
      }
    }

    throw new Error(`Veo operation timed out after ${this.pollTimeoutMs / 1000}s`);
  }

  private async extractVideoFromResult(result: any, apiKey: string): Promise<{ base64: string; mimeType: string } | null> {
    try {
      const generatedVideos = result?.response?.generatedVideos
        || result?.response?.generated_videos
        || result?.metadata?.generatedVideos
        || result?.metadata?.generated_videos
        || result?.generatedVideos
        || result?.generated_videos
        || result?.response?.generatedSamples
        || result?.response?.generated_samples
        || result?.generatedSamples
        || result?.generated_samples;

      if (generatedVideos && generatedVideos.length > 0) {
        const video = generatedVideos[0];

        if (video.video?.bytesBase64Encoded) {
          return {
            base64: video.video.bytesBase64Encoded,
            mimeType: video.video.mimeType || 'video/mp4',
          };
        }

        const fileRef = video.video || video.file || video.generatedVideo || video.generated_video;
        const downloaded = await this.downloadVideoReference(fileRef, apiKey);
        if (downloaded) {
          return downloaded;
        }
      }
    } catch (e) {
      console.error(`[VideoGenService] Error extracting video data: ${e}`);
    }
    return null;
  }

  private extractFilteredReason(result: any): string | null {
    const response = result?.response?.generateVideoResponse
      || result?.response?.generate_video_response
      || result?.generateVideoResponse
      || result?.generate_video_response;
    const reasons = response?.raiMediaFilteredReasons || response?.rai_media_filtered_reasons;
    if (Array.isArray(reasons) && reasons.length > 0) {
      return reasons.join(' | ');
    }
    const count = response?.raiMediaFilteredCount || response?.rai_media_filtered_count;
    if (typeof count === 'number' && count > 0) {
      return 'Veo returned a media-filtered result without a detailed reason';
    }
    return null;
  }

  private summarizeNoVideoResult(result: any): string {
    const filteredReason = this.extractFilteredReason(result);
    if (filteredReason) {
      return `No video data returned because Veo filtered the result: ${filteredReason}`;
    }
    const response = result?.response?.generateVideoResponse
      || result?.response?.generate_video_response
      || result?.response;
    if (response) {
      try {
        return `No video data in Veo response: ${JSON.stringify(response).slice(0, 400)}`;
      } catch (_) {}
    }
    return 'No video data in Veo response';
  }

  private async downloadVideoReference(
    fileRef: DownloadableVideoRef | undefined,
    apiKey: string,
  ): Promise<{ base64: string; mimeType: string } | null> {
    if (!fileRef) return null;

    const ref = typeof fileRef === 'string' ? { uri: fileRef } : fileRef;
    const downloadUrl = this.getDownloadUrl(ref, apiKey);
    if (!downloadUrl) return null;

    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64 = this.arrayBufferToBase64(arrayBuffer);
      const mimeType = response.headers.get('content-type')?.split(';')[0]
        || ref.mimeType
        || 'video/mp4';

      return { base64, mimeType };
    } catch (error) {
      console.warn(`[VideoGenService] Failed to download generated video file: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  private getDownloadUrl(
    fileRef: { uri?: string; downloadUri?: string; name?: string },
    apiKey: string,
  ): string | null {
    const withKey = (url: string): string => {
      const separator = url.includes('?') ? '&' : '?';
      return url.includes('key=') ? url : `${url}${separator}key=${encodeURIComponent(apiKey)}`;
    };

    if (fileRef.downloadUri) {
      return withKey(fileRef.downloadUri);
    }

    if (fileRef.uri) {
      return withKey(fileRef.uri);
    }

    if (fileRef.name) {
      return `https://generativelanguage.googleapis.com/v1beta/${fileRef.name}?alt=media&key=${encodeURIComponent(apiKey)}`;
    }

    return null;
  }

  private arrayBufferToBase64(arrayBuffer: ArrayBuffer): string {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    if (typeof btoa === 'function') {
      return btoa(binary);
    }

    return Buffer.from(arrayBuffer).toString('base64');
  }

  private async saveVideo(base64Data: string, identifier: string): Promise<string> {
    await this.ensureDirectory(this.outputDir);
    const filename = `${identifier}.mp4`;
    const filePath = this.joinPath(this.outputDir, filename);
    await this.writeFile(filePath, base64Data, true);
    console.log(`[VideoGenService] Saved video: ${filePath}`);
    return filePath;
  }

  private toVideoHttpUrl(videoPath: string): string {
    const gsIndex = videoPath.indexOf('generated-stories/');
    if (gsIndex >= 0) {
      const relativePath = videoPath.slice(gsIndex);
      return `${PROXY_CONFIG.getProxyUrl()}/${relativePath}`;
    }
    return videoPath;
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minRequestInterval) {
      await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  // --- Concurrency control (same pattern as ImageGenerationService) ---

  private async acquireConcurrencySlot(): Promise<void> {
    if (this._activeConcurrency < this._concurrencyLimit) {
      this._activeConcurrency++;
      return;
    }
    return new Promise(resolve => {
      this._concurrencyQueue.push(() => {
        this._activeConcurrency++;
        resolve();
      });
    });
  }

  private releaseConcurrencySlot(): void {
    this._activeConcurrency--;
    const next = this._concurrencyQueue.shift();
    if (next) next();
  }

  // --- File system helpers (mirrors ImageGenerationService patterns) ---

  private async ensureDirectory(dirPath: string): Promise<void> {
    if (nodeFs && typeof nodeFs.existsSync === 'function') {
      try {
        if (nodeFs.existsSync(dirPath)) return;
        if (typeof nodeFs.mkdirSync === 'function') nodeFs.mkdirSync(dirPath, { recursive: true });
        return;
      } catch (e) {}
    }
    if (!isWebRuntime()) {
      try {
        const info = await ExpoFileSystem.getInfoAsync(dirPath);
        if (!info.exists) await ExpoFileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
      } catch (e) {}
    }
  }

  private async writeFile(filePath: string, content: string, isBase64: boolean = false): Promise<void> {
    if (nodeFs && typeof nodeFs.writeFileSync === 'function') {
      try {
        if (isBase64) {
          const buffer = Buffer.from(content, 'base64');
          nodeFs.writeFileSync(filePath, buffer);
        } else {
          nodeFs.writeFileSync(filePath, content);
        }
        return;
      } catch (e) {}
    }
    if (isWebRuntime()) {
      try {
        await fetch(PROXY_CONFIG.writeFile, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath, content, isBase64 }),
        });
      } catch (e) {}
      return;
    }
    try {
      const options = isBase64 ? { encoding: 'base64' as any } : { encoding: 'utf8' as any };
      await ExpoFileSystem.writeAsStringAsync(filePath, content, options);
    } catch (e) {}
  }

  private joinPath(base: string, ...parts: string[]): string {
    if (nodePath && typeof nodePath.join === 'function') return nodePath.join(base, ...parts);
    let result = base;
    for (const part of parts) {
      if (!result.endsWith('/') && !part.startsWith('/')) result += '/';
      else if (result.endsWith('/') && part.startsWith('/')) result = result.slice(0, -1);
      result += part;
    }
    return result;
  }

  /**
   * Read a file as base64 (for loading still images to pass to Veo).
   * Handles both HTTP URLs and local file paths.
   */
  async readFileAsBase64(filePath: string): Promise<{ data: string; mimeType: string } | null> {
    const inferMime = (pathOrUrl: string): string => {
      const ext = pathOrUrl.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
      if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
      if (ext === 'webp') return 'image/webp';
      return 'image/png';
    };

    try {
      if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
        const resp = await fetch(filePath);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const arrayBuffer = await resp.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const data = typeof btoa === 'function'
          ? btoa(binary)
          : Buffer.from(arrayBuffer).toString('base64');
        const mimeType = resp.headers.get('content-type')?.split(';')[0] || inferMime(filePath);
        return { data, mimeType };
      }

      if (nodeFs && typeof nodeFs.readFileSync === 'function') {
        const buffer = nodeFs.readFileSync(filePath);
        return { data: buffer.toString('base64'), mimeType: inferMime(filePath) };
      }
      if (!isWebRuntime()) {
        const data = await ExpoFileSystem.readAsStringAsync(filePath, { encoding: 'base64' as any });
        return { data, mimeType: inferMime(filePath) };
      }
    } catch (e) {
      console.error(`[VideoGenService] Failed to read file ${filePath}: ${e}`);
    }
    return null;
  }
}
