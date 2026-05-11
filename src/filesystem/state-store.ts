/**
 * Persistent storage for v86 state snapshots.
 *
 * Strategy:
 *   - v86 state blobs are typically 30–200 MB. They change infrequently
 *     (user saves/auto-saves on exit), so IndexedDB is a decent fit.
 *   - We keep *one* slot per VM id for simplicity. The UI exposes
 *     import/export as a .bin file for manual snapshots.
 *
 * Why not OPFS for state? OPFS writes are not synchronous from the main
 * thread in Safari and require a SyncAccessHandle inside a Worker. IDB
 * works everywhere and is good enough for a state snapshot that's written
 * once per session.
 */

const DB_NAME = 'browser-linux';
const DB_VERSION = 1;
const STORE_STATE = 'vm-state';
const STORE_META = 'meta';

interface StateRecord {
  id: string;
  blob: Blob;
  savedAt: number;
  sizeBytes: number;
}

interface MetaRecord {
  id: string;
  value: unknown;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_STATE)) {
        db.createObjectStore(STORE_STATE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IDB tx failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IDB tx aborted'));
  });
}

export class StateStore {
  private readonly vmId: string;

  constructor(vmId: string) {
    this.vmId = vmId;
  }

  async saveState(state: ArrayBuffer): Promise<void> {
    const db = await openDb();
    try {
      const record: StateRecord = {
        id: this.vmId,
        blob: new Blob([state], { type: 'application/octet-stream' }),
        savedAt: Date.now(),
        sizeBytes: state.byteLength,
      };
      const tx = db.transaction(STORE_STATE, 'readwrite');
      tx.objectStore(STORE_STATE).put(record);
      await txDone(tx);
    } finally {
      db.close();
    }
  }

  async loadState(): Promise<ArrayBuffer | null> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE_STATE, 'readonly');
      const req = tx.objectStore(STORE_STATE).get(this.vmId);
      const record = await new Promise<StateRecord | undefined>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result as StateRecord | undefined);
        req.onerror = () => reject(req.error);
      });
      await txDone(tx);
      if (!record) return null;
      return await record.blob.arrayBuffer();
    } finally {
      db.close();
    }
  }

  async clearState(): Promise<void> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE_STATE, 'readwrite');
      tx.objectStore(STORE_STATE).delete(this.vmId);
      await txDone(tx);
    } finally {
      db.close();
    }
  }

  async getStateInfo(): Promise<{ savedAt: number; sizeBytes: number } | null> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE_STATE, 'readonly');
      const req = tx.objectStore(STORE_STATE).get(this.vmId);
      const record = await new Promise<StateRecord | undefined>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result as StateRecord | undefined);
        req.onerror = () => reject(req.error);
      });
      await txDone(tx);
      if (!record) return null;
      return { savedAt: record.savedAt, sizeBytes: record.sizeBytes };
    } finally {
      db.close();
    }
  }

  async setMeta<T>(key: string, value: T): Promise<void> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE_META, 'readwrite');
      const record: MetaRecord = { id: `${this.vmId}::${key}`, value };
      tx.objectStore(STORE_META).put(record);
      await txDone(tx);
    } finally {
      db.close();
    }
  }

  async getMeta<T>(key: string): Promise<T | null> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE_META, 'readonly');
      const req = tx.objectStore(STORE_META).get(`${this.vmId}::${key}`);
      const record = await new Promise<MetaRecord | undefined>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result as MetaRecord | undefined);
        req.onerror = () => reject(req.error);
      });
      await txDone(tx);
      return (record?.value ?? null) as T | null;
    } finally {
      db.close();
    }
  }
}
