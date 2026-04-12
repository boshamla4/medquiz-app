'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SessionGuard from '@/app/components/SessionGuard';
import { apiGet, apiPost } from '@/lib/apiClient';
import { scoreQuestion, formatWeight } from '@/lib/scoring';

interface Answer {
  id: number;
  answer_text: string;
  is_correct: boolean;
}

interface QuestionSnapshot {
  id: number;
  type: string;
  question_text: string;
  answers: Answer[];
}

interface ExamQuestion {
  id: number;
  question_id: number;
  question_snapshot: QuestionSnapshot;
  user_answer: number[] | null;
  is_correct: boolean | null;
}

interface Exam {
  id: number;
  started_at: string;
  finished_at: string | null;
  duration: number | null;
  questions: ExamQuestion[];
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

interface ReviewContentProps {
  examId: string;
}

function ReviewContent({ examId }: ReviewContentProps) {
  const router = useRouter();
  const [exam, setExam] = useState<Exam | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState('');

  useEffect(() => {
    async function loadExam() {
      try {
        const res = await apiGet(`/api/exam/${examId}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data?.error ?? 'Failed to load exam.');
          return;
        }
        const data: Exam = await res.json();
        setExam(data);
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    }
    loadExam();
  }, [examId]);

  async function handleRetry(filter: 'all' | 'wrong_only') {
    setRetryError('');
    setRetrying(true);
    try {
      const res = await apiPost('/api/exam/retry', {
        examId: Number(examId),
        filter,
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <p className="text-gray-500 dark:text-gray-400">Loading review…</p>
      </div>
    );
  }

  if (error || !exam) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
        <div className="text-center">
          <p className="mb-4 text-red-600 dark:text-red-400">{error || 'Exam not found.'}</p>
          <Link
            href="/dashboard"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const total = exam.questions.length;

  const questionWeights = exam.questions.map((q) =>
    scoreQuestion(q.question_snapshot, q.user_answer ?? [])
  );
  const weightedScore = questionWeights.reduce((sum, w) => sum + w, 0);
  const percentage = total > 0 ? Math.round((weightedScore / total) * 100) : 0;

  const scoreColor =
    percentage >= 70
      ? 'text-green-700 dark:text-green-400'
      : percentage >= 50
      ? 'text-yellow-700 dark:text-yellow-400'
      : 'text-red-700 dark:text-red-400';
  const scoreRingColor =
    percentage >= 70
      ? 'ring-green-200 dark:ring-green-800 bg-green-50 dark:bg-green-900/20'
      : percentage >= 50
      ? 'ring-yellow-200 dark:ring-yellow-800 bg-yellow-50 dark:bg-yellow-900/20'
      : 'ring-red-200 dark:ring-red-800 bg-red-50 dark:bg-red-900/20';

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-900">
      <header className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">MedQuiz</h1>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        {/* Score summary */}
        <div className={`mb-6 rounded-xl p-6 ring-1 ${scoreRingColor}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Exam Results</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Duration: {formatDuration(exam.duration)}
              </p>
            </div>
            <div className="text-right">
              <p className={`text-4xl font-bold ${scoreColor}`}>{percentage}%</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {formatWeight(Math.round(weightedScore * 100) / 100)}/{total} points
              </p>
            </div>
          </div>
        </div>

        {/* Retry buttons */}
        <div className="mb-8 flex flex-wrap gap-3">
          <button
            onClick={() => handleRetry('all')}
            disabled={retrying}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {retrying ? 'Starting…' : 'Retry All'}
          </button>
          <button
            onClick={() => handleRetry('wrong_only')}
            disabled={retrying}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {retrying ? 'Starting…' : 'Retry Wrong Only'}
          </button>
        </div>

        {retryError && (
          <div className="mb-6 rounded-lg bg-red-50 dark:bg-red-900/30 px-4 py-3 text-sm text-red-700 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-800">
            {retryError}
          </div>
        )}

        {/* Questions */}
        <div className="space-y-6">
          {exam.questions.map((q, idx) => {
            const snapshot = q.question_snapshot;
            const userAnswerIds = q.user_answer ?? [];
            const weight = questionWeights[idx];
            const isPartial = weight > 0 && weight < 1;
            const notAnswered = q.user_answer === null || q.user_answer.length === 0;

            const borderClass = notAnswered
              ? 'border-gray-200 dark:border-gray-700'
              : weight === 1
              ? 'border-green-300 dark:border-green-700'
              : weight === 0
              ? 'border-red-300 dark:border-red-700'
              : 'border-amber-300 dark:border-amber-700';

            return (
              <div
                key={q.id}
                className={`rounded-xl border bg-white dark:bg-gray-800 p-6 ${borderClass}`}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <span className="text-xs text-gray-400 dark:text-gray-500">Q{idx + 1}</span>
                  <div className="flex items-center gap-2">
                    {!notAnswered && (
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          weight === 1
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                            : weight === 0
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                        }`}
                      >
                        {formatWeight(weight)}/1
                      </span>
                    )}
                    {weight === 1 && (
                      <span className="rounded-full bg-green-100 dark:bg-green-900/40 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                        ✓ Correct
                      </span>
                    )}
                    {weight === 0 && !notAnswered && (
                      <span className="rounded-full bg-red-100 dark:bg-red-900/40 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
                        ✗ Incorrect
                      </span>
                    )}
                    {isPartial && (
                      <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                        ~ Partial
                      </span>
                    )}
                    {notAnswered && (
                      <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-2.5 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                        Not answered
                      </span>
                    )}
                  </div>
                </div>

                <p className="mb-4 text-sm font-medium text-gray-900 dark:text-gray-100 leading-relaxed">
                  {snapshot.question_text}
                </p>

                <div className="space-y-2">
                  {snapshot.answers.map((answer) => {
                    const isUserSelected = userAnswerIds.includes(answer.id);
                    const isCorrectAnswer = answer.is_correct;

                    let bgClass = 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50';
                    if (isCorrectAnswer && isUserSelected) {
                      bgClass = 'border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/30';
                    } else if (isCorrectAnswer && !isUserSelected) {
                      bgClass = 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 opacity-80';
                    } else if (!isCorrectAnswer && isUserSelected) {
                      bgClass = 'border-red-400 dark:border-red-600 bg-red-50 dark:bg-red-900/30';
                    }

                    return (
                      <div
                        key={answer.id}
                        className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${bgClass}`}
                      >
                        <span className="flex-1 text-gray-800 dark:text-gray-200">{answer.answer_text}</span>
                        <div className="flex shrink-0 items-center gap-1">
                          {isUserSelected && (
                            <span className={`text-xs font-medium ${isCorrectAnswer ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                              {isCorrectAnswer ? '✓ Your answer' : '✗ Your answer'}
                            </span>
                          )}
                          {isCorrectAnswer && !isUserSelected && (
                            <span className="text-xs font-medium text-green-700 dark:text-green-400">✓ Correct</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

export default function ReviewPage({ params }: { params: Promise<{ examId: string }> }) {
  const [examId, setExamId] = useState<string | null>(null);

  useEffect(() => {
    params.then((p) => setExamId(p.examId));
  }, [params]);

  if (!examId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <p className="text-gray-500 dark:text-gray-400">Loading…</p>
      </div>
    );
  }

  return (
    <SessionGuard>
      <ReviewContent examId={examId} />
    </SessionGuard>
  );
}
