import type { JobInfo } from './api.ts';

// Keep i64 values exact, including values beyond Number.MAX_SAFE_INTEGER.
export function formatBytes(bytes: bigint | undefined): string {
  return bytes === undefined ? 'unknown' : `${bytes.toString()} bytes`;
}
export function windowProgress(job: Pick<JobInfo, 'completedWindows' | 'totalWindows'>): string {
  return `${job.completedWindows} / ${job.totalWindows === undefined ? 'unknown' : job.totalWindows} windows processed`;
}
export const ACTIVITY_POLL_INTERVAL_MS = 4_000;
