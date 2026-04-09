import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';

const SaveAnswerSchema = z.object({
  examQuestionId: z.number().int().positive(),
  selectedAnswerIds: z.array(z.number().int().positive()),
});

const SaveProgressSchema = z.object({
  examId: z.number().int().positive(),
  answers: z.array(SaveAnswerSchema),
});

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

  const parsed = SaveProgressSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const { examId, answers } = parsed.data;

  const { data: exam, error: examError } = await db
    .from('exams')
    .select('id, finished_at')
    .eq('id', examId)
    .eq('user_id', session.userId)
    .maybeSingle();

  if (examError) {
    return NextResponse.json(
      { error: 'Failed to verify exam', code: 'EXAM_LOOKUP_FAILED' },
      { status: 500 }
    );
  }

  if (!exam) {
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

  const updateBatchSize = 50;

  for (let i = 0; i < answers.length; i += updateBatchSize) {
    const batch = answers.slice(i, i + updateBatchSize);
    const settled = await Promise.allSettled(
      batch.map((entry) =>
        db
          .from('exam_questions')
          .update({
            user_answer: JSON.stringify(entry.selectedAnswerIds),
          })
          .eq('id', entry.examQuestionId)
          .eq('exam_id', examId)
      )
    );

    for (const result of settled) {
      if (result.status === 'rejected' || result.value.error) {
        return NextResponse.json(
          { error: 'Failed to save progress', code: 'SAVE_PROGRESS_FAILED' },
          { status: 500 }
        );
      }
    }
  }

  return NextResponse.json({ success: true, saved: answers.length });
}
