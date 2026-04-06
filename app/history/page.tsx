'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SessionGuard from '@/app/components/SessionGuard';
import { apiGet, apiPost } from '@/lib/apiClient';

interface HistoryEntry {
  id: number;
  started_at: string;
  finished_at: string | null;
  duration: number | null;
  score: number;
  total: number;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function HistoryContent() {
  const router = useRouter();
  const [exams, setExams] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryModal, setRetryModal] = useState<{ examId: number } | null>(null);
  const [retryFilter, setRetryFilter] = useState<'all' | 'wrong_only'>('all');
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState('');

  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await apiGet('/api/exam/history');
        if (!res.ok) {
          setError('Failed to load history.');
          return;
        }
        const data = await res.json();
        setExams(data.data ?? []);
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    }
    loadHistory();
  }, []);

  async function handleRetry(e: React.FormEvent) {
    e.preventDefault();
    if (!retryModal) return;
    setRetryError('');
    setRetrying(true);

    try {
      const res = await apiPost('/api/exam/retry', {
        examId: retryModal.examId,
        filter: retryFilter,
      });
      const data = await res.json();

      if (res.ok) {
        router.push(`/exam/${data.examId}`);
        return;
      }

      setRetryError(data?.error ?? 'Failed to retry exam.');
    } catch {
      setRetryError('Network error. Please try again.');
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">MedQuiz</h1>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h2 className="mb-6 text-2xl font-semibold text-gray-900">Exam History</h2>

        {loading && (
          <p className="text-gray-500">Loading history…</p>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
            {error}
          </div>
        )}

        {!loading && !error && exams.length === 0 && (
          <div className="rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-gray-200">
            <p className="text-gray-500">No exams yet. Start your first exam!</p>
            <Link
              href="/dashboard"
              className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Go to Dashboard
            </Link>
          </div>
        )}

        {!loading && exams.length > 0 && (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Duration</th>
                  <th className="px-4 py-3 text-left">Score</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {exams.map((exam) => {
                  const percentage = exam.total > 0
                    ? Math.round((exam.score / exam.total) * 100)
                    : 0;
                  const scoreColor =
                    percentage >= 70
                      ? 'text-green-700'
                      : percentage >= 50
                      ? 'text-yellow-700'
                      : 'text-red-700';

                  return (
                    <tr key={exam.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900">
                        {formatDate(exam.started_at)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {formatDuration(exam.duration)}
                      </td>
                      <td className={`px-4 py-3 font-medium ${scoreColor}`}>
                        {exam.score}/{exam.total}
                        {exam.total > 0 && (
                          <span className="ml-1 text-xs text-gray-400">
                            ({percentage}%)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {exam.finished_at && (
                            <Link
                              href={`/review/${exam.id}`}
                              className="rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
                            >
                              Review
                            </Link>
                          )}
                          <button
                            onClick={() => {
                              setRetryModal({ examId: exam.id });
                              setRetryFilter('all');
                              setRetryError('');
                            }}
                            className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                          >
                            Retry
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {retryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">Retry Exam</h3>

            <form onSubmit={handleRetry} className="space-y-4">
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-gray-700">
                  Questions to include
                </legend>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 cursor-pointer hover:bg-gray-50">
                    <input
                      type="radio"
                      name="filter"
                      value="all"
                      checked={retryFilter === 'all'}
                      onChange={() => setRetryFilter('all')}
                      className="text-blue-600"
                    />
                    <span className="text-sm text-gray-800">All questions</span>
                  </label>
                  <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 cursor-pointer hover:bg-gray-50">
                    <input
                      type="radio"
                      name="filter"
                      value="wrong_only"
                      checked={retryFilter === 'wrong_only'}
                      onChange={() => setRetryFilter('wrong_only')}
                      className="text-blue-600"
                    />
                    <span className="text-sm text-gray-800">Wrong answers only</span>
                  </label>
                </div>
              </fieldset>

              {retryError && (
                <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
                  {retryError}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setRetryModal(null)}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={retrying}
                  className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {retrying ? 'Starting…' : 'Start Retry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HistoryPage() {
  return (
    <SessionGuard>
      <HistoryContent />
    </SessionGuard>
  );
}
