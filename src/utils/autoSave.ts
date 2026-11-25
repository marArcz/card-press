import { AutoSaveDraft } from '../types';

const DB_NAME = 'foliopress-workspace-db';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';
const CURRENT_DRAFT_KEY = 'current';
const PREF_KEY = 'foliopress-autosave-enabled';

function openAutoSaveDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
  });
}

export async function saveAutoSaveDraft(draft: AutoSaveDraft): Promise<void> {
  try {
    const db = await openAutoSaveDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(draft, CURRENT_DRAFT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Auto-save transaction failed.'));
    });
    db.close();
  } catch {
    // Ignore storage errors in restricted private browsing modes
  }
}

export async function loadAutoSaveDraft(): Promise<AutoSaveDraft | null> {
  try {
    const db = await openAutoSaveDb();
    const result = await new Promise<AutoSaveDraft | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(CURRENT_DRAFT_KEY);
      req.onsuccess = () => resolve((req.result as AutoSaveDraft | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('Failed to load auto-save draft.'));
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function clearAutoSaveDraft(): Promise<void> {
  try {
    const db = await openAutoSaveDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(CURRENT_DRAFT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to clear auto-save draft.'));
    });
    db.close();
  } catch {
    // Ignore storage errors
  }
}

export function loadAutoSavePreference(): boolean {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw === null) return true;
    return raw === 'true';
  } catch {
    return true;
  }
}

export function saveAutoSavePreference(enabled: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, String(enabled));
  } catch {
    // Ignore storage errors
  }
}
