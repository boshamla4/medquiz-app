'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/apiClient';

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);

  useEffect(() => {
    if (retryAfterSeconds <= 0) return;
    const timer = setTimeout(() => setRetryAfterSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [retryAfterSeconds]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (retryAfterSeconds > 0) return;
    setLoading(true);

    try {
      const res = await apiPost('/api/auth/login', { token });
      const data = await res.json();

      if (res.ok) {
        router.push('/dashboard?welcome=1');
        return;
      }

      const code: string = data?.code ?? '';
      if (code === 'RATE_LIMITED') {
        const retrySeconds = Number(data?.retryAfterSeconds ?? 0);
        if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
          setRetryAfterSeconds(Math.floor(retrySeconds));
          setError(`Too many login attempts. Try again in ${Math.floor(retrySeconds)} seconds.`);
        } else {
          setError('Too many login attempts. Please wait before trying again.');
        }
      } else if (code === 'INVALID_TOKEN') {
        setError('Invalid token. Please check your credentials.');
      } else {
        const firstDetail = data?.details
          ? Object.values(data.details as Record<string, string[]>)
              .flat()
              .find((message) => typeof message === 'string' && message.length > 0)
          : null;
        setError(firstDetail ?? data?.error ?? 'An error occurred. Please try again.');
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">MedQuiz</h1>
          <p className="mt-3 text-sm font-medium text-blue-700">Welcome back</p>
          <p className="mt-2 text-sm text-gray-500">Enter your access token to continue</p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="token" className="block text-sm font-medium text-gray-700">
                Access Token
              </label>
              <input
                id="token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                autoComplete="off"
                autoFocus
                placeholder="Enter your token"
                className="mt-1.5 block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !token.trim() || retryAfterSeconds > 0}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Signing in…' : retryAfterSeconds > 0 ? `Try again in ${retryAfterSeconds}s` : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
