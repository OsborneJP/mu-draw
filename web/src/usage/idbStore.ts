// The usage record's store (usage.ts Store): one value in IndexedDB. Chromium caches
// localStorage in each tab and passes another tab's writes on later, so a tab given the lock
// could read a record the last tab had already changed. IndexedDB answers every tab from one
// place: once a write's transaction has completed, every later transaction reads it
// (docs/plans/v2-usage-counts.md, revision of 2026-10-28).
import type { Store } from './usage';

/** The object store and the key the record is kept under (the tests read it there too). */
export const RECORDS = 'kept';
export const RECORD = 'record';

export function idbStore(database: string): Store {
  /** Opened for each use and closed after it, so no connection is left to block anything.
   * Only a write creates the database: reading or removing finds none (null), so a browser
   * that never counts (Global Privacy Control) gets none. */
  function open(create: boolean): Promise<IDBDatabase | null> {
    return new Promise((resolve, reject) => {
      const request = create ? indexedDB.open(database, 1) : indexedDB.open(database);
      request.onupgradeneeded = () => {
        if (create) request.result.createObjectStore(RECORDS);
        else request.transaction?.abort();
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        if (!create && request.error?.name === 'AbortError') resolve(null);
        else reject(request.error ?? new Error('IndexedDB'));
      };
    });
  }

  /** Runs one request; resolves with its result once the transaction has completed, or with
   * undefined if there is no database (and `create` is false). */
  async function run<T>(mode: IDBTransactionMode, create: boolean, ask: (records: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
    const db = await open(create);
    if (db === null) return undefined;
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(RECORDS, mode);
        const request = ask(transaction.objectStore(RECORDS));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB'));
      });
    } finally {
      db.close();
    }
  }

  return {
    get: () => run('readonly', false, (records) => records.get(RECORD)),
    set: async (value) => void (await run('readwrite', true, (records) => records.put(value, RECORD))),
    remove: async () => void (await run('readwrite', false, (records) => records.delete(RECORD))),
  };
}
