import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';

interface ExamRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  duration: number | null;
  correct_count: number;
  total_count: number;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;

  const { searchParams } = request.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '10', 10) || 10);
  const sort = searchParams.get('sort') === 'score' ? 'score' : 'date';
  const offset = (page - 1) * limit;

  const orderBy =
    sort === 'score'
      ? 'correct_count DESC, e.started_at DESC'
      : 'e.started_at DESC';

  const exams = db
    .prepare(
      `SELECT
         e.id,
         e.started_at,
         e.finished_at,
         e.duration,
         COUNT(CASE WHEN eq.is_correct = 1 THEN 1 END) AS correct_count,
         COUNT(eq.id) AS total_count
       FROM exams e
       LEFT JOIN exam_questions eq ON eq.exam_id = e.id
       WHERE e.user_id = ?
       GROUP BY e.id
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`
    )
    .all(session.userId, limit, offset) as ExamRow[];

  const totalRow = db
    .prepare('SELECT COUNT(*) AS count FROM exams WHERE user_id = ?')
    .get(session.userId) as { count: number };

  const data = exams.map((e) => ({
    id: e.id,
    started_at: e.started_at,
    finished_at: e.finished_at,
    duration: e.duration,
    score: e.correct_count,
    total: e.total_count,
  }));

  return NextResponse.json({ data, total: totalRow.count });
}
