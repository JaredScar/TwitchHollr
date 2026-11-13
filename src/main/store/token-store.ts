export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  scopes: string[];
}

export interface TokenStore {
  load(): StoredTokens | null;
  save(tokens: StoredTokens): void;
  clear(): void;
}

export class MemoryTokenStore implements TokenStore {
  constructor(private tokens: StoredTokens | null = null) {}
  load() {
    return this.tokens;
  }
  save(t: StoredTokens) {
    this.tokens = t;
  }
  clear() {
    this.tokens = null;
  }
}
