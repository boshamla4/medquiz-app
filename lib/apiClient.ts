async function handleResponse(res: Response): Promise<Response> {
  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }
  return res;
}

export async function apiGet(path: string): Promise<Response> {
  const res = await fetch(path, { credentials: 'include' });
  return handleResponse(res);
}

export async function apiPost(path: string, body: object): Promise<Response> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}
