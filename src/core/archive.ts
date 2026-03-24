/** @fileoverview Minimal tar.gz create/extract using only node:fs and node:zlib. */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join, relative, normalize, sep } from 'node:path';

const BLOCK_SIZE = 512;
const USTAR_MAGIC = 'ustar\x0000';

function toOctal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, '0') + '\0';
}

function parseOctal(buf: Buffer, offset: number, length: number): number {
  const str = buf
    .subarray(offset, offset + length)
    .toString('ascii')
    .replace(/\0.*$/, '')
    .trim();
  return str ? parseInt(str, 8) : 0;
}

function computeChecksum(header: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    sum += i >= 148 && i < 156 ? 32 : header[i]!;
  }
  return sum;
}

function walkDir(
  dir: string,
  base: string,
  exclude: ReadonlySet<string>,
): Array<{ relPath: string; fullPath: string; stat: Stats }> {
  const entries: Array<{
    relPath: string;
    fullPath: string;
    stat: Stats;
  }> = [];

  for (const name of readdirSync(dir)) {
    if (exclude.has(name)) continue;
    const fullPath = join(dir, name);
    const relPath = relative(base, fullPath);
    const st = statSync(fullPath);

    if (st.isDirectory()) {
      entries.push({ relPath: relPath + '/', fullPath, stat: st });
      entries.push(...walkDir(fullPath, base, exclude));
    } else if (st.isFile()) {
      entries.push({ relPath, fullPath, stat: st });
    }
  }

  return entries;
}

function createTarHeader(name: string, size: number, mtime: number, isDir: boolean): Buffer {
  const header = Buffer.alloc(BLOCK_SIZE);

  const nameBytes = Buffer.from(name, 'utf-8');
  if (nameBytes.length <= 100) {
    nameBytes.copy(header, 0);
  } else {
    const slashIdx = name.lastIndexOf('/');
    const suffix = Buffer.from(name.slice(slashIdx + 1), 'utf-8');
    const prefix = slashIdx > 0 ? Buffer.from(name.slice(0, slashIdx), 'utf-8') : Buffer.alloc(0);
    if (suffix.length > 100 || prefix.length > 155) {
      throw new Error(`path too long for tar header: ${name}`);
    }
    suffix.copy(header, 0);
    prefix.copy(header, 345);
  }

  header.write(toOctal(0o644, 8), 100, 8, 'ascii');
  header.write(toOctal(0, 8), 108, 8, 'ascii');
  header.write(toOctal(0, 8), 116, 8, 'ascii');
  header.write(toOctal(size, 12), 124, 12, 'ascii');
  header.write(toOctal(Math.floor(mtime / 1000), 12), 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii');
  header.write(isDir ? '5' : '0', 156, 1, 'ascii');
  header.write(USTAR_MAGIC, 257, 8, 'ascii');

  const checksum = computeChecksum(header);
  header.write(toOctal(checksum, 7) + ' ', 148, 8, 'ascii');

  return header;
}

/** Creates a tar.gz archive from a directory. */
export function packTarGz(srcDir: string, destPath: string, exclude?: string[]): void {
  const excludeSet = new Set(exclude ?? []);
  const entries = walkDir(srcDir, srcDir, excludeSet);
  const buffers: Buffer[] = [];

  for (const entry of entries) {
    const isDir = entry.relPath.endsWith('/');
    const content = isDir ? Buffer.alloc(0) : readFileSync(entry.fullPath);
    const header = createTarHeader(
      entry.relPath,
      content.length,
      Number(entry.stat.mtimeMs),
      isDir,
    );
    buffers.push(header);

    if (content.length > 0) {
      buffers.push(content);
      const remainder = content.length % BLOCK_SIZE;
      if (remainder > 0) {
        buffers.push(Buffer.alloc(BLOCK_SIZE - remainder));
      }
    }
  }

  buffers.push(Buffer.alloc(BLOCK_SIZE * 2));

  const tar = Buffer.concat(buffers);
  const gz = gzipSync(tar, { level: 1 });
  writeFileSync(destPath, gz);
}

/**
 * Extracts a tar.gz archive into a directory.
 * Validates paths to prevent Zip Slip (directory traversal) attacks.
 */
export function unpackTarGz(srcPath: string, destDir: string): void {
  const gz = readFileSync(srcPath);
  const tar = gunzipSync(gz);
  const resolvedDest = normalize(destDir);

  let offset = 0;
  while (offset + BLOCK_SIZE <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK_SIZE);

    if (header.every((b) => b === 0)) break;

    let name = header.subarray(0, 100).toString('utf-8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf-8').replace(/\0.*$/, '');
    if (prefix) {
      name = prefix + '/' + name;
    }

    const size = parseOctal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156]!);

    offset += BLOCK_SIZE;

    const targetPath = normalize(join(destDir, name));
    if (!targetPath.startsWith(resolvedDest + sep) && targetPath !== resolvedDest) {
      throw new Error(`path traversal detected in archive: ${name}`);
    }

    if (typeFlag === '5' || name.endsWith('/')) {
      mkdirSync(targetPath, { recursive: true });
    } else {
      mkdirSync(normalize(join(targetPath, '..')), { recursive: true });
      const content = tar.subarray(offset, offset + size);
      writeFileSync(targetPath, content);
    }

    if (size > 0) {
      offset += Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
    }
  }
}
