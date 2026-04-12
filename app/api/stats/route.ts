import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';

function getFileParts(sourceFile: string): { folder: string; fileName: string } {
  const normalized = sourceFile.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const fileName = parts[parts.length - 1] ?? sourceFile;
  const folder = parts.length > 1 ? parts[parts.length - 2] : 'Ungrouped';
  return { folder, fileName };
}

const PAGE_SIZE = 1000;

async function fetchTotalQuestionsPerFile(): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from('questions')
      .select('source_file, module')
      .is('deleted_at', null)
      .range(from, from + PAGE_SIZE - 1);
    if (error || !data) break;
    for (const q of data as { source_file?: string | null; module?: string | null }[]) {
      const key = q.source_file ?? q.module;
      if (!key) continue;
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return totals;
}

interface EQRow {
  exam_id: number;
  question_id: number | null;
  question_snapshot: string | Record<string, unknown>;
  user_answer: string | number[] | null;
  score_weight: number | null;
  is_correct: boolean | null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;

  const mode = request.nextUrl.searchParams.get('mode') === 'all' ? 'all' : 'last';

  // 1. Get finished exams ordered most recent first
  const { data: exams, error: examsError } = await db
    .from('exams')
    .select('id, started_at')
    .eq('user_id', session.userId)
    .not('finished_at', 'is', null)
    .order('started_at', { ascending: false });

  if (examsError || !exams) {
    return NextResponse.json({ error: 'Failed to load exams', code: 'EXAMS_FETCH_FAILED' }, { status: 500 });
  }

  if (exams.length === 0) {
    return NextResponse.json({ mode, stats: [], exam_count: 0 });
  }

  const examIds = mode === 'last' ? [(exams as { id: number }[])[0].id] : (exams as { id: number }[]).map((e) => e.id);

  // 2. Fetch exam_questions in chunks
  const allRows: EQRow[] = [];
  const chunkSize = 50;

  for (let i = 0; i < examIds.length; i += chunkSize) {
    const chunk = examIds.slice(i, i + chunkSize);
    let from = 0;
    while (true) {
      const { data, error } = await db
        .from('exam_questions')
        .select('exam_id, question_id, question_snapshot, user_answer, score_weight, is_correct')
        .in('exam_id', chunk)
        .range(from, from + PAGE_SIZE - 1);
      if (error || !data) break;
      allRows.push(...(data as EQRow[]));
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }

  // 3. For mode=all, deduplicate by question_id keeping the latest attempt
  // exams is already sorted desc, so examOrder[0] = most recent
  const examOrder = new Map<number, number>((exams as { id: number }[]).map((e, i) => [e.id, i]));

  let rowsToAggregate: EQRow[];
  if (mode === 'all') {
    const latestByQuestion = new Map<number, EQRow>();
    const sorted = allRows.slice().sort((a, b) => {
      const orderA = examOrder.get(a.exam_id) ?? Infinity;
      const orderB = examOrder.get(b.exam_id) ?? Infinity;
      return orderA - orderB; // lower index = more recent
    });
    for (const row of sorted) {
      if (row.question_id !== null && !latestByQuestion.has(row.question_id)) {
        latestByQuestion.set(row.question_id, row);
      }
    }
    rowsToAggregate = [...latestByQuestion.values()];
  } else {
    rowsToAggregate = allRows;
  }

  // 4. Get total active questions per source_file from questions table
  const totalsPerFile = await fetchTotalQuestionsPerFile();

  // 5. Aggregate per source_file from stored results only — no recomputation
  const fileMap = new Map<string, { answered_count: number; correct_count: number; partial_sum: number }>();

  for (const row of rowsToAggregate) {
    const snap =
      typeof row.question_snapshot === 'string'
        ? (JSON.parse(row.question_snapshot) as { source_file?: string; module?: string })
        : (row.question_snapshot as { source_file?: string; module?: string });

    const sourceFile = snap.source_file ?? snap.module ?? 'Unknown';

    const ua =
      typeof row.user_answer === 'string'
        ? (JSON.parse(row.user_answer) as number[])
        : (row.user_answer ?? []);
    const answered = Array.isArray(ua) && ua.length > 0;

    // Use persisted score_weight; fall back to is_correct boolean for legacy rows
    const score =
      row.score_weight !== null && row.score_weight !== undefined
        ? row.score_weight
        : row.is_correct
        ? 1
        : 0;

    const entry = fileMap.get(sourceFile) ?? { answered_count: 0, correct_count: 0, partial_sum: 0 };
    if (answered) {
      entry.answered_count += 1;
      entry.partial_sum += score;
      if (score === 1) entry.correct_count += 1;
    }
    fileMap.set(sourceFile, entry);
  }

  // 6. Build output — include all files present in the questions table
  const allFiles = new Set([...totalsPerFile.keys(), ...fileMap.keys()]);

  const stats = [...allFiles].map((sourceFile) => {
    const agg = fileMap.get(sourceFile) ?? { answered_count: 0, correct_count: 0, partial_sum: 0 };
    const total = totalsPerFile.get(sourceFile) ?? 0;
    const { folder, fileName } = getFileParts(sourceFile);

    const score = total > 0 ? agg.partial_sum / total : 0;
    const consistency = agg.answered_count > 0 ? agg.correct_count / agg.answered_count : 0;
    const coverage = total > 0 ? agg.answered_count / total : 0;

    return {
      source_file: sourceFile,
      folder,
      file_name: fileName,
      answered_count: agg.answered_count,
      correct_count: agg.correct_count,
      partial_sum: Math.round(agg.partial_sum * 100) / 100,
      total_questions: total,
      score: Math.round(score * 10000) / 10000,
      consistency: Math.round(consistency * 10000) / 10000,
      coverage: Math.round(coverage * 10000) / 10000,
      low_confidence: agg.answered_count > 0 && agg.answered_count < 3,
    };
  });

  // Sort by folder then file_name
  stats.sort((a, b) => {
    if (a.folder !== b.folder) return a.folder.localeCompare(b.folder);
    return a.file_name.localeCompare(b.file_name);
  });

  return NextResponse.json({ mode, stats, exam_count: examIds.length });
}
