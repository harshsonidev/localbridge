/**
 * Build-time helper: downloads the pinned Caddy and mkcert binaries from
 * their official release sources and verifies their SHA-256 against the
 * manifest before placing them in resources/<platform>/.
 *
 * Usage:
 *   node scripts/download-binaries.mjs                # download + verify
 *   node scripts/download-binaries.mjs --print-hash   # print hashes of
 *      freshly downloaded files without installing (for pinning)
 *
 * The script REFUSES to install a binary when the manifest hash is null
 * or does not match. Never runs at application startup — build time only.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'resources', 'binaries.manifest.json'), 'utf8'));

const printHashOnly = process.argv.includes('--print-hash');
const platformKey = `${{ win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform]}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`;
const manifestPlatform = process.platform === 'win32' ? 'windows-x64' : platformKey;

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function extractZipEntry(zipBuffer, entryName) {
  // Uses the platform's own extraction tooling at build time.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localbridge-bin-'));
  const zipPath = path.join(tmpDir, 'archive.zip');
  fs.writeFileSync(zipPath, zipBuffer);
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmpDir}' -Force`,
    ]);
  } else {
    execFileSync('unzip', ['-o', zipPath, '-d', tmpDir]);
  }
  const extracted = path.join(tmpDir, entryName);
  const content = fs.readFileSync(extracted);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return content;
}

function extractTarGzEntry(tarBuffer, entryName) {
  // `tar` is available on macOS, Linux, and Windows 10+ (bsdtar).
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localbridge-bin-'));
  const tarPath = path.join(tmpDir, 'archive.tar.gz');
  fs.writeFileSync(tarPath, tarBuffer);
  execFileSync('tar', ['-xzf', tarPath, '-C', tmpDir]);
  const content = fs.readFileSync(path.join(tmpDir, entryName));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return content;
}

function extractArchive(archive, raw, entryName) {
  if (archive === 'zip') return extractZipEntry(raw, entryName);
  if (archive === 'tar.gz') return extractTarGzEntry(raw, entryName);
  return raw;
}

let failed = false;

for (const [tool, config] of Object.entries(manifest)) {
  if (tool.startsWith('$')) continue;
  const platform = config.platforms[manifestPlatform];
  if (!platform) {
    console.warn(`[skip] ${tool}: no entry for platform ${manifestPlatform}`);
    continue;
  }

  console.log(`[download] ${tool} v${config.version} from ${platform.url}`);
  const raw = await download(platform.url);
  // Hash the raw artifact - that is what official release checksums cover.
  const hash = sha256(raw);

  if (printHashOnly) {
    console.log(`[hash] ${tool} (${manifestPlatform}): ${hash}`);
    console.log('       Verify this against the official release checksums before pinning it.');
    continue;
  }

  if (!platform.sha256) {
    console.error(
      `[error] ${tool}: no sha256 pinned in binaries.manifest.json. ` +
        'Run with --print-hash, verify against official checksums, then pin the hash.',
    );
    failed = true;
    continue;
  }
  if (platform.sha256 !== hash) {
    console.error(`[error] ${tool}: sha256 mismatch! expected ${platform.sha256}, got ${hash}`);
    failed = true;
    continue;
  }

  const binary = extractArchive(platform.archive, raw, platform.archiveEntry);
  const target = path.join(root, platform.targetDir, platform.targetFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, binary);
  if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
  console.log(`[ok] ${tool} -> ${target}`);
}

process.exit(failed ? 1 : 0);
