import type { Annotation, CompositionStyle } from './editor-types';

export interface ShotDocument {
  name: string;
  imageSrc: string;
  annotations: Annotation[];
  style: CompositionStyle;
  sample: boolean;
  captureId?: string;
}
function openDrafts(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('imageshot-studio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readDraft(key = 'latest'): Promise<ShotDocument | undefined> {
  const db = await openDrafts();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction('drafts').objectStore('drafts').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
export async function writeDraft(document: ShotDocument) {
  const db = await openDrafts();
  try { await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('drafts', 'readwrite');
    transaction.objectStore('drafts').put(document, 'latest');
    if (document.captureId) transaction.objectStore('drafts').put(document, `capture:${document.captureId}`);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }); } finally { db.close(); }
}
