import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';

const SubmitAnswerSchema = z.object({
  examQuestionId: z.number().int().positive(),
  selectedAnswerIds: z.array(z.number().int().positive()),
});

const SubmitExamSchema = z.object({
  examId: z.number().int().positive(),
  answers: z.array(SubmitAnswerSchema),
});

interface ExamRow {
  id: number;
  user_id: number;
  started_at: string;
  finished_at: string | null;
}

interface ExamQuestionRow {
  id: number;
  question_id: number;
  question_snapshot: string;
}

interface SnapshotAnswer {
  id: number;
  answer_text: string;
  is_correct: boolean;
}

interface QuestionSnapshot {
  id: number;
  type: string;
  answers: SnapshotAnswer[];
}

interface InsertResult {
  changes: number;
}

function isAnswerCorrect(snapshot: QuestionSnapshot, selectedIds: number[]): boolean {
  const correctIds = snapshot.answers
    .filter((a) => a.is_correct)
    .map((a) => a.id)
    .sort((a, b) => a - b);

  const selected = [...selectedIds].sort((a, b) => a - b);

  if (correctIds.length !== selected.length) return false;
  return correctIds.every((id, i) => id === selected[i]);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'INVALID_BODY' },
      { status: 400 }
    );
  }

  const parsed = SubmitExamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', code: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  }

  const { examId, answers } = parsed.data;

  const exam = db
    .prepare('SELECT id, user_id, started_at, finished_at FROM exams WHERE id = ?')
    .get(examId) as ExamRow | undefined;

  if (!exam || exam.user_id !== session.userId) {
    return NextResponse.json(
      { error: 'Exam not found', code: 'EXAM_NOT_FOUND' },
      { status: 404 }
    );
  }

  if (exam.finished_at) {
    return NextResponse.json(
      { error: 'Exam already submitted', code: 'EXAM_ALREADY_SUBMITTED' },
      { status: 400 }
    );
  }

  const examQuestions = db
    .prepare('SELECT id, question_id, question_snapshot FROM exam_questions WHERE exam_id = ?')
    .all(examId) as ExamQuestionRow[];

  const eqMap = new Map<number, ExamQuestionRow>();
  for (const eq of examQuestions) {
    eqMap.set(eq.id, eq);
  }

  const updateEQ = db.prepare(
    'UPDATE exam_questions SET user_answer = ?, is_correct = ? WHERE id = ?'
  );

  let correctCount = 0;
  const results: {
    examQuestionId: number;
    selectedAnswerIds: number[];
    is_correct: boolean;
  }[] = [];

  const processAnswers = db.transaction(() => {
    for (const answer of answers) {
      const eq = eqMap.get(answer.examQuestionId);
      if (!eq) continue;

      const snapshot = JSON.parse(eq.question_snapshot) as QuestionSnapshot;
      const correct = isAnswerCorrect(snapshot, answer.selectedAnswerIds);

      if (correct) correctCount++;

      updateEQ.run(
        JSON.stringify(answer.selectedAnswerIds),
        correct ? 1 : 0,
        eq.id
      ) as InsertResult;

      results.push({
        examQuestionId: eq.id,
        selectedAnswerIds: answer.selectedAnswerIds,
        is_correct: correct,
      });
    }
  });

  processAnswers();

  const finishedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const startedAt = new Date(exam.started_at);
  const duration = Math.round((Date.now() - startedAt.getTime()) / 1000);

  db.prepare(
    'UPDATE exams SET finished_at = ?, duration = ? WHERE id = ?'
  ).run(finishedAt, duration, examId);

  return NextResponse.json({
    score: correctCount,
    total: examQuestions.length,
    duration,
    results,
  });
}
