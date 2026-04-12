'use client';

import AnswerSelector from './AnswerSelector';
import { formatWeight } from '@/lib/scoring';

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

interface QuestionCardProps {
  questionSnapshot: QuestionSnapshot;
  examQuestionId: number;
  selectedAnswerIds: number[];
  revealed?: boolean;
  scoreWeight?: number;
  onAnswerChange: (examQuestionId: number, ids: number[]) => void;
  questionNumber: number;
  totalQuestions: number;
}

export default function QuestionCard({
  questionSnapshot,
  examQuestionId,
  selectedAnswerIds,
  revealed = false,
  scoreWeight,
  onAnswerChange,
  questionNumber,
  totalQuestions,
}: QuestionCardProps) {
  const type = questionSnapshot.type === 'multiple' ? 'multiple' : 'single';
  const typeLabel = type === 'single' ? 'Single answer' : 'Multiple answers';
  const correctIds = questionSnapshot.answers
    .filter((answer) => answer.is_correct)
    .map((answer) => answer.id);

  const showScore = revealed && scoreWeight !== undefined;
  const scoreLabel = showScore ? `${formatWeight(scoreWeight!)}/1` : null;
  const scorePillClass = showScore
    ? scoreWeight === 1
      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
      : scoreWeight === 0
      ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
    : null;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
          Question {questionNumber} / {totalQuestions}
        </span>
        <div className="flex items-center gap-2">
          {showScore && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${scorePillClass}`}>
              {scoreLabel}
            </span>
          )}
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              type === 'single'
                ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                : 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400'
            }`}
          >
            {typeLabel}
          </span>
        </div>
      </div>

      <p className="mb-5 text-base font-medium leading-relaxed text-gray-900 dark:text-gray-100">
        {questionSnapshot.question_text}
      </p>

      {revealed && (
        <p className="mb-4 rounded-lg bg-gray-100 dark:bg-gray-700 px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
          Green = correct selection, red = wrong selection, amber = correct answer you missed.
        </p>
      )}

      <AnswerSelector
        type={type}
        answers={questionSnapshot.answers}
        selectedIds={selectedAnswerIds}
        correctIds={correctIds}
        revealed={revealed}
        onChange={(ids) => onAnswerChange(examQuestionId, ids)}
      />
    </div>
  );
}
