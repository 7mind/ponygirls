// Haystack application: injected clock (test-controlled time).
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Manual clock for deterministic service scenarios. */
export class ManualClock implements Clock {
  private current: Date;
  constructor(start: string = "2026-10-07T18:00:00.000Z") {
    this.current = new Date(start);
  }
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(iso: string): void {
    this.current = new Date(iso);
  }
}
