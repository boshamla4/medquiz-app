import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';

const PreviewSchema = z.object({
  module: z.string().optional(),
  files: z.array(z.string()).optional(),
  questionTypes: z.array(z.enum(['single', 'multiple'])).optional(),
  includeRepeated: z.boolean().optional().default(true),
  wrongOnly: z.boolean().optional().default(false),
  useAllQuestions: z.boolean().optional().default(false),
  limit: z.number().int().positive().max(2000).optional().default(20),
});

interface QuestionRow {
  id: number;
  module: string;
  source_file?: string | null;
  type: 'single' | 'multiple';
}

const PAGE_SIZE = 1000;

async function fetchAllQuestionRows(filters: {
  module?: string;
  files: string[];
  questionTypes: Array<'single' | 'multiple'>;
}): Promise<{ data: QuestionRow[] | null; error: string | null }> {
  const rows: QuestionRow[] = [];
  let from = 0;

  while (true) {
    let query = db
      .from('questions')
      .select('id, module, source_file, type')
      .is('deleted_at', null)
      .order('question_order')
      .order('id')
      .range(from, from + PAGE_SIZE - 1);

    if (filters.module) {
      query = query.eq('module', filters.module);
    }
    if (filters.files.length > 0) {
      query = query.in('source_file', filters.files);
    }
    if (filters.questionTypes.length > 0) {
      query = query.in('type', filters.questionTypes);
    }

    const { data, error } = await query;
    if (error || !data) {
      return { data: null, error: error?.message ?? 'QUERY_FAILED' };
    }

    rows.push(...(data as unknown as QuestionRow[]));

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

async function fetchUserAnswerHistory(userId: number): Promise<{
  answeredIds: Set<number>;
  wrongIds: Set<number>;
}> {
  const { data: userExams, error: userExamsError } = await db
    .from('exams')
    .select('id')
    .eq('user_id', userId)
    .not('finished_at', 'is', null);

  if (userExamsError || !userExams || userExams.length === 0) {
    return { answeredIds: new Set<number>(), wrongIds: new Set<number>() };
  }

  const examIds = userExams.map((exam) => exam.id);
  const { data: answerRows, error: answersError } = await db
    .from('exam_questions')
    .select('question_id, is_correct')
    .in('exam_id', examIds)
    .not('question_id', 'is', null);

  if (answersError || !answerRows) {
    return { answeredIds: new Set<number>(), wrongIds: new Set<number>() };
  }

  const answeredIds = new Set<number>();
  const wrongIds = new Set<number>();

  for (const row of answerRows) {
    if (typeof row.question_id !== 'number') continue;
    answeredIds.add(row.question_id);
    if (row.is_correct === false) {
      wrongIds.add(row.question_id);
    }
  }

  return { answeredIds, wrongIds };
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

  const parsed = PreviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', code: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  }

  const {
    module,
    files = [],
    questionTypes = [],
    includeRepeated,
    wrongOnly,
    useAllQuestions,
    limit,
  } = parsed.data;

  const { data, error } = await fetchAllQuestionRows({
    module,
    files,
    questionTypes,
  });
  if (error || !data) {
    return NextResponse.json(
      { error: 'Failed to compute preview', code: 'PREVIEW_FETCH_FAILED' },
      { status: 500 }
    );
  }

  const allQuestions = data as unknown as QuestionRow[];
  const { answeredIds, wrongIds } = await fetchUserAnswerHistory(session.userId);

  const filteredQuestions = allQuestions.filter((q) => {
    if (wrongOnly) return wrongIds.has(q.id);
    if (!includeRepeated) return !answeredIds.has(q.id);
    return true;
  });

  const totalByFile = new Map<string, number>();
  for (const q of allQuestions) {
    const key = q.source_file ?? q.module;
    totalByFile.set(key, (totalByFile.get(key) ?? 0) + 1);
  }

  const availableByFile = new Map<string, number>();
  for (const q of filteredQuestions) {
    const key = q.source_file ?? q.module;
    availableByFile.set(key, (availableByFile.get(key) ?? 0) + 1);
  }

  const filesToReport = files.length > 0 ? files : [...totalByFile.keys()];

  const fileRows = filesToReport
    .map((sourceFile) => {
      const { folder, fileName } = getFileParts(sourceFile);
      return {
        source_file: sourceFile,
        folder,
        file_name: fileName,
        total_questions: totalByFile.get(sourceFile) ?? 0,
        available_questions: availableByFile.get(sourceFile) ?? 0,
      };
    })
    .sort((a, b) => {
      if (a.folder !== b.folder) return a.folder.localeCompare(b.folder);
      return a.file_name.localeCompare(b.file_name);
    });

  const grouped = new Map<string, { folder: string; total_questions: number; available_questions: number; files: typeof fileRows }>();
  for (const row of fileRows) {
    const group = grouped.get(row.folder) ?? {
      folder: row.folder,
      total_questions: 0,
      available_questions: 0,
      files: [],
    };
    group.total_questions += row.total_questions;
    group.available_questions += row.available_questions;
    group.files.push(row);
    grouped.set(row.folder, group);
  }

  const totalAvailable = filteredQuestions.length;
  const plannedQuestionCount = useAllQuestions ? totalAvailable : Math.min(limit, totalAvailable);

  return NextResponse.json({
    totalAvailable,
    plannedQuestionCount,
    totalMatchingBeforeHistory: allQuestions.length,
    fileRows,
    fileGroups: [...grouped.values()].sort((a, b) => a.folder.localeCompare(b.folder)),
  });
}
