'use client';

interface Answer {
  id: number;
  answer_text: string;
}

interface AnswerSelectorProps {
  type: 'single' | 'multiple';
  answers: Answer[];
  selectedIds: number[];
  correctIds?: number[];
  revealed?: boolean;
  onChange: (ids: number[]) => void;
}

export default function AnswerSelector({
  type,
  answers,
  selectedIds,
  correctIds = [],
  revealed = false,
  onChange,
}: AnswerSelectorProps) {
  function handleSingleChange(id: number) {
    onChange([id]);
  }

  function handleMultipleChange(id: number, checked: boolean) {
    if (checked) {
      onChange([...selectedIds, id]);
    } else {
      onChange(selectedIds.filter((x) => x !== id));
    }
  }

  return (
    <div className="space-y-2">
      {answers.map((answer) => {
        const isSelected = selectedIds.includes(answer.id);
        const isCorrect = correctIds.includes(answer.id);

        let stateClass = 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50';
        if (revealed) {
          if (isCorrect && isSelected) {
            stateClass = 'border-green-400 bg-green-50 text-green-900';
          } else if (isCorrect && !isSelected) {
            stateClass = 'border-amber-400 bg-amber-50 text-amber-900';
          } else if (!isCorrect && isSelected) {
            stateClass = 'border-red-400 bg-red-50 text-red-900';
          } else {
            stateClass = 'border-gray-200 bg-gray-50 text-gray-700';
          }
        } else if (isSelected) {
          stateClass = 'border-blue-500 bg-blue-50 text-blue-900';
        }

        if (type === 'single') {
          return (
            <label
              key={answer.id}
              className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${revealed ? 'cursor-default' : 'cursor-pointer'} ${stateClass}`}
            >
              <input
                type="radio"
                name="answer"
                value={answer.id}
                checked={isSelected}
                onChange={() => handleSingleChange(answer.id)}
                disabled={revealed}
                className="h-4 w-4 text-blue-600"
              />
              <span className="text-sm text-gray-800">{answer.answer_text}</span>
            </label>
          );
        }

        return (
          <label
            key={answer.id}
            className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${revealed ? 'cursor-default' : 'cursor-pointer'} ${stateClass}`}
          >
            <input
              type="checkbox"
              value={answer.id}
              checked={isSelected}
              onChange={(e) => handleMultipleChange(answer.id, e.target.checked)}
              disabled={revealed}
              className="h-4 w-4 rounded text-blue-600"
            />
            <span className="text-sm text-gray-800">{answer.answer_text}</span>
          </label>
        );
      })}
    </div>
  );
}
