export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

type ApiOptions = RequestInit & {
  params?: Record<string, string | number | boolean | undefined | null>
  libraryId?: string | null
}

let activeLibraryId: string | null = null

export function setActiveLibraryId(id: string | null) {
  activeLibraryId = id
}

export function getActiveLibraryId() {
  return activeLibraryId
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const url = new URL(`/api${path}`, window.location.origin)
  const libId = options.libraryId ?? activeLibraryId
  if (libId) url.searchParams.set('library_id', libId)
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }
  }

  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(url, { ...options, headers })
  if (!res.ok) {
    const text = await res.text()
    throw new ApiError(res.status, text || res.statusText)
  }

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return res.json() as Promise<T>
  }
  return undefined as T
}

export function thumbUrl(videoId: string, version?: number, libraryId?: string | null): string {
  const params = new URLSearchParams()
  const lib = libraryId ?? activeLibraryId
  if (lib) params.set('library_id', lib)
  if (version) params.set('v', String(version))
  const qs = params.toString()
  return `/api/thumb/${videoId}${qs ? `?${qs}` : ''}`
}

export function thumbCandidateUrl(videoId: string, index: number, version?: string, libraryId?: string | null): string {
  const params = new URLSearchParams()
  const lib = libraryId ?? activeLibraryId
  if (lib) params.set('library_id', lib)
  if (version) params.set('v', version)
  const qs = params.toString()
  return `/api/thumb/${videoId}/candidate/${index}${qs ? `?${qs}` : ''}`
}

export function streamUrl(videoId: string, libraryId?: string | null): string {
  const params = new URLSearchParams()
  const lib = libraryId ?? activeLibraryId
  if (lib) params.set('library_id', lib)
  const qs = params.toString()
  return `/api/stream/${videoId}${qs ? `?${qs}` : ''}`
}
