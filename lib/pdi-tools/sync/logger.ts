import type { SyncPhase } from "./phases";

export type SyncLogLevel = "debug" | "info" | "warn" | "error";

export type SyncLogEvent = {
  ts: string;
  level: SyncLogLevel;
  message: string;
  phase?: SyncPhase;
  progress?: number;
};

export class SyncLogger {
  constructor(private readonly emit?: (event: SyncLogEvent) => void) {}

  private write(
    level: SyncLogLevel,
    message: string,
    meta?: { phase?: SyncPhase; progress?: number }
  ): void {
    const event: SyncLogEvent = {
      ts: new Date().toISOString(),
      level,
      message,
      ...meta,
    };
    this.emit?.(event);
  }

  step(phase: SyncPhase, progress: number, message: string, level: SyncLogLevel = "info"): void {
    this.write(level, message, { phase, progress });
  }
  debug(message: string): void {
    this.write("debug", message);
  }

  info(message: string): void {
    this.write("info", message);
  }

  warn(message: string): void {
    this.write("warn", message);
  }

  error(message: string): void {
    this.write("error", message);
  }
}
