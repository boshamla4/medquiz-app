'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SessionGuard from '@/app/components/SessionGuard';
import { apiGet, apiPost } from '@/lib/apiClient';

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
      alert(data?.error ?? 'Failed to retry exam.');
    } catch {
      alert('Network error. Please try again.');
    } finally {
      setRetrying(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading review…</p>
      </div>
    );
  }

  if (error || !exam) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <p className="mb-4 text-red-600">{error || 'Exam not found.'}</p>
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

  const correctCount = exam.questions.filter((q) => q.is_correct === true).length;
  const total = exam.questions.length;
  const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;

  const scoreColor =
    percentage >= 70 ? 'text-green-700' : percentage >= 50 ? 'text-yellow-700' : 'text-red-700';
  const scoreRingColor =
    percentage >= 70 ? 'ring-green-200 bg-green-50' : percentage >= 50 ? 'ring-yellow-200 bg-yellow-50' : 'ring-red-200 bg-red-50';

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">MedQuiz</h1>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-blue-600 hover:text-blue-800"
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
              <h2 className="text-lg font-semibold text-gray-900">Exam Results</h2>
              <p className="text-sm text-gray-500">
                Duration: {formatDuration(exam.duration)}
              </p>
            </div>
            <div className="text-right">
              <p className={`text-4xl font-bold ${scoreColor}`}>{percentage}%</p>
              <p className="text-sm text-gray-500">{correctCount}/{total} correct</p>
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
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {retrying ? 'Starting…' : 'Retry Wrong Only'}
          </button>
        </div>

        {/* Questions */}
        <div className="space-y-6">
          {exam.questions.map((q, idx) => {
            const snapshot = q.question_snapshot;
            const userAnswerIds = q.user_answer ?? [];
            const isCorrect = q.is_correct;

            return (
              <div
                key={q.id}
                className={`rounded-xl border bg-white p-6 ${
                  isCorrect === true
                    ? 'border-green-300'
                    : isCorrect === false
                    ? 'border-red-300'
                    : 'border-gray-200'
                }`}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <span className="text-xs text-gray-400">Q{idx + 1}</span>
                  {isCorrect === true && (
                    <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                      ✓ Correct
                    </span>
                  )}
                  {isCorrect === false && (
                    <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                      ✗ Incorrect
                    </span>
                  )}
                  {isCorrect === null && (
                    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                      Not answered
                    </span>
                  )}
                </div>

                <p className="mb-4 text-sm font-medium text-gray-900 leading-relaxed">
                  {snapshot.question_text}
                </p>

                <div className="space-y-2">
                  {snapshot.answers.map((answer) => {
                    const isUserSelected = userAnswerIds.includes(answer.id);
                    const isCorrectAnswer = answer.is_correct;

                    let bgClass = 'border-gray-200 bg-gray-50';
                    if (isCorrectAnswer && isUserSelected) {
                      bgClass = 'border-green-400 bg-green-50';
                    } else if (isCorrectAnswer && !isUserSelected) {
                      bgClass = 'border-green-300 bg-green-50 opacity-80';
                    } else if (!isCorrectAnswer && isUserSelected) {
                      bgClass = 'border-red-400 bg-red-50';
                    }

                    return (
                      <div
                        key={answer.id}
                        className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${bgClass}`}
                      >
                        <span className="flex-1 text-gray-800">{answer.answer_text}</span>
                        <div className="flex shrink-0 items-center gap-1">
                          {isUserSelected && (
                            <span className={`text-xs font-medium ${isCorrectAnswer ? 'text-green-700' : 'text-red-700'}`}>
                              {isCorrectAnswer ? '✓ Your answer' : '✗ Your answer'}
                            </span>
                          )}
                          {isCorrectAnswer && !isUserSelected && (
                            <span className="text-xs font-medium text-green-700">✓ Correct</span>
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
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <SessionGuard>
      <ReviewContent examId={examId} />
    </SessionGuard>
  );
}
