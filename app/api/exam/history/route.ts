import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';

interface ExamRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  duration: number | null;
  exam_questions: { is_correct: boolean | null; score_weight: number | null }[] | null;
}

function computeScore(questionRows: { is_correct: boolean | null; score_weight: number | null }[]): number {
  // Use score_weight when available (weighted scoring); fall back to boolean count for legacy rows.
  const hasWeights = questionRows.some((q) => q.score_weight !== null && q.score_weight !== undefined);
  if (hasWeights) {
    const sum = questionRows.reduce((s, q) => s + (q.score_weight ?? (q.is_correct ? 1 : 0)), 0);
    return Math.round(sum * 100) / 100;
  }
  return questionRows.filter((q) => q.is_correct === true).length;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;

  const { searchParams } = request.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '10', 10) || 10);
  const sort = searchParams.get('sort') === 'score' ? 'score' : 'date';
  const offset = (page - 1) * limit;

  const selectClause = 'id, started_at, finished_at, duration, exam_questions(is_correct, score_weight)';

  let exams: ExamRow[] = [];
  let total = 0;

  if (sort === 'score') {
    const { data: scoreRows, error: scoreError } = await db
      .from('exams')
      .select(selectClause)
      .eq('user_id', session.userId);

    if (scoreError || !scoreRows) {
      return NextResponse.json(
        { error: 'Failed to load exam history', code: 'EXAM_HISTORY_FETCH_FAILED' },
        { status: 500 }
      );
    }

    const ranked = scoreRows
      .map((row) => {
        const questionRows = row.exam_questions ?? [];
        const correctCount = computeScore(questionRows);
        return { row, correctCount };
      })
      .sort((a, b) => {
        if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
        return new Date(b.row.started_at).getTime() - new Date(a.row.started_at).getTime();
      });

    total = ranked.length;
    exams = ranked.slice(offset, offset + limit).map((entry) => entry.row as ExamRow);
  } else {
    const { data: dateRows, error: dateError, count } = await db
      .from('exams')
      .select(selectClause, { count: 'exact' })
      .eq('user_id', session.userId)
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (dateError || !dateRows) {
      return NextResponse.json(
        { error: 'Failed to load exam history', code: 'EXAM_HISTORY_FETCH_FAILED' },
        { status: 500 }
      );
    }

    exams = dateRows as ExamRow[];
    total = count ?? 0;
  }

  const data = exams.map((e) => {
    const questionRows = e.exam_questions ?? [];
    const correctCount = computeScore(questionRows);

    return {
    id: e.id,
    started_at: e.started_at,
    finished_at: e.finished_at,
    duration: e.duration,
    score: correctCount,
    total: questionRows.length,
  };
  });

  return NextResponse.json({ data, total });
}
