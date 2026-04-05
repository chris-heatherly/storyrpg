import type { GeneratedImage, ImagePrompt } from '../agents/ImageGenerator';
import type { AssetRecord, AssetRegistrySnapshot, ImageSlot, ImageSlotStatus, RenderAttemptRecord, SlotReferencePack } from './slotTypes';

let nodeFs: any;
let nodePath: any;
try {
  nodeFs = require('fs');
  nodePath = require('path');
} catch { /* browser/Expo runtime — no node fs */ }

function nowIso(): string {
  return new Date().toISOString();
}

export class AssetRegistry {
  private readonly records = new Map<string, AssetRecord>();
  private readonly storyId?: string;
  private persistPath?: string;

  constructor(storyId?: string, initialRecords?: AssetRecord[], persistPath?: string) {
    this.storyId = storyId;
    this.persistPath = persistPath;
    for (const record of initialRecords || []) {
      this.records.set(record.slot.slotId, {
        ...record,
        attempts: [...record.attempts],
      });
    }
  }

  /**
   * Set the path for incremental JSONL persistence.
   * Every markSuccess/markFailure will append a line to this file.
   */
  setPersistPath(path: string): void {
    this.persistPath = path;
  }

  /**
   * Load registry state from a JSONL file (one JSON record per line).
   * Each line is an AssetRecord. Later lines overwrite earlier ones for the same slotId.
   */
  static fromJSONL(filePath: string, storyId?: string): AssetRegistry {
    const records: AssetRecord[] = [];
    if (nodeFs && typeof nodeFs.existsSync === 'function' && nodeFs.existsSync(filePath)) {
      try {
        const content = nodeFs.readFileSync(filePath, 'utf-8') as string;
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const record = JSON.parse(trimmed) as AssetRecord;
            records.push(record);
          } catch {
            console.warn(`[AssetRegistry] Skipping unparseable JSONL line in ${filePath}`);
          }
        }
      } catch (e) {
        console.error(`[AssetRegistry] Failed to read JSONL from ${filePath}:`, e);
      }
    }
    const dedupedMap = new Map<string, AssetRecord>();
    for (const rec of records) {
      dedupedMap.set(rec.slot.slotId, rec);
    }
    const registry = new AssetRegistry(storyId, Array.from(dedupedMap.values()), filePath);
    return registry;
  }

  private appendToJSONL(record: AssetRecord): void {
    if (!this.persistPath || !nodeFs || typeof nodeFs.appendFileSync !== 'function') return;
    try {
      const dir = nodePath?.dirname(this.persistPath);
      if (dir && typeof nodeFs.mkdirSync === 'function') {
        nodeFs.mkdirSync(dir, { recursive: true });
      }
      nodeFs.appendFileSync(this.persistPath, JSON.stringify(record) + '\n');
    } catch (e) {
      console.error(`[AssetRegistry] appendToJSONL FAILED for "${this.persistPath}":`, e);
    }
  }

  planSlot(slot: ImageSlot): AssetRecord {
    const existing = this.records.get(slot.slotId);
    if (existing) return existing;

    const created: AssetRecord = {
      slot,
      status: 'planned',
      attempts: [],
      updatedAt: nowIso(),
    };
    this.records.set(slot.slotId, created);
    return created;
  }

  markRendering(slotId: string, attempt: Omit<RenderAttemptRecord, 'status'>): void {
    const record = this.requireRecord(slotId);
    record.status = 'rendering';
    record.attempts.push({ ...attempt, status: 'started' });
    record.updatedAt = nowIso();
  }

  markSuccess(
    slotId: string,
    result: GeneratedImage,
    extras?: {
      prompt?: ImagePrompt;
      referencePack?: SlotReferencePack;
      provider?: string;
      model?: string;
    },
  ): void {
    const record = this.requireRecord(slotId);
    record.status = 'succeeded';
    record.latestUrl = result.imageUrl;
    record.latestPath = result.imagePath;
    record.provider = extras?.provider || result.provider || result.metadata?.provider;
    record.model = extras?.model || result.model || result.metadata?.model;
    record.failureReason = undefined;
    record.providerFailureKind = undefined;
    if (extras?.referencePack) {
      record.referencePack = extras.referencePack;
    }
    const prompt = extras?.prompt || result.prompt;
    if (prompt) {
      record.promptSummary = {
        promptChars: prompt.prompt?.length || 0,
        negativeChars: prompt.negativePrompt?.length || 0,
        hasStyle: Boolean(prompt.style),
        hasComposition: Boolean(prompt.composition),
      };
    }
    const last = record.attempts[record.attempts.length - 1];
    if (last && last.status === 'started') {
      last.status = 'succeeded';
      last.completedAt = nowIso();
      last.imageUrl = result.imageUrl;
      last.imagePath = result.imagePath;
      last.provider = record.provider;
      last.model = record.model;
    }
    record.updatedAt = nowIso();
    this.appendToJSONL(record);
  }

  markFailure(
    slotId: string,
    status: Extract<ImageSlotStatus, 'failed_transient' | 'failed_permanent' | 'aborted'>,
    errorMessage: string,
    extras?: {
      providerFailureKind?: string;
      errorClass?: 'transient' | 'permanent' | 'text_instead_of_image';
    },
  ): void {
    const record = this.requireRecord(slotId);
    record.status = status;
    record.failureReason = errorMessage;
    record.providerFailureKind = extras?.providerFailureKind;
    const last = record.attempts[record.attempts.length - 1];
    if (last && last.status === 'started') {
      last.status = 'failed';
      last.completedAt = nowIso();
      last.errorMessage = errorMessage;
      last.providerFailureKind = extras?.providerFailureKind;
      last.errorClass = extras?.errorClass;
    }
    record.updatedAt = nowIso();
    this.appendToJSONL(record);
  }

  markAborted(slotId: string, errorMessage: string): void {
    this.markFailure(slotId, 'aborted', errorMessage);
  }

  get(slotId: string): AssetRecord | undefined {
    return this.records.get(slotId);
  }

  values(): AssetRecord[] {
    return Array.from(this.records.values());
  }

  getResolvedAsset(slotId: string): AssetRecord | undefined {
    const record = this.records.get(slotId);
    if (!record || record.status !== 'succeeded') return undefined;
    return record;
  }

  getMissingRequiredSlots(): AssetRecord[] {
    return this.values().filter((record) => record.slot.required && record.status !== 'succeeded');
  }

  getByFamily(family: ImageSlot['family']): AssetRecord[] {
    return this.values().filter((record) => record.slot.family === family);
  }

  toSnapshot(): AssetRegistrySnapshot {
    return {
      version: 1,
      storyId: this.storyId,
      generatedAt: nowIso(),
      records: this.values(),
    };
  }

  static fromSnapshot(snapshot: AssetRegistrySnapshot): AssetRegistry {
    return new AssetRegistry(snapshot.storyId, snapshot.records);
  }

  private requireRecord(slotId: string): AssetRecord {
    const record = this.records.get(slotId);
    if (!record) {
      throw new Error(`Unknown asset registry slot: ${slotId}`);
    }
    return record;
  }
}
