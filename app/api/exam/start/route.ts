import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';

const StartExamSchema = z.object({
  module: z.string().optional(),
  files: z.array(z.string()).optional(),
  questionTypes: z.array(z.enum(['single', 'multiple'])).optional(),
  orderMode: z.enum(['preserve', 'random']).optional().default('random'),
  useAllQuestions: z.boolean().optional().default(false),
  includeRepeated: z.boolean().optional().default(true),
  wrongOnly: z.boolean().optional().default(false),
  limit: z.number().int().positive().max(2000).optional().default(20),
  source_exam_id: z.number().int().positive().optional(),
  filter: z.enum(['all', 'wrong_only']).optional().default('all'),
});

interface QuestionRow {
  id: number;
  module: string;
  source_file?: string | null;
  question_order?: number | null;
  type: string;
  question_text: string;
}

interface AnswerRow {
  id: number;
  question_id: number;
  answer_text: string;
  is_correct: boolean;
}

const PAGE_SIZE = 1000;

async function fetchAllCandidateQuestions(options: {
  metadataColumnsAvailable: boolean;
  module?: string;
  files: string[];
  questionTypes: Array<'single' | 'multiple'>;
}): Promise<{ data: QuestionRow[] | null; error: string | null }> {
  const rows: QuestionRow[] = [];
  let from = 0;

  while (true) {
    let query = db
      .from('questions')
      .select(
        options.metadataColumnsAvailable
          ? 'id, module, source_file, question_order, type, question_text'
          : 'id, module, type, question_text'
      )
      .is('deleted_at', null)
      .order('question_order')
      .order('id')
      .range(from, from + PAGE_SIZE - 1);

    if (options.module) {
      query = query.eq('module', options.module);
    }

    if (options.files.length > 0 && options.metadataColumnsAvailable) {
      query = query.in('source_file', options.files);
    }

    if (options.files.length > 0 && !options.metadataColumnsAvailable) {
      query = query.in('module', options.files);
    }

    if (options.questionTypes.length > 0) {
      query = query.in('type', options.questionTypes);
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

async function fetchQuestionsWithAnswers(questionIds: number[]): Promise<{
  question: QuestionRow;
  answers: AnswerRow[];
}[]> {
  if (questionIds.length === 0) return [];

  const primaryQuestions = await db
    .from('questions')
    .select('id, module, source_file, question_order, type, question_text')
    .in('id', questionIds)
    .is('deleted_at', null);

  const fallbackQuestions =
    primaryQuestions.error || !primaryQuestions.data
      ? await db
          .from('questions')
          .select('id, module, type, question_text')
          .in('id', questionIds)
          .is('deleted_at', null)
      : null;

  const questions = primaryQuestions.data ?? fallbackQuestions?.data;
  const questionsError = primaryQuestions.error ?? fallbackQuestions?.error;

  if (questionsError || !questions) return [];

  const { data: answers, error: answersError } = await db
    .from('answers')
    .select('id, question_id, answer_text, is_correct')
    .in('question_id', questionIds)
    .is('deleted_at', null);

  if (answersError || !answers) return [];

  const answersByQuestion = new Map<number, AnswerRow[]>();
  for (const a of answers) {
    const list = answersByQuestion.get(a.question_id) ?? [];
    list.push(a);
    answersByQuestion.set(a.question_id, list);
  }

  const questionsById = new Map<number, QuestionRow>();
  for (const q of questions) questionsById.set(q.id, q);

  return questionIds
    .map((id) => questionsById.get(id))
    .filter((q): q is QuestionRow => Boolean(q))
    .map((q) => ({
      question: {
        ...q,
        source_file: q.source_file ?? q.module,
        question_order: q.question_order ?? null,
      },
      answers: answersByQuestion.get(q.id) ?? [],
    }));
}

async function hasQuestionMetadataColumns(): Promise<boolean> {
  const probe = await db.from('questions').select('source_file, question_order').limit(1);
  return !probe.error;
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

  const parsed = StartExamSchema.safeParse(body);
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
    orderMode,
    useAllQuestions,
    includeRepeated,
    wrongOnly,
    limit,
    source_exam_id,
    filter,
  } = parsed.data;

  const metadataColumnsAvailable = await hasQuestionMetadataColumns();

  let questionData: { question: QuestionRow; answers: AnswerRow[] }[] = [];

  if (source_exam_id !== undefined) {
    const { data: examOwner, error: ownerError } = await db
      .from('exams')
      .select('id')
      .eq('id', source_exam_id)
      .eq('user_id', session.userId)
      .maybeSingle();

    if (ownerError) {
      return NextResponse.json(
        { error: 'Failed to verify source exam', code: 'SOURCE_EXAM_LOOKUP_FAILED' },
        { status: 500 }
      );
    }

    if (!examOwner) {
      return NextResponse.json(
        { error: 'Exam not found', code: 'EXAM_NOT_FOUND' },
        { status: 404 }
      );
    }

    let eqQuery = db
      .from('exam_questions')
      .select('question_id, question_snapshot, is_correct')
      .eq('exam_id', source_exam_id);

    if (filter === 'wrong_only') {
      eqQuery = eqQuery.eq('is_correct', false);
    }

    const { data: examQs, error: examQsError } = await eqQuery;
    if (examQsError || !examQs) {
      return NextResponse.json(
        { error: 'Failed to fetch source questions', code: 'SOURCE_QUESTIONS_FETCH_FAILED' },
        { status: 500 }
      );
    }

    const questionIds = examQs.map((eq) => eq.question_id);
    questionData = await fetchQuestionsWithAnswers(questionIds);
  } else {
    let questions: QuestionRow[] = [];

    const normalizedFilter = filter === 'wrong_only' || wrongOnly ? 'wrong_only' : 'all';

    const { answeredIds, wrongIds } = await fetchUserAnswerHistory(session.userId);

    const { data: fallbackQuestions, error: fallbackError } = await fetchAllCandidateQuestions({
      metadataColumnsAvailable,
      module,
      files,
      questionTypes,
    });
    if (fallbackError || !fallbackQuestions) {
      return NextResponse.json(
        { error: 'Failed to fetch questions', code: 'QUESTIONS_FETCH_FAILED' },
        { status: 500 }
      );
    }

    const fallbackRows = fallbackQuestions as unknown as QuestionRow[];

    let filtered = fallbackRows.map((q) => ({
      id: q.id,
      module: q.module,
      source_file: q.source_file ?? q.module,
      question_order: q.question_order ?? null,
      type: q.type,
      question_text: q.question_text,
    }));

    if (normalizedFilter === 'wrong_only') {
      filtered = filtered.filter((q) => wrongIds.has(q.id));
    } else if (!includeRepeated) {
      filtered = filtered.filter((q) => !answeredIds.has(q.id));
    }

    const selectedCount = useAllQuestions ? filtered.length : Math.min(limit, filtered.length);
    const pool = [...filtered];
    if (selectedCount < pool.length) {
      pool.sort(() => Math.random() - 0.5);
      pool.length = selectedCount;
    }

    if (orderMode === 'preserve') {
      pool.sort((a, b) => {
        const fileA = a.source_file ?? '';
        const fileB = b.source_file ?? '';
        if (fileA !== fileB) return fileA.localeCompare(fileB);
        const orderA = typeof a.question_order === 'number' ? a.question_order : Number.MAX_SAFE_INTEGER;
        const orderB = typeof b.question_order === 'number' ? b.question_order : Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return a.id - b.id;
      });
    } else {
      pool.sort(() => Math.random() - 0.5);
    }

    questions = pool;

    const questionIds = questions.map((q) => q.id);
    questionData = await fetchQuestionsWithAnswers(questionIds);
  }

  if (questionData.length === 0) {
    return NextResponse.json(
      { error: 'No questions found', code: 'NO_QUESTIONS' },
      { status: 404 }
    );
  }

  const { data: examRow, error: examInsertError } = await db
    .from('exams')
    .insert({ user_id: session.userId, started_at: new Date().toISOString() })
    .select('id')
    .single();

  if (examInsertError || !examRow) {
    return NextResponse.json(
      { error: 'Failed to create exam', code: 'EXAM_CREATE_FAILED' },
      { status: 500 }
    );
  }

  const examId = examRow.id;

  const examQuestions: { id: number; question_snapshot: object }[] = [];

  for (const { question, answers } of questionData) {
    const snapshot = {
      id: question.id,
      module: question.module,
      source_file: question.source_file ?? question.module,
      question_order: question.question_order ?? null,
      type: question.type,
      question_text: question.question_text,
      answers: answers.map((a) => ({
        id: a.id,
        answer_text: a.answer_text,
        is_correct: Boolean(a.is_correct),
      })),
    };

    const { data: examQuestionRow, error: examQuestionInsertError } = await db
      .from('exam_questions')
      .insert({
        exam_id: examId,
        question_id: question.id,
        question_snapshot: JSON.stringify(snapshot),
      })
      .select('id')
      .single();

    if (examQuestionInsertError || !examQuestionRow) {
      return NextResponse.json(
        { error: 'Failed to save exam questions', code: 'EXAM_QUESTIONS_CREATE_FAILED' },
        { status: 500 }
      );
    }

    examQuestions.push({
      id: examQuestionRow.id,
      question_snapshot: snapshot,
    });
  }

  return NextResponse.json({ examId, questions: examQuestions });
}
