'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SessionGuard from '@/app/components/SessionGuard';
import { apiGet, apiPost } from '@/lib/apiClient';

function DashboardContent() {
  const router = useRouter();
  const [showExamModal, setShowExamModal] = useState(false);
  const [module, setModule] = useState('');
  const [modules, setModules] = useState<string[]>([]);
  const [modulesLoading, setModulesLoading] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState(0);
  const [limit, setLimit] = useState(20);
  const [examLoading, setExamLoading] = useState(false);
  const [examError, setExamError] = useState('');
  const [logoutLoading, setLogoutLoading] = useState(false);

  useEffect(() => {
    if (!showExamModal || modules.length > 0) return;

    async function loadModules() {
      setModulesLoading(true);
      try {
        const res = await apiGet('/api/questions?modules=1');
        if (!res.ok) {
          return;
        }

        const data = (await res.json()) as { modules?: string[] };
        setModules(Array.isArray(data.modules) ? data.modules : []);
      } catch {
        // Keep modal usable even if module list fails.
      } finally {
        setModulesLoading(false);
      }
    }

    loadModules();
  }, [showExamModal, modules.length]);

  async function handleStartExam(e: React.FormEvent) {
    e.preventDefault();
    setExamError('');
    setExamLoading(true);

    try {
      const body: Record<string, unknown> = { limit };
      if (module.trim()) body.module = module.trim();

      const res = await apiPost('/api/exam/start', body);
      const data = await res.json();

      if (res.ok) {
        const timerQuery = timerMinutes > 0 ? `?timer=${timerMinutes}` : '';
        router.push(`/exam/${data.examId}${timerQuery}`);
        return;
      }

      setExamError(data?.error ?? 'Failed to start exam.');
    } catch {
      setExamError('Network error. Please try again.');
    } finally {
      setExamLoading(false);
    }
  }

  async function handleLogout() {
    setLogoutLoading(true);
    try {
      await apiPost('/api/auth/logout', {});
    } catch {
      // Ignore errors — redirect anyway
    }
    router.push('/login');
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">MedQuiz</h1>
          <button
            onClick={handleLogout}
            disabled={logoutLoading}
            className="rounded-lg border border-gray-300 px-3.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {logoutLoading ? 'Logging out…' : 'Logout'}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <div className="mb-8">
          <h2 className="text-3xl font-semibold tracking-tight text-gray-900">Mock Test Platform</h2>
          <p className="mt-2 text-sm text-gray-500">Select a module, configure your exam, and start practicing.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <button
            onClick={() => setShowExamModal(true)}
            className="flex flex-col items-start gap-2 rounded-xl bg-white p-6 text-left shadow-sm ring-1 ring-gray-200 transition hover:shadow-md hover:ring-blue-300"
          >
            <span className="text-2xl">📝</span>
            <span className="text-base font-semibold text-gray-900">Start New Exam</span>
            <span className="text-sm text-gray-500">Configure and begin a new QCM session</span>
          </button>

          <Link
            href="/history"
            className="flex flex-col items-start gap-2 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-200 transition hover:shadow-md hover:ring-blue-300"
          >
            <span className="text-2xl">📋</span>
            <span className="text-base font-semibold text-gray-900">View History</span>
            <span className="text-sm text-gray-500">Browse your past exams and results</span>
          </Link>
        </div>
      </main>

      {showExamModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-lg font-semibold text-gray-900">Configure New Exam</h3>
            <p className="mb-5 text-sm text-gray-500">Keep existing features, with a guided setup.</p>

            <form onSubmit={handleStartExam} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Module <span className="text-gray-400">(optional)</span>
                </label>
                <select
                  value={module}
                  onChange={(e) => setModule(e.target.value)}
                  className="mt-1.5 block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  disabled={modulesLoading}
                >
                  <option value="">All modules</option>
                  {modules.map((moduleName) => (
                    <option key={moduleName} value={moduleName}>
                      {moduleName}
                    </option>
                  ))}
                </select>
                {modulesLoading && (
                  <p className="mt-1 text-xs text-gray-400">Loading modules...</p>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-700">Number of questions</label>
                  <span className="text-sm font-semibold text-blue-700">{limit}</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={limit}
                  onChange={(e) => setLimit(parseInt(e.target.value, 10) || 20)}
                  className="w-full accent-blue-600"
                />
                <p className="mt-1 text-xs text-gray-400">Choose between 5 and 100 questions</p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Timer</label>
                <div className="flex flex-wrap gap-2">
                  {[0, 30, 60, 90].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setTimerMinutes(value)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                        timerMinutes === value
                          ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200'
                          : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200 hover:bg-gray-200'
                      }`}
                    >
                      {value === 0 ? 'No timer' : `${value} min`}
                    </button>
                  ))}
                </div>
              </div>

              {examError && (
                <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
                  {examError}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowExamModal(false);
                    setExamError('');
                  }}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={examLoading}
                  className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {examLoading ? 'Starting…' : 'Start Exam'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <SessionGuard>
      <DashboardContent />
    </SessionGuard>
  );
}
