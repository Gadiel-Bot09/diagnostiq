/**
 * Caché Local Inteligente en IndexedDB para estudios CBCT DICOM (Mejora #6).
 *
 * Evita volver a descargar 50-150 MB desde MinIO cuando el especialista reabre la misma tomografía:
 *  - Clave estable basada en `resultFileId` (o ruta URL sin parámetros temporales de firma presigned).
 *  - Expiración automática (TTL 7 días) y política LRU con tope seguro (máx. 350 MB / 4 estudios).
 *  - Degradación silenciosa si el navegador está en modo incógnito o sin cuota de IndexedDB.
 */

const DB_NAME = "diagnostiq_cbct_cache_v1"
const STORE_NAME = "studies"
const DB_VERSION = 1
const MAX_ENTRIES = 4
const MAX_TOTAL_BYTES = 350 * 1024 * 1024 // 350 MB máx.
const TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 días

interface CachedStudyRecord {
    key: string
    blob: Blob
    size: number
    cachedAt: number
    lastAccessedAt: number
}

function openCacheDb(): Promise<IDBDatabase | null> {
    if (typeof window === "undefined" || !("indexedDB" in window)) return Promise.resolve(null)
    return new Promise((resolve) => {
        try {
            const req = window.indexedDB.open(DB_NAME, DB_VERSION)
            req.onupgradeneeded = () => {
                const db = req.result
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: "key" })
                }
            }
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => resolve(null)
        } catch {
            resolve(null)
        }
    })
}

export function buildStudyCacheKey(resultFileId?: string | null, zipUrl?: string | null): string | null {
    if (resultFileId) return `file:${resultFileId}`
    if (!zipUrl) return null
    try {
        const u = new URL(zipUrl, typeof window !== "undefined" ? window.location.origin : "http://localhost")
        // Ignorar parámetros efímeros de firma S3/MinIO (X-Amz-Signature, etc.)
        return `url:${u.origin}${u.pathname}`
    } catch {
        return `url:${zipUrl.split("?")[0]}`
    }
}

export async function getCachedStudyBlob(key: string | null): Promise<Blob | null> {
    if (!key) return null
    const db = await openCacheDb()
    if (!db) return null
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, "readwrite")
            const store = tx.objectStore(STORE_NAME)
            const req = store.get(key)
            req.onsuccess = () => {
                const rec = req.result as CachedStudyRecord | undefined
                if (!rec || !rec.blob) {
                    resolve(null)
                    return
                }
                if (Date.now() - rec.cachedAt > TTL_MS) {
                    store.delete(key)
                    resolve(null)
                    return
                }
                // Actualizar timestamp LRU
                rec.lastAccessedAt = Date.now()
                try {
                    store.put(rec)
                } catch {}
                resolve(rec.blob)
            }
            req.onerror = () => resolve(null)
        } catch {
            resolve(null)
        }
    })
}

export async function putCachedStudyBlob(key: string | null, blob: Blob): Promise<void> {
    if (!key || !blob || blob.size === 0 || blob.size > MAX_TOTAL_BYTES) return
    const db = await openCacheDb()
    if (!db) return
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, "readwrite")
            const store = tx.objectStore(STORE_NAME)
            const getAllReq = store.getAll()
            getAllReq.onsuccess = () => {
                const all = (getAllReq.result as CachedStudyRecord[]) || []
                const now = Date.now()

                // Eliminar caducados y ordenar restantes por último acceso (más antiguo primero)
                const valid: CachedStudyRecord[] = []
                for (const item of all) {
                    if (item.key === key || now - item.cachedAt > TTL_MS) {
                        store.delete(item.key)
                    } else {
                        valid.push(item)
                    }
                }
                valid.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)

                let totalSize = valid.reduce((acc, r) => acc + (r.size || 0), 0) + blob.size
                while (valid.length >= MAX_ENTRIES || (totalSize > MAX_TOTAL_BYTES && valid.length > 0)) {
                    const oldest = valid.shift()!
                    totalSize -= oldest.size || 0
                    store.delete(oldest.key)
                }

                const record: CachedStudyRecord = {
                    key,
                    blob,
                    size: blob.size,
                    cachedAt: now,
                    lastAccessedAt: now,
                }
                store.put(record)
            }
            tx.oncomplete = () => resolve()
            tx.onerror = () => resolve()
        } catch {
            resolve()
        }
    })
}
