'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import SessionGuard from '@/app/components/SessionGuard';
import { apiGet, apiPost } from '@/lib/apiClient';

interface FinalMockSection {
  subject: string;
  weightPercent: number;
  targetQuestions: number;
}

interface FinalMockConfig {
  program: string;
  totalQuestions: number;
  totalWeightPercent: number;
  sections: FinalMockSection[];
}

function FinalMockContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<FinalMockConfig | null>(null);

  useEffect(() => {
    async function loadConfig() {
      setLoading(true);
      setError('');

      try {
        const res = await apiGet('/api/exam/final-mock/start?program=Medicine&totalQuestions=100');
        const data = await res.json().catch(() => null);

        if (!res.ok) {
          setError(data?.error ?? 'Failed to load final mock details.');
          return;
        }

        setConfig(data as FinalMockConfig);
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    }

    loadConfig();
  }, []);

  async function handleStart() {
    setStarting(true);
    setError('');

    try {
      const res = await apiPost('/api/exam/final-mock/start', {
        totalQuestions: 100,
        program: 'Medicine',
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.error ?? 'Failed to start final mock exam.');
        return;
      }

      router.push(`/exam/${data.examId}`);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-900">
      <header className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">MedQuiz</h1>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Back to Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Final Mock</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-emerald-950 dark:text-emerald-100">Hello. You are about to start the 2025-style final mock exam.</h2>
          <p className="mt-3 text-sm text-emerald-900 dark:text-emerald-300">
            This exam uses a weighted subject blueprint based on the 2025 graduation exam profile.
            It targets {config?.totalQuestions ?? 100} questions and balances topic coverage by percentage.
          </p>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">2025 Weight Scale</h3>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {config ? `${Math.round(config.totalWeightPercent)}% total` : 'Loading...'}
              </span>
            </div>

            {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading weight distribution...</p>}

            {!loading && config && (
              <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    <tr>
                      <th className="px-4 py-3">Subject</th>
                      <th className="px-4 py-3">Weight</th>
                      <th className="px-4 py-3">Expected Questions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {config.sections.map((section) => (
                      <tr key={section.subject}>
                        <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{section.subject}</td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{section.weightPercent}%</td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{section.targetQuestions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Before You Start</h3>
            <ul className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-400">
              <li>Target size: {config?.totalQuestions ?? 100} questions</li>
              <li>Selection mode: weighted by 2025 subject profile</li>
              <li>Scoring mode: standard question scoring per item</li>
              <li>Question order: randomized at launch</li>
            </ul>

            <button
              type="button"
              onClick={handleStart}
              disabled={starting || loading || !config}
              className="mt-5 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {starting ? 'Starting final mock...' : 'Start Final Mock Exam'}
            </button>

            {error && (
              <p className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function FinalMockPage() {
  return (
    <SessionGuard>
      <FinalMockContent />
    </SessionGuard>
  );
}
