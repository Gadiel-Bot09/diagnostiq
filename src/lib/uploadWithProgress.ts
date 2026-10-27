export interface UploadProgressEvent {
    loaded: number
    total: number
    percent: number
    loadedMB: number
    totalMB: number
}

export interface UploadOptions {
    method?: string
    headers?: Record<string, string>
    onProgress?: (progress: UploadProgressEvent) => void
}

export interface PresignedPart {
    partNumber: number
    uploadUrl: string
}

export interface PresignedInitData {
    isMultipart: boolean
    filePath?: string
    storagePath?: string
    fileType?: string
    uploadUrl?: string
    uploadId?: string
    partSize?: number
    parts?: PresignedPart[]
}

export function uploadBinaryWithProgress<T = any>(
    url: string,
    body: Blob | File | FormData | ArrayBuffer,
    options?: UploadOptions
): Promise<T> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        const method = options?.method || "PUT"
        xhr.open(method, url, true)

        if (options?.headers) {
            for (const [k, v] of Object.entries(options.headers)) {
                if (v) xhr.setRequestHeader(k, v)
            }
        }

        const onProgress = options?.onProgress
        if (xhr.upload && onProgress) {
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percent = Math.min(100, Math.round((event.loaded / event.total) * 100))
                    const loadedMB = event.loaded / (1024 * 1024)
                    const totalMB = event.total / (1024 * 1024)
                    onProgress({
                        loaded: event.loaded,
                        total: event.total,
                        percent,
                        loadedMB,
                        totalMB,
                    })
                }
            }
        }

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const data = JSON.parse(xhr.responseText)
                    resolve(data as T)
                } catch {
                    resolve({ success: true, status: xhr.status } as T)
                }
            } else {
                try {
                    const err = JSON.parse(xhr.responseText)
                    reject(new Error(err.error || `Error ${xhr.status} al subir el archivo`))
                } catch {
                    reject(new Error(`Error ${xhr.status} del servidor al subir el archivo`))
                }
            }
        }

        xhr.onerror = () => {
            reject(new Error("Error de conexión al transferir el archivo a MinIO. Verifica tu conexión."))
        }

        xhr.ontimeout = () => {
            reject(new Error("Tiempo de espera agotado al subir el archivo."))
        }

        xhr.send(body)
    })
}

function uploadPartWithXhr(
    url: string,
    chunk: Blob,
    onProgress?: (loaded: number) => void
): Promise<string> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open("PUT", url, true)

        if (xhr.upload && onProgress) {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    onProgress(e.loaded)
                }
            }
        }

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                const etag = xhr.getResponseHeader("ETag") || xhr.getResponseHeader("etag")
                if (!etag) {
                    reject(new Error("No se recibió la cabecera ETag del servidor de almacenamiento."))
                } else {
                    resolve(etag)
                }
            } else {
                reject(new Error(`Error ${xhr.status} al transferir fragmento a MinIO`))
            }
        }

        xhr.onerror = () => {
            reject(new Error("Error de conexión al transferir fragmento a MinIO. Verifica tu conexión."))
        }

        xhr.ontimeout = () => {
            reject(new Error("Tiempo agotado al transferir fragmento a MinIO."))
        }

        xhr.send(chunk)
    })
}

async function uploadPartWithRetry(
    url: string,
    chunk: Blob,
    onProgress?: (loaded: number) => void,
    maxRetries = 3
): Promise<string> {
    let lastError: any
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await uploadPartWithXhr(url, chunk, onProgress)
        } catch (err: any) {
            lastError = err
            console.warn(`[DiagnostiQ Upload] Reintento ${attempt}/${maxRetries} para fragmento:`, err.message)
            if (attempt < maxRetries) {
                await new Promise((r) => setTimeout(r, 1000 * attempt))
            }
        }
    }
    throw lastError
}

export async function uploadPresignedFile(
    file: File,
    initData: PresignedInitData,
    completeEndpointUrl: string,
    options?: UploadOptions
): Promise<{ storagePath: string }> {
    const finalPath = initData.filePath || initData.storagePath || ""

    // 1. Archivos pequeños (<= 10MB): Subida directa por PUT único
    if (!initData.isMultipart && initData.uploadUrl) {
        await uploadBinaryWithProgress(initData.uploadUrl, file, {
            method: "PUT",
            headers: options?.headers,
            onProgress: options?.onProgress,
        })
        return { storagePath: finalPath }
    }

    // 2. Archivos pesados (> 10MB): S3 Multipart Upload en fragmentos de 10MB
    const parts = initData.parts || []
    const partSize = initData.partSize || 10 * 1024 * 1024
    const uploadId = initData.uploadId
    const onProgress = options?.onProgress

    if (!uploadId || parts.length === 0) {
        throw new Error("Datos de inicialización multipart incompletos.")
    }

    const completedParts: { PartNumber: number; ETag: string }[] = []
    let totalUploadedBeforeCurrentPart = 0

    try {
        for (const part of parts) {
            const start = (part.partNumber - 1) * partSize
            const end = Math.min(file.size, start + partSize)
            const chunk = file.slice(start, end)

            const etag = await uploadPartWithRetry(part.uploadUrl, chunk, (chunkLoaded) => {
                if (onProgress) {
                    const currentTotalLoaded = totalUploadedBeforeCurrentPart + chunkLoaded
                    const percent = Math.min(100, Math.round((currentTotalLoaded / file.size) * 100))
                    onProgress({
                        loaded: currentTotalLoaded,
                        total: file.size,
                        percent,
                        loadedMB: currentTotalLoaded / (1024 * 1024),
                        totalMB: file.size / (1024 * 1024),
                    })
                }
            })

            completedParts.push({ PartNumber: part.partNumber, ETag: etag })
            totalUploadedBeforeCurrentPart += chunk.size

            if (onProgress) {
                const percent = Math.min(100, Math.round((totalUploadedBeforeCurrentPart / file.size) * 100))
                onProgress({
                    loaded: totalUploadedBeforeCurrentPart,
                    total: file.size,
                    percent,
                    loadedMB: totalUploadedBeforeCurrentPart / (1024 * 1024),
                    totalMB: file.size / (1024 * 1024),
                })
            }
        }

        // Finalizar y ensamblar el archivo en MinIO
        const completeRes = await fetch(completeEndpointUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "complete",
                uploadId,
                filePath: finalPath,
                storagePath: finalPath,
                parts: completedParts,
            }),
        })

        if (!completeRes.ok) {
            const errData = await completeRes.json().catch(() => ({}))
            throw new Error(errData.error || "Error al ensamblar los fragmentos en MinIO")
        }

        return { storagePath: finalPath }
    } catch (error) {
        // En caso de fallo, abortar el multipart upload en MinIO para liberar recursos
        fetch(completeEndpointUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "abort",
                uploadId,
                filePath: finalPath,
                storagePath: finalPath,
            }),
        }).catch(() => {})

        throw error
    }
}

export function uploadWithProgress<T = any>(
    url: string,
    formData: FormData,
    onProgress?: (progress: UploadProgressEvent) => void
): Promise<T> {
    return uploadBinaryWithProgress<T>(url, formData, { method: "POST", onProgress })
}
