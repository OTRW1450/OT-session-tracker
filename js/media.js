/*
 * Photo / video storage for treatment ideas. IndexedDB only - nothing leaves the device.
 * Exposes window.OTMedia.
 */
(function () {
  'use strict';

  const DB_NAME = 'ot-progress-tracker-media';
  const STORE = 'media';
  const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
  const PHOTO_MAX_SIDE = 1280;
  const PHOTO_QUALITY = 0.82;

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window) || !window.indexedDB) { reject(new Error('IndexedDB not supported')); return; }
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open media storage'));
      req.onblocked = () => reject(new Error('Media storage is blocked'));
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      const r = fn(store);
      if (r) r.onsuccess = () => { result = r.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Storage aborted (device may be full)'));
    }));
  }

  /** Resolves true if IndexedDB works here (false in some private modes / file://). */
  async function isAvailable() {
    try {
      await open();
      // Probe a write: some browsers open the DB but refuse writes.
      const probe = { id: '__probe__', blob: new Blob(['x']), type: 'text/plain' };
      await tx('readwrite', s => s.put(probe));
      await tx('readwrite', s => s.delete('__probe__'));
      return true;
    } catch (e) {
      return false;
    }
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that photo')); };
      img.src = url;
    });
  }

  /** Resize a photo to about 1280px on the longest side, as JPEG. */
  async function resizePhoto(file) {
    const img = await loadImage(file);
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // flatten transparency for JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', PHOTO_QUALITY));
    if (!blob) throw new Error('Could not process that photo');
    return blob;
  }

  /**
   * Save a picked file. Returns {id, kind, name}. Throws with a friendly message.
   */
  async function addFile(file, makeId) {
    const isVideo = /^video\//.test(file.type);
    const isPhoto = /^image\//.test(file.type);
    if (!isVideo && !isPhoto) throw new Error('"' + file.name + '" is not a photo or video.');
    if (isVideo && file.size > MAX_VIDEO_BYTES) throw new Error('"' + file.name + '" is larger than 200 MB. Try a shorter clip.');
    const blob = isPhoto ? await resizePhoto(file) : file;
    const id = makeId();
    await tx('readwrite', s => s.put({ id, blob, type: blob.type || file.type, kind: isVideo ? 'video' : 'photo', addedAt: Date.now() }));
    return { id, kind: isVideo ? 'video' : 'photo', name: file.name || '' };
  }

  /** Returns the Blob or null if it is not on this device. */
  async function get(id) {
    try {
      const rec = await tx('readonly', s => s.get(id));
      return rec && rec.blob ? rec.blob : null;
    } catch (e) {
      return null;
    }
  }

  async function remove(ids) {
    if (!ids || !ids.length) return;
    try {
      await tx('readwrite', s => { ids.forEach(id => s.delete(id)); return null; });
    } catch (e) { /* storage unavailable: nothing to delete */ }
  }

  window.OTMedia = { isAvailable, addFile, get, remove, MAX_VIDEO_BYTES };
})();
