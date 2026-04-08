import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';

interface QuestionRow {
  id: number;
  module: string;
  source_file?: string | null;
  question_order?: number | null;
  type: string;
  question_text: string;
}

interface MetaRow {
  module: string;
  type: string;
  source_file?: string | null;
}

const PAGE_SIZE = 1000;

async function fetchAllMetadataRows(): Promise<{
  data: MetaRow[] | null;
  error: string | null;
}> {
  const rows: MetaRow[] = [];
  let from = 0;

  while (true) {
    const primary = await db
      .from('questions')
      .select('module, type, source_file')
      .is('deleted_at', null)
      .order('module')
      .range(from, from + PAGE_SIZE - 1);

    const fallback =
      primary.error || !primary.data
        ? await db
            .from('questions')
            .select('module, type')
            .is('deleted_at', null)
            .order('module')
            .range(from, from + PAGE_SIZE - 1)
        : null;

    const data = (primary.data ?? fallback?.data) as MetaRow[] | undefined;
    const error = primary.error ?? fallback?.error;

    if (error || !data) {
      return { data: null, error: error?.message ?? 'QUERY_FAILED' };
    }

    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return { data: rows, error: null };
}

function getFileParts(sourceFile: string): { folder: string; fileName: string } {
  const normalized = sourceFile.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const fileName = parts[parts.length - 1] ?? sourceFile;
  const folder = parts.length > 1 ? parts[parts.length - 2] : 'Ungrouped';
  return { folder, fileName };
}

interface AnswerRow {
  id: number;
  question_id: number;
  answer_text: string;
  is_correct: boolean;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;

  const { searchParams } = request.nextUrl;
  const modulesOnly = searchParams.get('modules') === '1';
  const metaOnly = searchParams.get('meta') === '1';

  if (modulesOnly || metaOnly) {
    const { data, error } = await fetchAllMetadataRows();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Failed to fetch metadata', code: 'METADATA_FETCH_FAILED' },
        { status: 500 }
      );
    }

    const modules = Array.from(
      new Set(
        data
          .map((row) => row.module)
          .filter((name): name is string => typeof name === 'string' && name.length > 0)
      )
    );

    if (modulesOnly) {
      return NextResponse.json({ modules });
    }

    const files = Array.from(
      new Set(
        data
          .map((row) =>
            typeof (row as { source_file?: string }).source_file === 'string' &&
            (row as { source_file?: string }).source_file
              ? (row as { source_file?: string }).source_file
              : row.module
          )
          .filter((name): name is string => typeof name === 'string' && name.length > 0)
      )
    );

    const types = Array.from(
      new Set(
        data
          .map((row) => row.type)
          .filter((name): name is string => typeof name === 'string' && name.length > 0)
      )
    );

    const byFile = new Map<
      string,
      { source_file: string; folder: string; file_name: string; total_questions: number }
    >();

    for (const row of data) {
      const key =
        typeof row.source_file === 'string' && row.source_file.length > 0
          ? row.source_file
          : row.module;
      const existing = byFile.get(key);
      if (existing) {
        existing.total_questions += 1;
        continue;
      }
      const { folder, fileName } = getFileParts(key);
      byFile.set(key, {
        source_file: key,
        folder,
        file_name: fileName,
        total_questions: 1,
      });
    }

    const fileStats = [...byFile.values()].sort((a, b) => {
      if (a.folder !== b.folder) return a.folder.localeCompare(b.folder);
      return a.file_name.localeCompare(b.file_name);
    });

    const groupedMap = new Map<
      string,
      { folder: string; files: typeof fileStats; total_questions: number }
    >();
    for (const stat of fileStats) {
      const group = groupedMap.get(stat.folder) ?? {
        folder: stat.folder,
        files: [],
        total_questions: 0,
      };
      group.files.push(stat);
      group.total_questions += stat.total_questions;
      groupedMap.set(stat.folder, group);
    }
    const fileGroups = [...groupedMap.values()].sort((a, b) => a.folder.localeCompare(b.folder));

    return NextResponse.json({ modules, files, types, fileStats, fileGroups });
  }

  const moduleFilter = searchParams.get('module');
  const random = searchParams.get('random') === 'true';
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10) || 20, 100);

  let questions: QuestionRow[] = [];

  if (random) {
    const rpcResult = await db.rpc('get_random_questions', {
      p_module: moduleFilter ?? null,
      p_limit: limit,
    });

    if (!rpcResult.error && rpcResult.data) {
      questions = rpcResult.data.map((q: QuestionRow) => ({
        id: q.id,
        module: q.module,
        source_file: q.source_file ?? q.module,
        question_order: q.question_order ?? null,
        type: q.type,
        question_text: q.question_text,
      }));
    } else {
      let fallbackQuery = db
        .from('questions')
        .select('id, module, source_file, question_order, type, question_text')
        .is('deleted_at', null)
        .order('question_order')
        .order('id')
        .limit(limit * 3);

      if (moduleFilter) {
        fallbackQuery = fallbackQuery.eq('module', moduleFilter);
      }

      const { data: fallbackQuestions, error: fallbackError } = await fallbackQuery;

      if (fallbackError || !fallbackQuestions) {
        return NextResponse.json(
          { error: 'Failed to fetch questions', code: 'QUESTIONS_FETCH_FAILED' },
          { status: 500 }
        );
      }

      questions = [...fallbackQuestions]
        .sort(() => Math.random() - 0.5)
        .slice(0, limit);
    }
  } else {
    let query = db
      .from('questions')
      .select('id, module, source_file, question_order, type, question_text')
      .is('deleted_at', null)
      .order('question_order')
      .order('id')
      .limit(limit);

    if (moduleFilter) {
      query = query.eq('module', moduleFilter);
    }

    const { data, error } = await query;
    if (error || !data) {
      return NextResponse.json(
        { error: 'Failed to fetch questions', code: 'QUESTIONS_FETCH_FAILED' },
        { status: 500 }
      );
    }

    questions = data;
  }

  if (questions.length === 0) {
    return NextResponse.json({ questions: [] });
  }

  const questionIds = questions.map((q) => q.id);

  const { data: answers, error: answersError } = await db
    .from('answers')
    .select('id, question_id, answer_text, is_correct')
    .in('question_id', questionIds)
    .is('deleted_at', null);

  if (answersError || !answers) {
    return NextResponse.json(
      { error: 'Failed to fetch answers', code: 'ANSWERS_FETCH_FAILED' },
      { status: 500 }
    );
  }

  const answersByQuestion = new Map<number, AnswerRow[]>();
  for (const answer of answers) {
    const list = answersByQuestion.get(answer.question_id) ?? [];
    list.push(answer);
    answersByQuestion.set(answer.question_id, list);
  }

  const result = questions.map((q) => ({
    id: q.id,
    module: q.module,
    source_file: q.source_file ?? q.module,
    question_order: q.question_order ?? null,
    type: q.type,
    question_text: q.question_text,
    answers: (answersByQuestion.get(q.id) ?? []).map((a) => ({
      id: a.id,
      answer_text: a.answer_text,
      is_correct: Boolean(a.is_correct),
    })),
  }));

  return NextResponse.json({ questions: result });
}
