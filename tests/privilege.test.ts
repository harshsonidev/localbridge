import { describe, expect, it } from 'vitest';
import { pathHasUnsafeChars } from '../src/main/services/privilege.service';

describe('pathHasUnsafeChars', () => {
  it('accepts a normal Windows hosts path (backslashes are safe there)', () => {
    // Regression: a strengthened check once rejected the real hosts path,
    // breaking every hosts change on Windows with "Unsafe characters".
    expect(pathHasUnsafeChars('C:\\WINDOWS\\System32\\drivers\\etc\\hosts', 'win32')).toBe(false);
    expect(pathHasUnsafeChars('C:\\Users\\dell\\AppData\\Roaming\\localbridge\\staging\\pending-hosts.txt', 'win32')).toBe(false);
  });

  it('accepts normal macOS / Linux hosts paths', () => {
    expect(pathHasUnsafeChars('/etc/hosts', 'darwin')).toBe(false);
    expect(pathHasUnsafeChars('/etc/hosts', 'linux')).toBe(false);
  });

  it('rejects quote / backtick / dollar / newline injection on every platform', () => {
    for (const p of ["/etc/ho'sts", '/etc/ho"sts', '/etc/ho`sts', '/etc/ho$sts', '/etc/ho\nsts']) {
      expect(pathHasUnsafeChars(p, 'win32')).toBe(true);
      expect(pathHasUnsafeChars(p, 'darwin')).toBe(true);
    }
  });

  it('rejects backslash only on macOS (AppleScript string safety)', () => {
    expect(pathHasUnsafeChars('/tmp/a\\b', 'darwin')).toBe(true);
    expect(pathHasUnsafeChars('C:\\tmp\\a', 'win32')).toBe(false);
  });
});
