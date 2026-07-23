import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  renderManagedBlock,
  parseManagedBlock,
  applyManagedBlock,
  findUnmanagedEntries,
  HostsService,
} from '../src/main/services/hosts.service';
import { MANAGED_BLOCK_BEGIN, MANAGED_BLOCK_END } from '../src/shared/constants';
import { AppError } from '../src/shared/errors';

const noopLog = { debug() {}, info() {}, warn() {}, error() {} };

describe('renderManagedBlock', () => {
  it('renders sorted, deduplicated entries between markers', () => {
    const block = renderManagedBlock(['b.local', 'a.local', 'B.LOCAL']);
    expect(block).toBe(
      [MANAGED_BLOCK_BEGIN, '127.0.0.1 a.local', '127.0.0.1 b.local', MANAGED_BLOCK_END].join('\n'),
    );
  });
});

describe('parseManagedBlock', () => {
  it('round-trips with renderManagedBlock', () => {
    const block = renderManagedBlock(['app.local', 'api.local']);
    expect(parseManagedBlock(block)).toEqual(['api.local', 'app.local']);
  });

  it('returns empty when no block exists', () => {
    expect(parseManagedBlock('127.0.0.1 something.else\n')).toEqual([]);
  });

  it('throws HOSTS_CONFLICT on a broken block', () => {
    expect(() => parseManagedBlock(`${MANAGED_BLOCK_BEGIN}\n127.0.0.1 a.local\n`)).toThrowError(
      AppError,
    );
  });
});

describe('applyManagedBlock', () => {
  const original = [
    '# Copyright (c) 1993-2009 Microsoft Corp.',
    '102.54.94.97     rhino.acme.com',
    '',
    '127.0.0.1 manually-added.local',
    '',
  ].join('\r\n');

  it('appends a block without disturbing existing content', () => {
    const result = applyManagedBlock(original, ['app.local']);
    expect(result).toContain('rhino.acme.com');
    expect(result).toContain('manually-added.local');
    expect(result).toContain(`${MANAGED_BLOCK_BEGIN}\r\n127.0.0.1 app.local\r\n${MANAGED_BLOCK_END}`);
  });

  it('replaces an existing block in place', () => {
    const first = applyManagedBlock(original, ['app.local']);
    const second = applyManagedBlock(first, ['other.local', 'app.local']);
    expect(second.match(new RegExp(MANAGED_BLOCK_BEGIN, 'g'))).toHaveLength(1);
    expect(parseManagedBlock(second)).toEqual(['app.local', 'other.local']);
    expect(second).toContain('rhino.acme.com');
  });

  it('is idempotent for the same domain list', () => {
    const first = applyManagedBlock(original, ['a.local', 'b.local']);
    const second = applyManagedBlock(first, ['a.local', 'b.local']);
    expect(second).toBe(first);
  });

  it('removes the block when the domain list is empty', () => {
    const withBlock = applyManagedBlock(original, ['app.local']);
    const removed = applyManagedBlock(withBlock, []);
    expect(removed).not.toContain(MANAGED_BLOCK_BEGIN);
    expect(removed).toContain('rhino.acme.com');
    expect(removed).toContain('manually-added.local');
  });

  it('preserves LF files as LF', () => {
    const lfContent = '127.0.0.1 keep.me\n';
    const result = applyManagedBlock(lfContent, ['x.local']);
    expect(result).not.toContain('\r\n');
    expect(result).toContain('127.0.0.1 x.local\n');
  });

  it('handles an empty file', () => {
    const result = applyManagedBlock('', ['x.local']);
    expect(parseManagedBlock(result)).toEqual(['x.local']);
  });
});

describe('findUnmanagedEntries', () => {
  it('flags manual entries outside the managed block', () => {
    const content = applyManagedBlock('127.0.0.1 manual.local\n', ['managed.local']);
    expect(findUnmanagedEntries(content, ['manual.local'])).toEqual(['manual.local']);
    expect(findUnmanagedEntries(content, ['managed.local'])).toEqual([]);
    expect(findUnmanagedEntries(content, ['absent.local'])).toEqual([]);
  });
});

describe('HostsService', () => {
  let dir: string;
  let elevatedCalls: { source: string; dest: string }[];
  let grantCalls: string[];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-hosts-'));
    elevatedCalls = [];
    grantCalls = [];
  });

  afterEach(() => {
    // Clear read-only flags left by the permission tests.
    const p = path.join(dir, 'hosts');
    if (fs.existsSync(p)) fs.chmodSync(p, 0o666);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const privilegeStub = {
    // Simulates a successful one-time grant: makes the file writable.
    grantFileWritable: async (file: string) => {
      grantCalls.push(file);
      if (fs.existsSync(file)) fs.chmodSync(file, 0o666);
    },
    // Simulates the elevated copy fallback: clears read-only and copies.
    elevatedReplaceFile: async (source: string, dest: string) => {
      elevatedCalls.push({ source, dest });
      if (fs.existsSync(dest)) fs.chmodSync(dest, 0o666);
      fs.copyFileSync(source, dest);
    },
    flushDns: async () => {},
  };

  function makeService(privilege = privilegeStub) {
    return new HostsService(
      {
        hostsPath: path.join(dir, 'hosts'),
        backupDir: path.join(dir, 'backups'),
        stagingDir: path.join(dir, 'staging'),
        shouldFlushDns: () => false,
      },
      privilege,
      noopLog,
    );
  }

  it('creates the file and writes the managed block', async () => {
    const service = makeService();
    const { content, changed } = await service.apply(['app.local']);
    expect(changed).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'hosts'), 'utf8')).toBe(content);
    expect(parseManagedBlock(content)).toEqual(['app.local']);
  });

  it('is a no-op when the content is already up to date', async () => {
    const service = makeService();
    await service.apply(['a.local']);
    const second = await service.apply(['a.local']);
    expect(second.changed).toBe(false);
  });

  it('backs up the previous file before changing it', async () => {
    const service = makeService();
    await service.apply(['a.local']);
    await service.apply(['a.local', 'b.local']);
    const backups = fs.readdirSync(path.join(dir, 'backups'));
    expect(backups.length).toBeGreaterThanOrEqual(1);
  });

  it('preserves unrelated content across updates', async () => {
    fs.writeFileSync(path.join(dir, 'hosts'), '# my custom line\n10.0.0.5 nas.home\n');
    const service = makeService();
    const { content } = await service.apply(['x.local']);
    expect(content).toContain('nas.home');
    expect(content).toContain('# my custom line');
  });

  it('writes directly when permitted, without any elevation', async () => {
    const service = makeService();
    await service.apply(['a.local']);
    expect(grantCalls).toHaveLength(0);
    expect(elevatedCalls).toHaveLength(0);
  });

  it('asks for permission once, then writes later changes directly', async () => {
    const hostsPath = path.join(dir, 'hosts');
    fs.writeFileSync(hostsPath, '# locked file\n');
    fs.chmodSync(hostsPath, 0o444); // read-only -> not writable

    const service = makeService();

    // First change: file is not writable -> one grant, then direct write.
    await service.apply(['a.local']);
    expect(grantCalls).toHaveLength(1);
    expect(grantCalls[0]).toBe(hostsPath);
    expect(elevatedCalls).toHaveLength(0);

    // Second change: file is now writable -> no further prompt.
    const { content } = await service.apply(['a.local', 'b.local']);
    expect(grantCalls).toHaveLength(1);
    expect(parseManagedBlock(content)).toEqual(['a.local', 'b.local']);
    expect(content).toContain('# locked file');
  });

  it('falls back to an elevated copy when the grant does not make it writable', async () => {
    const hostsPath = path.join(dir, 'hosts');
    fs.writeFileSync(hostsPath, '# locked file\n');
    fs.chmodSync(hostsPath, 0o444);

    // Grant that fails to make the file writable (locked-down machine).
    const service = makeService({
      grantFileWritable: async (file: string) => {
        grantCalls.push(file);
      },
      elevatedReplaceFile: privilegeStub.elevatedReplaceFile,
      flushDns: privilegeStub.flushDns,
    });

    const { content } = await service.apply(['locked.local']);

    expect(grantCalls).toHaveLength(1);
    expect(elevatedCalls).toHaveLength(1);
    expect(elevatedCalls[0].dest).toBe(hostsPath);
    expect(parseManagedBlock(content)).toEqual(['locked.local']);
    expect(content).toContain('# locked file');
  });
});
