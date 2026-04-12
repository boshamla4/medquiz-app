'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import SessionGuard from '@/app/components/SessionGuard';
import QuestionCard from '@/app/components/QuestionCard';
import ProgressTracker from '@/app/components/ProgressTracker';
import Timer from '@/app/components/Timer';
import { apiGet, apiPost } from '@/lib/apiClient';
import { scoreQuestion, scoreFeedback } from '@/lib/scoring';

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

interface ExamPageContentProps {
  examId: string;
}

function ExamPageContent({ examId }: ExamPageContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [exam, setExam] = useState<Exam | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<number, number[]>>(new Map());
  const answersRef = useRef<Map<number, number[]>>(new Map());
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [savingLater, setSavingLater] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const autoSubmittedRef = useRef(false);
  const initialQuestionRef = useRef<string | null>(null);

  if (initialQuestionRef.current === null) {
    initialQuestionRef.current = searchParams.get('q');
  }

  useEffect(() => {
    const initialQ = initialQuestionRef.current;

    async function loadExam() {
      try {
        const res = await apiGet(`/api/exam/${examId}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data?.error ?? 'Failed to load exam.');
          return;
        }
        const data: Exam = await res.json();

        if (data.finished_at) {
          router.replace(`/review/${examId}`);
          return;
        }

        setExam(data);
        const restored = new Map<number, number[]>();
        for (const question of data.questions) {
          if (Array.isArray(question.user_answer) && question.user_answer.length > 0) {
            restored.set(question.id, question.user_answer);
          }
        }
        answersRef.current = restored;
        setAnswers(restored);

        // Restore index from URL query param ?q=N
        if (initialQ) {
          const idx = parseInt(initialQ, 10) - 1;
          if (!isNaN(idx) && idx >= 0 && idx < data.questions.length) {
            setCurrentIndex(idx);
          }
        }
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    }
    loadExam();
  }, [examId, router]);

  const handleAnswerChange = useCallback((examQuestionId: number, ids: number[]) => {
    const next = new Map(answersRef.current);
    if (ids.length === 0) {
      next.delete(examQuestionId);
    } else {
      next.set(examQuestionId, ids);
    }
    answersRef.current = next;
    setAnswers(next);
  }, []);

  function navigateTo(index: number) {
    setCurrentIndex(index);
    const url = new URL(window.location.href);
    url.searchParams.set('q', String(index + 1));
    window.history.replaceState(null, '', url.toString());
  }

  const timerMinutes = Math.max(0, parseInt(searchParams.get('timer') ?? '0', 10) || 0);

  async function handleSubmit() {
    if (!exam || submitting) return;
    setSubmitError('');
    setSubmitting(true);

    try {
      const latestAnswers = answersRef.current;
      const answersPayload = exam.questions.map((q) => ({
        examQuestionId: q.id,
        selectedAnswerIds: latestAnswers.get(q.id) ?? [],
      }));

      const res = await apiPost('/api/exam/submit', {
        examId: exam.id,
        answers: answersPayload,
      });

      if (res.ok) {
        autoSubmittedRef.current = true;
        router.push(`/review/${examId}`);
        return;
      }

      const data = await res.json().catch(() => ({}));
      setSubmitError(data?.error ?? 'Failed to submit exam.');
    } catch {
      setSubmitError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleContinueLater() {
    if (!exam || savingLater || submitting) return;
    setSubmitError('');
    setSavingLater(true);

    try {
      const latestAnswers = answersRef.current;
      const answersPayload = exam.questions.map((q) => ({
        examQuestionId: q.id,
        selectedAnswerIds: latestAnswers.get(q.id) ?? [],
      }));

      const res = await apiPost('/api/exam/save-progress', {
        examId: exam.id,
        answers: answersPayload,
      });

      if (res.ok) {
        router.push('/dashboard');
        return;
      }

      const data = await res.json().catch(() => ({}));
      setSubmitError(data?.error ?? 'Failed to save progress.');
    } catch {
      setSubmitError('Network error. Please try again.');
    } finally {
      setSavingLater(false);
    }
  }

  function handleTimerExpire() {
    if (autoSubmittedRef.current) return;
    autoSubmittedRef.current = true;
    handleSubmit();
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading exam…</p>
      </div>
    );
  }

  if (error || !exam) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <p className="mb-4 text-red-600">{error || 'Exam not found.'}</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const current = exam.questions[currentIndex];
  const isLast = currentIndex === exam.questions.length - 1;
  const currentRevealed = revealed.has(current.id);
  const answeredCount = Array.from(answers.values()).filter((selected) => selected.length > 0).length;

  const selectedNow = answers.get(current.id) ?? [];
  const currentWeight = scoreQuestion(current.question_snapshot, selectedNow);

  function handleRevealCurrent() {
    setRevealed((prev) => {
      const next = new Set(prev);
      next.add(current.id);
      return next;
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div className="flex-1">
            <ProgressTracker
              current={currentIndex + 1}
              total={exam.questions.length}
            />
          </div>
          <Timer
            startedAt={exam.started_at}
            countdownMinutes={timerMinutes}
            onExpire={handleTimerExpire}
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <QuestionCard
          questionSnapshot={current.question_snapshot}
          examQuestionId={current.id}
          selectedAnswerIds={answers.get(current.id) ?? []}
          revealed={currentRevealed}
          scoreWeight={currentRevealed ? currentWeight : undefined}
          onAnswerChange={handleAnswerChange}
          questionNumber={currentIndex + 1}
          totalQuestions={exam.questions.length}
        />

        {currentRevealed && (
          <div
            className={`mt-4 rounded-lg px-4 py-3 text-sm font-medium ring-1 ${
              currentWeight === 1
                ? 'bg-green-50 text-green-700 ring-green-200'
                : currentWeight === 0
                ? 'bg-red-50 text-red-700 ring-red-200'
                : 'bg-amber-50 text-amber-700 ring-amber-200'
            }`}
          >
            {scoreFeedback(currentWeight)}
          </div>
        )}

        {submitError && (
          <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
            {submitError}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            onClick={() => navigateTo(currentIndex - 1)}
            disabled={currentIndex === 0}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Previous
          </button>

          <span className="text-xs text-gray-400">
            {answeredCount} / {exam.questions.length} answered
          </span>

          {!currentRevealed ? (
            <button
              onClick={handleRevealCurrent}
              disabled={selectedNow.length === 0}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Check Answer
            </button>
          ) : isLast ? (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit Exam'}
            </button>
          ) : (
            <button
              onClick={() => navigateTo(currentIndex + 1)}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Next →
            </button>
          )}
        </div>

        {/* Quick submit button available throughout */}
        {!isLast && (
          <div className="mt-4 text-center">
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={handleContinueLater}
                disabled={savingLater || submitting}
                className="text-sm font-medium text-blue-600 underline hover:text-blue-700 disabled:opacity-50"
              >
                {savingLater ? 'Saving…' : 'Continue later'}
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || savingLater}
                className="text-sm font-medium text-gray-500 underline hover:text-gray-700 disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Submit exam now'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function ExamPage({ params }: { params: Promise<{ examId: string }> }) {
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
      <ExamPageContent examId={examId} />
    </SessionGuard>
  );
}
