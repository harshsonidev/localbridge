/**
 * Structured log reading for the in-app log viewer. Parses the
 * electron-log file format written by logger.service:
 *   [2026-07-22 15:46:14.729] [info] [hosts] message...
 * Older lines without a scope segment are handled too. Continuation
 * lines (stack traces) attach to the previous entry.
 */

import fs from 'node:fs';
import type { LogEntry, LogLevel } from '../../shared/types';

const LINE_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\] \[(\w+)\]\s*(?:\((\w+)\)|\[(\w*)\])?\s*(.*)$/;

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

function toLevel(raw: string): LogLevel {
  const lower = raw.toLowerCase();
  return (LEVELS as readonly string[]).includes(lower) ? (lower as LogLevel) : 'info';
}

/** Parse raw log file content into structured entries (chronological). */
export function parseLogContent(content: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const match = line.match(LINE_RE);
    if (match) {
      entries.push({
        timestamp: match[1],
        level: toLevel(match[2]),
        category: match[3] || match[4] || 'app',
        message: match[5] ?? '',
      });
    } else if (entries.length > 0) {
      // Continuation of a multi-line message (e.g. wrapped JSON metadata).
      entries[entries.length - 1].message += `\n${line}`;
    }
  }
  return entries;
}

/** Read at most this much from the end of a large log file. */
const MAX_READ_BYTES = 2 * 1024 * 1024;

export class LogsService {
  constructor(private readonly logFilePath: string) {}

  list(limit = 1000): LogEntry[] {
    let content: string;
    try {
      const stat = fs.statSync(this.logFilePath);
      if (stat.size > MAX_READ_BYTES) {
        const fd = fs.openSync(this.logFilePath, 'r');
        try {
          const buffer = Buffer.alloc(MAX_READ_BYTES);
          fs.readSync(fd, buffer, 0, MAX_READ_BYTES, stat.size - MAX_READ_BYTES);
          content = buffer.toString('utf8');
          // Drop the first (probably partial) line.
          content = content.slice(content.indexOf('\n') + 1);
        } finally {
          fs.closeSync(fd);
        }
      } else {
        content = fs.readFileSync(this.logFilePath, 'utf8');
      }
    } catch {
      return [];
    }
    const entries = parseLogContent(content);
    return entries.slice(-limit);
  }

  clear(): void {
    try {
      fs.writeFileSync(this.logFilePath, '', 'utf8');
    } catch {
      // The logger holds the file open; truncation failures are non-fatal.
    }
  }
}
