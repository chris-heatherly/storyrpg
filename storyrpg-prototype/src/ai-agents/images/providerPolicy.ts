import type { ImageSlotFamily } from './slotTypes';

export type ProviderHealthState = 'healthy' | 'degraded' | 'quarantined';

export interface ProviderHealthRecord {
  provider: string;
  family?: ImageSlotFamily;
  state: ProviderHealthState;
  transientFailures: number;
  permanentFailures: number;
  successes: number;
  quarantineUntilMs?: number;
}

export class ProviderPolicy {
  private readonly records = new Map<string, ProviderHealthRecord>();
  private readonly quarantineMs: number;
  private readonly transientThreshold: number;

  constructor(options?: { quarantineMs?: number; transientThreshold?: number }) {
    this.quarantineMs = options?.quarantineMs ?? 5 * 60 * 1000;
    this.transientThreshold = options?.transientThreshold ?? 3;
  }

  observeSuccess(provider: string, family?: ImageSlotFamily): void {
    const record = this.getRecord(provider, family);
    record.successes += 1;
    record.transientFailures = 0;
    record.state = 'healthy';
  }

  observeTransientFailure(provider: string, family?: ImageSlotFamily): void {
    const record = this.getRecord(provider, family);
    record.transientFailures += 1;
    if (record.transientFailures >= this.transientThreshold) {
      record.state = 'quarantined';
      record.quarantineUntilMs = Date.now() + this.quarantineMs;
    } else {
      record.state = 'degraded';
    }
  }

  observePermanentFailure(provider: string, family?: ImageSlotFamily): void {
    const record = this.getRecord(provider, family);
    record.permanentFailures += 1;
    record.state = 'degraded';
  }

  canUseProvider(provider: string, family?: ImageSlotFamily): boolean {
    const record = this.getRecord(provider, family);
    if (record.state !== 'quarantined') return true;
    if ((record.quarantineUntilMs || 0) <= Date.now()) {
      record.state = 'degraded';
      record.quarantineUntilMs = undefined;
      record.transientFailures = 0;
      return true;
    }
    return false;
  }

  getHealth(provider: string, family?: ImageSlotFamily): ProviderHealthRecord {
    return { ...this.getRecord(provider, family) };
  }

  private getRecord(provider: string, family?: ImageSlotFamily): ProviderHealthRecord {
    const key = `${provider}::${family || 'all'}`;
    let record = this.records.get(key);
    if (!record) {
      record = {
        provider,
        family,
        state: 'healthy',
        transientFailures: 0,
        permanentFailures: 0,
        successes: 0,
      };
      this.records.set(key, record);
    }
    return record;
  }
}
