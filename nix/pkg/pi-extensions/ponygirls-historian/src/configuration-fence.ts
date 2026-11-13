import { randomUUID } from 'node:crypto';

export interface ConfigurationObservation {
  key: string;
  baselineRequired: boolean;
  changed: boolean;
}

export class ConfigurationFence {
  private epoch = randomUUID();
  private signature: string | null = null;
  private baselineRequired = true;

  private currentKey(): string {
    return JSON.stringify([this.epoch, this.signature]);
  }

  observe(signature: string): ConfigurationObservation {
    const changed = this.signature !== signature;
    if (changed) {
      this.signature = signature;
      this.epoch = randomUUID();
      this.baselineRequired = true;
    }
    return {
      key: this.currentKey(),
      baselineRequired: this.baselineRequired,
      changed,
    };
  }

  invalidate(): void {
    this.signature = null;
    this.epoch = randomUUID();
    this.baselineRequired = true;
  }

  captured(key: string): void {
    if (
      this.signature !== null &&
      key === this.currentKey()
    ) {
      this.baselineRequired = false;
    }
  }
}
