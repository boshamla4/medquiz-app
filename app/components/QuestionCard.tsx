'use client';

import AnswerSelector from './AnswerSelector';

interface Answer {
  id: number;
  answer_text: string;
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
  onAnswerChange: (examQuestionId: number, ids: number[]) => void;
  questionNumber: number;
  totalQuestions: number;
}

export default function QuestionCard({
  questionSnapshot,
  examQuestionId,
  selectedAnswerIds,
  onAnswerChange,
  questionNumber,
  totalQuestions,
}: QuestionCardProps) {
  const type = questionSnapshot.type === 'multiple' ? 'multiple' : 'single';
  const typeLabel = type === 'single' ? 'Single answer' : 'Multiple answers';

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
          Question {questionNumber} / {totalQuestions}
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            type === 'single'
              ? 'bg-green-100 text-green-700'
              : 'bg-purple-100 text-purple-700'
          }`}
        >
          {typeLabel}
        </span>
      </div>

      <p className="mb-5 text-base font-medium leading-relaxed text-gray-900">
        {questionSnapshot.question_text}
      </p>

      <AnswerSelector
        type={type}
        answers={questionSnapshot.answers}
        selectedIds={selectedAnswerIds}
        onChange={(ids) => onAnswerChange(examQuestionId, ids)}
      />
    </div>
  );
}
