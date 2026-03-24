/** @fileoverview Backup orchestration: create, restore, list, delete, retention enforcement. */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  renameSync,
  rmSync,
  openSync,
  writeSync,
  closeSync,
  constants,
} from 'node:fs';
import { join, basename } from 'node:path';
import { packTarGz, unpackTarGz } from './archive.ts';
import { optimizeDatabase } from '../db/index.ts';
import { logger } from './logger.ts';

export interface BackupInfo {
  name: string;
  size: number;
  created: string;
}

export const BACKUP_NAME_RE = /^[\w-]+\.tar\.gz$/;
const LOCK_FILE = '.backup.lock';

export function isValidBackupName(name: string): boolean {
  return BACKUP_NAME_RE.test(name) && !name.includes('..');
}

function getBackupsDir(dataDir: string): string {
  const dir = join(dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function acquireLock(dataDir: string): number {
  const lockPath = join(dataDir, LOCK_FILE);
  try {
    const fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    writeSync(fd, String(process.pid));
    return fd;
  } catch (err) {
    if ((err as { code?: string }).code === 'EEXIST') {
      throw new Error('another backup or restore operation is in progress', { cause: err });
    }
    throw err;
  }
}

function releaseLock(dataDir: string, fd: number): void {
  closeSync(fd);
  try {
    unlinkSync(join(dataDir, LOCK_FILE));
  } catch {
    // already removed
  }
}

function validateBackupName(name: string): void {
  if (!isValidBackupName(name)) {
    throw new Error(`invalid backup name: ${name}`);
  }
}

function formatTimestamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}_${h}${min}${s}`;
}

export function createBackup(dataDir: string, name?: string): BackupInfo {
  const backupsDir = getBackupsDir(dataDir);
  const fd = acquireLock(dataDir);

  try {
    optimizeDatabase();
    const fileName = name ?? `bb_backup_${formatTimestamp()}.tar.gz`;
    validateBackupName(fileName);
    const destPath = join(backupsDir, fileName);

    packTarGz(dataDir, destPath, ['backups', LOCK_FILE]);

    const st = statSync(destPath);
    return {
      name: fileName,
      size: st.size,
      created: st.birthtime.toISOString(),
    };
  } finally {
    releaseLock(dataDir, fd);
  }
}

export function listBackups(dataDir: string): BackupInfo[] {
  const backupsDir = getBackupsDir(dataDir);
  const files = readdirSync(backupsDir).filter((f) => f.endsWith('.tar.gz'));

  return files
    .map((name) => {
      const st = statSync(join(backupsDir, name));
      return {
        name,
        size: st.size,
        created: st.birthtime.toISOString(),
      };
    })
    .sort((a, b) => b.created.localeCompare(a.created));
}

export function deleteBackup(dataDir: string, name: string): void {
  validateBackupName(name);
  try {
    unlinkSync(join(getBackupsDir(dataDir), name));
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      throw new Error(`backup "${name}" not found`, { cause: err });
    }
    throw err;
  }
}

export function restoreBackup(dataDir: string, name: string): void {
  validateBackupName(name);
  const backupsDir = getBackupsDir(dataDir);
  const archivePath = join(backupsDir, name);
  if (!existsSync(archivePath)) {
    throw new Error(`backup "${name}" not found`);
  }

  const fd = acquireLock(dataDir);
  const restoreTmp = join(dataDir, '.restore_tmp');
  const oldDataDir = join(dataDir, `.old_data_${Date.now()}`);
  let moved = false;

  try {
    if (existsSync(restoreTmp)) {
      rmSync(restoreTmp, { recursive: true });
    }
    mkdirSync(restoreTmp, { recursive: true });

    unpackTarGz(archivePath, restoreTmp);

    if (!existsSync(join(restoreTmp, 'browserbird.db'))) {
      throw new Error('archive does not contain browserbird.db');
    }

    mkdirSync(oldDataDir, { recursive: true });
    const skipEntries = new Set(['backups', LOCK_FILE, '.restore_tmp', basename(oldDataDir)]);

    for (const entry of readdirSync(dataDir)) {
      if (skipEntries.has(entry)) continue;
      renameSync(join(dataDir, entry), join(oldDataDir, entry));
    }
    moved = true;

    for (const entry of readdirSync(restoreTmp)) {
      if (entry === 'backups') continue;
      renameSync(join(restoreTmp, entry), join(dataDir, entry));
    }

    rmSync(restoreTmp, { recursive: true });
    logger.info(`backup "${name}" restored`);
  } catch (err) {
    if (moved) {
      logger.warn('restore failed, reverting...');
      for (const entry of readdirSync(dataDir)) {
        if (entry === 'backups' || entry === LOCK_FILE || entry.startsWith('.old_data_')) continue;
        try {
          rmSync(join(dataDir, entry), { recursive: true });
        } catch {
          // best-effort cleanup
        }
      }
      for (const entry of readdirSync(oldDataDir)) {
        renameSync(join(oldDataDir, entry), join(dataDir, entry));
      }
      rmSync(oldDataDir, { recursive: true });
      logger.info('revert complete');
    }
    if (existsSync(restoreTmp)) {
      rmSync(restoreTmp, { recursive: true });
    }
    throw err;
  } finally {
    releaseLock(dataDir, fd);
  }
}

export function enforceRetention(dataDir: string, maxCount: number): void {
  const backups = listBackups(dataDir);
  if (backups.length <= maxCount) return;
  const toDelete = backups.slice(maxCount);
  for (const backup of toDelete) {
    try {
      deleteBackup(dataDir, backup.name);
      logger.debug(`retention: deleted old backup ${backup.name}`);
    } catch {
      // best-effort deletion
    }
  }
}

export function cleanupOldRestoreData(dataDir: string): void {
  for (const entry of readdirSync(dataDir)) {
    if (entry.startsWith('.old_data_')) {
      try {
        rmSync(join(dataDir, entry), { recursive: true });
        logger.debug(`cleaned up old restore data: ${entry}`);
      } catch {
        // best-effort cleanup
      }
    }
  }
}
