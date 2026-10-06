/** Read the manager's JSON response, preserving the server's failure message. */
export async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

/** Callers supply an already serialized body; this only sets the request content type. */
export function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  return fetchJson(input, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

/** Download a binary response, preserving the server's JSON failure message. */
export async function fetchBlob(input: RequestInfo, init?: RequestInit): Promise<Blob> {
  const response = await fetch(input, init);
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `Request failed (${response.status})`); }
  return response.blob();
}
