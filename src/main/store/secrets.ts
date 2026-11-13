import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import log from 'electron-log/main';
import type { StoredTokens, TokenStore } from './token-store';

/** Tokens encrypted with the OS keychain (DPAPI on Windows, Keychain on macOS) and written atomically. */
export class SafeTokenStore implements TokenStore {
  private readonly file = join(app.getPath('userData'), 'tokens.bin');
  private memory: StoredTokens | null = null;

  load(): StoredTokens | null {
    if (this.memory) return this.memory;
    if (!existsSync(this.file) || !safeStorage.isEncryptionAvailable()) return null;
    try {
      const json = safeStorage.decryptString(readFileSync(this.file));
      this.memory = JSON.parse(json) as StoredTokens;
      return this.memory;
    } catch (err) {
      log.warn('Could not decrypt stored tokens; signing out.', err);
      return null;
    }
  }

  save(tokens: StoredTokens): void {
    this.memory = tokens;
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('OS encryption unavailable: tokens are kept in memory only for this session.');
      return;
    }
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(tokens)));
    renameSync(tmp, this.file);
  }

  clear(): void {
    this.memory = null;
    rmSync(this.file, { force: true });
  }
}
