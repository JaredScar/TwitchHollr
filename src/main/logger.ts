import log from 'electron-log/main';
import type { CommandSource, LogEntry, LogLevel, LogStage } from '@shared/types';

const MAX_ENTRIES = 300;

export function setupFileLogging(): void {
  log.initialize();
  log.transports.file.fileName = 'hollr.log';
  // electron-log rotates hollr.log to hollr.old.log when it reaches this size.
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.transports.file.level = 'info';
  log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn';
}

/** In-memory activity log for the dashboard, mirrored to the rotating log file. */
export class ActivityLog {
  private entries: LogEntry[] = [];
  private seq = 0;
  private listeners: ((e: LogEntry) => void)[] = [];

  add(level: LogLevel, source: LogEntry['source'], stage: LogStage, message: string): LogEntry {
    const entry: LogEntry = { id: ++this.seq, ts: Date.now(), level, source, stage, message };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    const line = `[${source}/${stage}] ${message}`;
    if (level === 'error') log.error(line);
    else if (level === 'warn') log.warn(line);
    else log.info(line);
    for (const l of this.listeners) l(entry);
    return entry;
  }

  system(level: LogLevel, message: string): void {
    this.add(level, 'system', 'system', message);
  }

  command(level: LogLevel, source: CommandSource, stage: LogStage, message: string): void {
    this.add(level, source, stage, message);
  }

  all(): LogEntry[] {
    return [...this.entries];
  }

  onEntry(l: (e: LogEntry) => void): void {
    this.listeners.push(l);
  }
}

export { log };
