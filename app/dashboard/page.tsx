'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SessionGuard from '@/app/components/SessionGuard';
import { apiPost } from '@/lib/apiClient';

function DashboardContent() {
  const router = useRouter();
  const [showExamModal, setShowExamModal] = useState(false);
  const [module, setModule] = useState('');
  const [limit, setLimit] = useState(20);
  const [examLoading, setExamLoading] = useState(false);
  const [examError, setExamError] = useState('');
  const [logoutLoading, setLogoutLoading] = useState(false);

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
        router.push(`/exam/${data.examId}`);
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

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900">Welcome to MedQuiz</h2>
          <p className="mt-1 text-sm text-gray-500">What would you like to do?</p>
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
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">Configure New Exam</h3>

            <form onSubmit={handleStartExam} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Module <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={module}
                  onChange={(e) => setModule(e.target.value)}
                  placeholder="e.g. Cardiology"
                  className="mt-1.5 block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Number of questions
                </label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={limit}
                  onChange={(e) => setLimit(Math.max(1, parseInt(e.target.value) || 20))}
                  className="mt-1.5 block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {examError && (
                <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
                  {examError}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowExamModal(false); setExamError(''); }}
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
