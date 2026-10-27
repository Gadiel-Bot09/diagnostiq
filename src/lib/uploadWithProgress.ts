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

export function uploadWithProgress<T = any>(
    url: string,
    formData: FormData,
    onProgress?: (progress: UploadProgressEvent) => void
): Promise<T> {
    return uploadBinaryWithProgress<T>(url, formData, { method: "POST", onProgress })
}
