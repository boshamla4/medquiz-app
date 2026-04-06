'use client';

interface Answer {
  id: number;
  answer_text: string;
}

interface AnswerSelectorProps {
  type: 'single' | 'multiple';
  answers: Answer[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}

export default function AnswerSelector({ type, answers, selectedIds, onChange }: AnswerSelectorProps) {
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

        if (type === 'single') {
          return (
            <label
              key={answer.id}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                isSelected
                  ? 'border-blue-500 bg-blue-50 text-blue-900'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="answer"
                value={answer.id}
                checked={isSelected}
                onChange={() => handleSingleChange(answer.id)}
                className="h-4 w-4 text-blue-600"
              />
              <span className="text-sm text-gray-800">{answer.answer_text}</span>
            </label>
          );
        }

        return (
          <label
            key={answer.id}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
              isSelected
                ? 'border-blue-500 bg-blue-50 text-blue-900'
                : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <input
              type="checkbox"
              value={answer.id}
              checked={isSelected}
              onChange={(e) => handleMultipleChange(answer.id, e.target.checked)}
              className="h-4 w-4 rounded text-blue-600"
            />
            <span className="text-sm text-gray-800">{answer.answer_text}</span>
          </label>
        );
      })}
    </div>
  );
}
