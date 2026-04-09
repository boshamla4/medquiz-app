'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SessionGuard from '@/app/components/SessionGuard';
import { apiGet, apiPost } from '@/lib/apiClient';

interface QuestionMeta {
  modules: string[];
  files: string[];
  types: string[];
  fileGroups: FileGroup[];
}

interface FileRow {
  source_file: string;
  folder: string;
  file_name: string;
  total_questions: number;
  available_questions?: number;
}

interface FileGroup {
  folder: string;
  total_questions: number;
  available_questions?: number;
  files: FileRow[];
}

interface ExamPreview {
  totalAvailable: number;
  plannedQuestionCount: number;
  totalMatchingBeforeHistory: number;
  fileRows: FileRow[];
  fileGroups: FileGroup[];
}

interface ExamHistoryEntry {
  id: number;
  score: number;
  total: number;
  started_at: string;
  finished_at: string | null;
}

interface DashboardStats {
  totalExams: number;
  latestScore: string;
  bestScore: string;
}

function scoreLabel(entry?: ExamHistoryEntry): string {
  if (!entry || entry.total <= 0) return 'No exams yet';
  const percent = Math.round((entry.score / entry.total) * 100);
  return `${entry.score}/${entry.total} (${percent}%)`;
}

function buildTrendPoints(entries: ExamHistoryEntry[]): Array<{ id: number; label: string; value: number }> {
  return entries
    .slice()
    .reverse()
    .map((entry) => ({
      id: entry.id,
      label: new Date(entry.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      value: entry.total > 0 ? Math.round((entry.score / entry.total) * 100) : 0,
    }));
}

function DashboardContent() {
  const router = useRouter();
  const [showExamModal, setShowExamModal] = useState(false);
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(false);
  const [meta, setMeta] = useState<QuestionMeta>({ modules: [], files: [], types: [], fileGroups: [] });
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<Array<'single' | 'multiple'>>([]);
  const [orderMode, setOrderMode] = useState<'preserve' | 'random'>('random');
  const [useAllQuestions, setUseAllQuestions] = useState(false);
  const [includeRepeated, setIncludeRepeated] = useState(true);
  const [wrongOnly, setWrongOnly] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<ExamPreview | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentHistory, setRecentHistory] = useState<ExamHistoryEntry[]>([]);
  const [timerMinutes, setTimerMinutes] = useState(0);
  const [limit, setLimit] = useState(20);
  const [examLoading, setExamLoading] = useState(false);
  const [examError, setExamError] = useState('');
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackWhatsapp, setFeedbackWhatsapp] = useState('');
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState('');

  useEffect(() => {
    if (!showWelcomeBanner) return;
    const timer = setTimeout(() => setShowWelcomeBanner(false), 5000);
    return () => clearTimeout(timer);
  }, [showWelcomeBanner]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('welcome') === '1') {
      setShowWelcomeBanner(true);
      params.delete('welcome');
      const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState(null, '', nextUrl);
    }
  }, []);

  useEffect(() => {
    if (!showExamModal || meta.fileGroups.length > 0) return;

    async function loadMeta() {
      try {
        const res = await apiGet('/api/questions?meta=1');
        if (!res.ok) {
          return;
        }

        const data = (await res.json()) as Partial<QuestionMeta>;
        setMeta({
          modules: Array.isArray(data.modules) ? data.modules : [],
          files: Array.isArray(data.files) ? data.files : [],
          types: Array.isArray(data.types) ? data.types : [],
          fileGroups: Array.isArray(data.fileGroups) ? data.fileGroups : [],
        });
      } catch {
        // Keep modal usable even if metadata loading fails.
      }
    }

    loadMeta();
  }, [showExamModal, meta.fileGroups.length]);

  useEffect(() => {
    if (!showExamModal) return;

    async function loadPreview() {
      setPreviewLoading(true);
      try {
        const body: Record<string, unknown> = {
          files: selectedFiles,
          questionTypes: selectedTypes,
          includeRepeated,
          wrongOnly,
          useAllQuestions,
          limit,
        };

        const res = await apiPost('/api/exam/preview', body);
        if (!res.ok) return;
        const data = (await res.json()) as ExamPreview;
        setPreview(data);
      } catch {
        // Ignore preview failures and keep form usable.
      } finally {
        setPreviewLoading(false);
      }
    }

    const timer = setTimeout(loadPreview, 250);
    return () => clearTimeout(timer);
  }, [showExamModal, selectedFiles, selectedTypes, includeRepeated, wrongOnly, useAllQuestions, limit]);

  useEffect(() => {
    async function loadStats() {
      setStatsLoading(true);
      try {
        const [recentRes, bestRes] = await Promise.all([
          apiGet('/api/exam/history?limit=5&sort=date'),
          apiGet('/api/exam/history?limit=1&sort=score'),
        ]);

        if (!recentRes.ok || !bestRes.ok) return;

        const recentData = (await recentRes.json()) as { data?: ExamHistoryEntry[]; total?: number };
        const bestData = (await bestRes.json()) as { data?: ExamHistoryEntry[]; total?: number };

        const recentEntries = recentData.data ?? [];
        const latest = recentEntries[0];
        const best = bestData.data?.[0];

        setRecentHistory(recentEntries);

        setStats({
          totalExams: Number(recentData.total ?? 0),
          latestScore: scoreLabel(latest),
          bestScore: scoreLabel(best ?? undefined),
        });
      } catch {
        setStats(null);
        setRecentHistory([]);
      } finally {
        setStatsLoading(false);
      }
    }

    loadStats();
  }, []);

  function toggleString(value: string, list: string[], setter: (value: string[]) => void) {
    if (list.includes(value)) {
      setter(list.filter((x) => x !== value));
      return;
    }
    setter([...list, value]);
  }

  function toggleType(value: 'single' | 'multiple') {
    if (selectedTypes.includes(value)) {
      setSelectedTypes(selectedTypes.filter((x) => x !== value));
      return;
    }
    setSelectedTypes([...selectedTypes, value]);
  }

  function startWeakModuleRetry() {
    setSelectedFiles([]);
    setSelectedTypes([]);
    setOrderMode('random');
    setUseAllQuestions(true);
    setIncludeRepeated(true);
    setWrongOnly(true);
    setLimit(20);
    setTimerMinutes(0);
    setShowExamModal(true);
  }

  async function handleStartFinalMockExam() {
    router.push('/final-mock');
  }

  function toggleGroupSelection(group: FileGroup) {
    const groupFiles = group.files.map((file) => file.source_file);
    const allSelected = groupFiles.every((file) => selectedFiles.includes(file));

    if (allSelected) {
      setSelectedFiles(selectedFiles.filter((file) => !groupFiles.includes(file)));
      return;
    }

    setSelectedFiles([...new Set([...selectedFiles, ...groupFiles])]);
  }

  async function submitFeedback(e: React.FormEvent) {
    e.preventDefault();
    const comment = feedbackComment.trim();
    if (!comment) return;

    setFeedbackLoading(true);
    setFeedbackStatus('');

    try {
      const res = await apiPost('/api/feedback', {
        comment,
        whatsapp: feedbackWhatsapp.trim() || undefined,
      });

      if (!res.ok) {
        const data = await res.json();
        setFeedbackStatus(data?.error ?? 'Failed to submit feedback.');
        return;
      }

      setFeedbackComment('');
      setFeedbackWhatsapp('');
      setFeedbackStatus('Thanks. Your feedback has been received.');
    } catch {
      setFeedbackStatus('Network error while sending feedback.');
    } finally {
      setFeedbackLoading(false);
    }
  }

  function resumeLatestExam() {
    const latest = recentHistory[0];
    if (!latest || latest.finished_at) return;
    router.push(`/exam/${latest.id}`);
  }

  const trendPoints = buildTrendPoints(recentHistory);
  const inProgressExam = recentHistory[0]?.finished_at === null ? recentHistory[0] : null;

  async function handleStartExam(e: React.FormEvent) {
    e.preventDefault();
    setExamError('');
    setExamLoading(true);

    try {
      const body: Record<string, unknown> = {
        limit,
        files: selectedFiles,
        questionTypes: selectedTypes,
        orderMode,
        useAllQuestions,
        includeRepeated,
        wrongOnly,
      };

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
        <div className="mx-auto grid max-w-5xl grid-cols-[auto_1fr_auto] items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900">MedQuiz</h1>
          <p className="justify-self-center rounded-full bg-amber-50 px-3 py-1 text-center text-xs font-medium text-amber-800 ring-1 ring-amber-200">
            Beta: Features and scoring details are still being refined.
          </p>
          <button
            onClick={handleLogout}
            disabled={logoutLoading}
            className="justify-self-end rounded-lg border border-gray-300 px-3.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {logoutLoading ? 'Logging out…' : 'Logout'}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        {showWelcomeBanner && (
          <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 shadow-sm">
            Welcome back. Your session is active and you can start a new exam whenever you are ready.
          </div>
        )}

        <div className="mb-8">
          <h2 className="text-3xl font-semibold tracking-tight text-gray-900">Mock Test Platform</h2>
          <p className="mt-2 text-sm text-gray-500">Configure your exam scope, question types, and pace before you begin.</p>
        </div>

        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

          <button
            onClick={handleStartFinalMockExam}
            disabled={examLoading}
            className="flex flex-col items-start gap-2 rounded-xl bg-emerald-50 p-6 text-left shadow-sm ring-1 ring-emerald-200 transition hover:shadow-md hover:ring-emerald-300"
          >
            <span className="text-2xl">🎯</span>
            <span className="text-base font-semibold text-emerald-900">Start Final Mock Exam</span>
            <span className="text-sm text-emerald-700">Random 200 questions across all files</span>
          </button>
        </div>

        {examError && (
          <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
            {examError}
          </div>
        )}

        <div className="mb-8 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Total Exams</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900">
              {statsLoading ? '…' : stats?.totalExams ?? 0}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Latest Score</p>
            <p className="mt-2 text-lg font-semibold text-gray-900">
              {statsLoading ? 'Loading…' : stats?.latestScore ?? 'No exams yet'}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Best Score</p>
            <p className="mt-2 text-lg font-semibold text-gray-900">
              {statsLoading ? 'Loading…' : stats?.bestScore ?? 'No exams yet'}
            </p>
          </div>
        </div>

        <div className="mb-8 grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm lg:col-span-2">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Trend</p>
                <h3 className="text-base font-semibold text-gray-900">Last 5 exam scores</h3>
              </div>
              <span className="text-xs text-gray-500">
                {statsLoading ? 'Loading…' : trendPoints.length > 0 ? 'Recent performance' : 'No data yet'}
              </span>
            </div>

            {trendPoints.length === 0 ? (
              <p className="text-sm text-gray-500">Take a few exams and your score trend will appear here.</p>
            ) : (
              <div className="flex items-end gap-3 overflow-x-auto pb-1">
                {trendPoints.map((point) => (
                  <div key={point.id} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                    <div className="flex h-28 w-full items-end justify-center rounded-xl bg-gray-50 px-2 py-2">
                      <div
                        className="w-full max-w-10 rounded-t-lg bg-gradient-to-t from-blue-600 to-cyan-400"
                        style={{ height: `${Math.max(8, point.value)}%` }}
                        title={`${point.value}%`}
                      />
                    </div>
                    <span className="text-xs font-semibold text-gray-700">{point.value}%</span>
                    <span className="text-[11px] text-gray-400">{point.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Shortcuts</p>
            <h3 className="mt-1 text-base font-semibold text-gray-900">Quick actions</h3>
            <div className="mt-4 space-y-3">
              <button
                type="button"
                onClick={handleStartFinalMockExam}
                disabled={examLoading}
                className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-left text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                <span className="block text-xs uppercase tracking-wide text-emerald-100">Final mock exam</span>
                <span className="block mt-1">Weighted 200-question simulation</span>
              </button>

              <button
                type="button"
                onClick={resumeLatestExam}
                disabled={!inProgressExam}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="block text-xs uppercase tracking-wide text-gray-400">Resume last exam</span>
                <span className="block mt-1">{inProgressExam ? `Exam #${inProgressExam.id}` : 'No exam in progress'}</span>
              </button>

              <button
                type="button"
                onClick={startWeakModuleRetry}
                className="w-full rounded-xl bg-blue-600 px-4 py-3 text-left text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                <span className="block text-xs uppercase tracking-wide text-blue-100">Retry weak modules</span>
                <span className="block mt-1">Start from previously wrong questions</span>
              </button>
            </div>
          </div>
        </div>

        <div className="mb-8 grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm lg:col-span-2">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Feedback</p>
                <h3 className="text-base font-semibold text-gray-900">Help improve the platform</h3>
              </div>
              <span className="text-xs text-gray-500">Optional contact is available below</span>
            </div>

            <form onSubmit={submitFeedback} className="space-y-3">
              <textarea
                value={feedbackComment}
                onChange={(e) => setFeedbackComment(e.target.value)}
                placeholder="Tell us what worked, what felt slow, or what should be improved next."
                rows={4}
                className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <input
                type="text"
                value={feedbackWhatsapp}
                onChange={(e) => setFeedbackWhatsapp(e.target.value)}
                placeholder="WhatsApp (optional)"
                className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-gray-500">Your feedback is attached to your account for follow-up.</p>
                <button
                  type="submit"
                  disabled={feedbackLoading || !feedbackComment.trim()}
                  className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {feedbackLoading ? 'Sending…' : 'Send feedback'}
                </button>
              </div>
              {feedbackStatus && (
                <p className={`text-sm ${feedbackStatus.startsWith('Thanks') ? 'text-emerald-700' : 'text-red-700'}`}>{feedbackStatus}</p>
              )}
            </form>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">History</p>
            <h3 className="mt-1 text-base font-semibold text-gray-900">Latest activity</h3>
            <div className="mt-4 space-y-3 text-sm text-gray-600">
              <div className="rounded-xl bg-gray-50 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-400">Latest score</p>
                <p className="mt-1 font-semibold text-gray-900">{statsLoading ? 'Loading…' : stats?.latestScore ?? 'No exams yet'}</p>
              </div>
              <div className="rounded-xl bg-gray-50 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-400">Best score</p>
                <p className="mt-1 font-semibold text-gray-900">{statsLoading ? 'Loading…' : stats?.bestScore ?? 'No exams yet'}</p>
              </div>
            </div>
          </div>
        </div>

      </main>

      {showExamModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-6 sm:items-center">
          <div className="my-auto w-full max-w-lg overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
            <div className="max-h-[calc(100vh-3rem)] overflow-y-auto p-6">
            <h3 className="mb-1 text-lg font-semibold text-gray-900">Configure New Exam</h3>
            <p className="mb-5 text-sm text-gray-500">Keep existing features, with a guided setup.</p>

            <form onSubmit={handleStartExam} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Files / Tests</label>
                <div className="max-h-52 space-y-2 overflow-auto rounded-lg border border-gray-200 p-2">
                  {meta.fileGroups.length === 0 && (
                    <p className="text-xs text-gray-400">No files detected yet.</p>
                  )}
                  {meta.fileGroups.map((group) => (
                    <div key={group.folder} className="rounded-md border border-gray-100 p-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-gray-800">{group.folder}</p>
                        <button
                          type="button"
                          onClick={() => toggleGroupSelection(group)}
                          className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                        >
                          {group.files.every((file) => selectedFiles.includes(file.source_file)) ? 'Unselect folder' : 'Select folder'}
                        </button>
                      </div>
                      <div className="space-y-1">
                        {group.files.map((file) => {
                          const previewRow = preview?.fileRows.find((r) => r.source_file === file.source_file);
                          return (
                            <label key={file.source_file} className="flex items-center justify-between gap-2 text-xs text-gray-700">
                              <span className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={selectedFiles.includes(file.source_file)}
                                  onChange={() => toggleString(file.source_file, selectedFiles, setSelectedFiles)}
                                  className="h-3.5 w-3.5"
                                />
                                <span className="truncate" title={file.file_name}>{file.file_name}</span>
                              </span>
                              <span className="whitespace-nowrap text-[11px] text-gray-500">
                                {file.total_questions} total
                                {typeof previewRow?.available_questions === 'number' && ` · ${previewRow.available_questions} available`}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Question Type</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => toggleType('single')}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                      selectedTypes.includes('single')
                        ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200'
                        : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200 hover:bg-gray-200'
                    }`}
                  >
                    CS / Single
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleType('multiple')}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                      selectedTypes.includes('multiple')
                        ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200'
                        : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200 hover:bg-gray-200'
                    }`}
                  >
                    CM / Multiple
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Ordering</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setOrderMode('preserve')}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                      orderMode === 'preserve'
                        ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200'
                        : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200 hover:bg-gray-200'
                    }`}
                  >
                    Preserve file order
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderMode('random')}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                      orderMode === 'random'
                        ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200'
                        : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200 hover:bg-gray-200'
                    }`}
                  >
                    Fully randomized
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={includeRepeated}
                    onChange={(e) => setIncludeRepeated(e.target.checked)}
                    className="h-4 w-4"
                    disabled={wrongOnly}
                  />
                  Allow repeated questions
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={wrongOnly}
                    onChange={(e) => setWrongOnly(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Only previously wrong questions
                </label>
              </div>

              <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                <p className="text-sm font-medium text-gray-700">Question count</p>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    checked={useAllQuestions}
                    onChange={() => setUseAllQuestions(true)}
                  />
                  Use all available questions
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    checked={!useAllQuestions}
                    onChange={() => setUseAllQuestions(false)}
                  />
                  Use reduced subset
                </label>
                {!useAllQuestions && (
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs text-gray-500">Subset size</span>
                      <span className="text-sm font-semibold text-blue-700">{limit}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={Math.max(1, Math.min(1000, preview?.totalAvailable ?? 100))}
                      step={1}
                      value={Math.min(limit, Math.max(1, preview?.totalAvailable ?? limit))}
                      onChange={(e) => setLimit(parseInt(e.target.value, 10) || 20)}
                      className="w-full accent-blue-600"
                    />
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                {previewLoading && <p>Calculating selected question counts...</p>}
                {!previewLoading && preview && (
                  <>
                    <p>Total matched before history filter: {preview.totalMatchingBeforeHistory}</p>
                    <p>Available after current filters: {preview.totalAvailable}</p>
                    <p>Questions in this test: {preview.plannedQuestionCount}</p>
                  </>
                )}
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
        </div>
      )}

      {examLoading && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
            <p className="text-sm font-medium text-gray-900">Preparing your exam...</p>
            <p className="mt-2 text-xs text-gray-500">Loading questions and answers. This can take a few seconds for large tests.</p>
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
