// SPDX-License-Identifier: AGPL-3.0-only
// Thin fetch wrapper for the REST API. All UI actions go through the public API.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown> | unknown[];

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function request<T = unknown>(method: string, path: string, body?: Json | FormData, opts: { signal?: AbortSignal; quiet401?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-OCPC-CSRF': '1' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api/v1${path}`, { method, headers, body: payload, credentials: 'same-origin', signal: opts.signal });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string; details?: unknown };
    if (res.status === 401 && !opts.quiet401 && d.error === 'unauthorized') onUnauthorized();
    throw new ApiError(res.status, d.error ?? 'error', d.message ?? `Request failed (${res.status})`, d.details);
  }
  return data as T;
}

export const api = {
  get: <T = unknown>(p: string, opts?: { signal?: AbortSignal; quiet401?: boolean }) => request<T>('GET', p, undefined, opts),
  post: <T = unknown>(p: string, b: Json | FormData = {}) => request<T>('POST', p, b),
  patch: <T = unknown>(p: string, b: Json = {}) => request<T>('PATCH', p, b),
  put: <T = unknown>(p: string, b: Json = {}) => request<T>('PUT', p, b),
  del: <T = unknown>(p: string) => request<T>('DELETE', p),
};

/** Upload with progress (fetch has no upload progress events). */
export function uploadFile(
  file: File,
  onProgress?: (fraction: number) => void,
  dims?: { width: number; height: number },
): { promise: Promise<import('@ocpc/shared').FileInfo>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const q = dims ? `?width=${dims.width}&height=${dims.height}` : '';
  const promise = new Promise<import('@ocpc/shared').FileInfo>((resolve, reject) => {
    xhr.open('POST', `/api/v1/files${q}`);
    xhr.setRequestHeader('X-OCPC-CSRF', '1');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data: { message?: string; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as never);
      else reject(new ApiError(xhr.status, data.error ?? 'upload_failed', data.message ?? 'Upload failed'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'Network error during upload'));
    xhr.onabort = () => reject(new ApiError(0, 'aborted', 'Upload cancelled'));
    const fd = new FormData();
    fd.append('file', file, file.name);
    xhr.send(fd);
  });
  return { promise, abort: () => xhr.abort() };
}

/** Read an image's natural size before upload so the layout doesn't jump. */
export function imageSize(file: File): Promise<{ width: number; height: number } | undefined> {
  if (!file.type.startsWith('image/')) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(undefined);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}
