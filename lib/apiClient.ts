interface ApiRequestOptions {
  redirectOn401?: boolean;
}

async function handleResponse(res: Response, options?: ApiRequestOptions): Promise<Response> {
  const redirectOn401 = options?.redirectOn401 ?? true;

  if (res.status === 401 && redirectOn401) {
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }
  return res;
}

export async function apiGet(path: string, options?: ApiRequestOptions): Promise<Response> {
  const res = await fetch(path, { credentials: 'include' });
  return handleResponse(res, options);
}

export async function apiPost(path: string, body: object, options?: ApiRequestOptions): Promise<Response> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse(res, options);
}
