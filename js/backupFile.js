// Optional user-owned JSON file. The live store stays in localStorage.
// File System Access API (Chromium). The handle is remembered in IndexedDB.

const DB_NAME = 'survival-plan-backup';
const DB_VERSION = 1;
const STORE = 'handles';
const HANDLE_KEY = 'plan';
const NAME_KEY = 'survival-plan-backup-name';
const ACCEPT = {
  description: 'Emergency Food Prep backup',
  accept: { 'application/json': ['.json'] },
};

export const LINKED_FILE_NAME = 'emergency-food-prep.json';

export function isSupported() {
  return typeof window !== 'undefined'
    && typeof window.showSaveFilePicker === 'function'
    && typeof window.showOpenFilePicker === 'function'
    && typeof indexedDB !== 'undefined';
}

export function rememberedName() {
  try {
    return window.localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
}

function setRememberedName(name) {
  try {
    if (name) window.localStorage.setItem(NAME_KEY, name);
    else window.localStorage.removeItem(NAME_KEY);
  } catch {
    /* ignore */
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getHandle() {
  if (!isSupported()) return null;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(HANDLE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

export async function rememberHandle(handle) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(handle, HANDLE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  setRememberedName(handle.name || LINKED_FILE_NAME);
}

export async function clearHandle() {
  setRememberedName('');
  if (!isSupported()) return;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(HANDLE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    /* ignore */
  }
}

async function queryPermission(handle, mode = 'readwrite') {
  if (!handle || typeof handle.queryPermission !== 'function') return 'denied';
  try {
    return await handle.queryPermission({ mode });
  } catch {
    return 'denied';
  }
}

export async function requestPermission(handle, mode = 'readwrite') {
  if (!handle || typeof handle.requestPermission !== 'function') return 'denied';
  try {
    return await handle.requestPermission({ mode });
  } catch {
    return 'denied';
  }
}

export async function writeHandle(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

export async function readHandle(handle) {
  const file = await handle.getFile();
  return file.text();
}

export async function pickNewFile() {
  const handle = await window.showSaveFilePicker({
    suggestedName: LINKED_FILE_NAME,
    types: [ACCEPT],
    excludeAcceptAllOption: false,
  });
  await rememberHandle(handle);
  return handle;
}

export async function pickExistingFile() {
  const [handle] = await window.showOpenFilePicker({
    multiple: false,
    types: [ACCEPT],
    excludeAcceptAllOption: false,
  });
  return handle;
}

export async function writeIfAllowed(text) {
  const handle = await getHandle();
  if (!handle) return { state: 'unlinked' };
  const name = handle.name || rememberedName() || LINKED_FILE_NAME;
  const permission = await queryPermission(handle, 'readwrite');
  if (permission !== 'granted') return { state: 'needs-permission', name, handle };
  try {
    await writeHandle(handle, text);
    return { state: 'ok', name, handle };
  } catch (error) {
    return { state: 'error', name, handle, message: error && error.message ? error.message : 'Could not write the file.' };
  }
}

export async function inspectLinkedFile() {
  const handle = await getHandle();
  if (!handle) return { state: 'unlinked' };
  const name = handle.name || rememberedName() || LINKED_FILE_NAME;
  const permission = await queryPermission(handle, 'readwrite');
  if (permission !== 'granted') return { state: 'needs-permission', name, handle };
  try {
    const text = await readHandle(handle);
    return { state: 'readable', name, handle, text };
  } catch (error) {
    return { state: 'error', name, handle, message: error && error.message ? error.message : 'Could not read the file.' };
  }
}
