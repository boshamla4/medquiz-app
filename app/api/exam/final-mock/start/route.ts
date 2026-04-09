import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';
import { formatServerTiming, recordApiMetric } from '@/lib/performanceMetrics';

const FinalMockSchema = z.object({
  totalQuestions: z.number().int().positive().max(1000).optional().default(200),
  program: z.string().optional().default('Medicine'),
});

interface DistributionRow {
  subject: string;
  source_pattern: string;
  match_type: 'exact' | 'prefix';
  weight_percent: number;
  display_order: number;
}

const DEFAULT_PROGRAM = 'Medicine';
const DEFAULT_TOTAL_QUESTIONS = 200;

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

function pickRandom<T>(items: T[], count: number): T[] {
  if (count <= 0) return [];
  if (count >= items.length) return [...items];
  const pool = [...items];
  pool.sort(() => Math.random() - 0.5);
  return pool.slice(0, count);
}

function allocateByWeights(total: number, rows: DistributionRow[]): number[] {
  if (rows.length === 0) return [];

  const raw = rows.map((row) => (total * row.weight_percent) / 100);
  const base = raw.map((value) => Math.floor(value));
  let assigned = base.reduce((sum, value) => sum + value, 0);

  const remainders = raw
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);

  let cursor = 0;
  while (assigned < total && cursor < remainders.length) {
    base[remainders[cursor].index] += 1;
    assigned += 1;
    cursor += 1;
  }

  return base;
}

async function fetchDistribution(program: string): Promise<DistributionRow[]> {
  const { data: distribution, error } = await db
    .from('final_mock_distribution')
    .select('subject, source_pattern, match_type, weight_percent, display_order')
    .eq('program', program)
    .eq('active', true)
    .order('display_order');

  if (error || !distribution || distribution.length === 0) {
    return [];
  }

  return distribution as DistributionRow[];
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;

  const program = request.nextUrl.searchParams.get('program') ?? DEFAULT_PROGRAM;
  const totalQuestions = Number(request.nextUrl.searchParams.get('totalQuestions') ?? DEFAULT_TOTAL_QUESTIONS);
  const safeTotal = Number.isFinite(totalQuestions) && totalQuestions > 0
    ? Math.min(Math.floor(totalQuestions), 1000)
    : DEFAULT_TOTAL_QUESTIONS;

  const rows = await fetchDistribution(program);
  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'Final mock distribution not configured', code: 'FINAL_MOCK_DISTRIBUTION_MISSING' },
      { status: 500 }
    );
  }

  const targets = allocateByWeights(safeTotal, rows);
  const totalWeightPercent = rows.reduce((sum, row) => sum + Number(row.weight_percent), 0);

  return NextResponse.json({
    program,
    totalQuestions: safeTotal,
    totalWeightPercent,
    sections: rows.map((row, index) => ({
      subject: row.subject,
      weightPercent: Number(row.weight_percent),
      targetQuestions: targets[index] ?? 0,
    })),
  });
}

async function fetchAllQuestions(): Promise<QuestionRow[]> {
  const rows: QuestionRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await db
      .from('questions')
      .select('id, module, source_file, question_order, type, question_text')
      .is('deleted_at', null)
      .order('question_order')
      .order('id')
      .range(from, from + PAGE_SIZE - 1);

    if (error || !data) {
      return [];
    }

    rows.push(...(data as unknown as QuestionRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function fetchQuestionsWithAnswers(questionIds: number[]): Promise<{
  question: QuestionRow;
  answers: AnswerRow[];
}[]> {
  if (questionIds.length === 0) return [];

  const { data: questions, error: questionsError } = await db
    .from('questions')
    .select('id, module, source_file, question_order, type, question_text')
    .in('id', questionIds)
    .is('deleted_at', null);

  if (questionsError || !questions) return [];

  const allAnswers: AnswerRow[] = [];
  const chunkSize = 150;

  for (let index = 0; index < questionIds.length; index += chunkSize) {
    const chunk = questionIds.slice(index, index + chunkSize);
    const { data: answers, error: answersError } = await db
      .from('answers')
      .select('id, question_id, answer_text, is_correct')
      .in('question_id', chunk)
      .is('deleted_at', null);

    if (answersError || !answers) return [];
    allAnswers.push(...(answers as AnswerRow[]));
  }

  const answersByQuestion = new Map<number, AnswerRow[]>();
  for (const answer of allAnswers) {
    const list = answersByQuestion.get(answer.question_id) ?? [];
    list.push(answer);
    answersByQuestion.set(answer.question_id, list);
  }

  const byId = new Map<number, QuestionRow>();
  for (const question of questions as QuestionRow[]) {
    byId.set(question.id, question);
  }

  return questionIds
    .map((id) => byId.get(id))
    .filter((question): question is QuestionRow => Boolean(question))
    .map((question) => ({
      question: {
        ...question,
        source_file: question.source_file ?? question.module,
        question_order: question.question_order ?? null,
      },
      answers: answersByQuestion.get(question.id) ?? [],
    }));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;

  const requestStart = Date.now();
  const stages: Record<string, number> = {};

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'INVALID_BODY' },
      { status: 400 }
    );
  }

  const parsed = FinalMockSchema.safeParse(body);
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

  const totalQuestions = parsed.data.totalQuestions;
  const program = parsed.data.program;

  const distributionStart = Date.now();
  const rows = await fetchDistribution(program);
  stages.load_distribution = Date.now() - distributionStart;
  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'Final mock distribution not configured', code: 'FINAL_MOCK_DISTRIBUTION_MISSING' },
      { status: 500 }
    );
  }

  const loadQuestionsStart = Date.now();
  const allQuestions = await fetchAllQuestions();
  stages.load_questions = Date.now() - loadQuestionsStart;
  if (allQuestions.length === 0) {
    return NextResponse.json(
      { error: 'No questions available', code: 'NO_QUESTIONS' },
      { status: 404 }
    );
  }

  const targets = allocateByWeights(totalQuestions, rows);

  const selected = new Map<number, QuestionRow>();

  const selectQuestionsStart = Date.now();
  for (let i = 0; i < rows.length; i++) {
    const rule = rows[i];
    const target = targets[i] ?? 0;
    if (target <= 0) continue;

    const matching = allQuestions.filter((question) => {
      const source = question.source_file ?? question.module;
      if (rule.match_type === 'exact') return source === rule.source_pattern;
      return source.startsWith(rule.source_pattern);
    });

    const available = matching.filter((question) => !selected.has(question.id));
    const picked = pickRandom(available, Math.min(target, available.length));
    for (const item of picked) {
      selected.set(item.id, item);
    }
  }

  if (selected.size < totalQuestions) {
    const remaining = allQuestions.filter((question) => !selected.has(question.id));
    const topUp = pickRandom(remaining, Math.min(totalQuestions - selected.size, remaining.length));
    for (const item of topUp) {
      selected.set(item.id, item);
    }
  }

  const selectedQuestions = [...selected.values()];
  selectedQuestions.sort(() => Math.random() - 0.5);
  stages.select_questions = Date.now() - selectQuestionsStart;

  const answersFetchStart = Date.now();
  const questionData = await fetchQuestionsWithAnswers(selectedQuestions.map((q) => q.id));
  stages.fetch_answers = Date.now() - answersFetchStart;
  if (questionData.length === 0) {
    return NextResponse.json(
      { error: 'Failed to fetch questions for final mock', code: 'FINAL_MOCK_FETCH_FAILED' },
      { status: 500 }
    );
  }

  const createExamStart = Date.now();
  const { data: examRow, error: examInsertError } = await db
    .from('exams')
    .insert({ user_id: session.userId, started_at: new Date().toISOString() })
    .select('id')
    .single();
  stages.create_exam = Date.now() - createExamStart;

  if (examInsertError || !examRow) {
    return NextResponse.json(
      { error: 'Failed to create exam', code: 'EXAM_CREATE_FAILED' },
      { status: 500 }
    );
  }

  const examId = examRow.id;
  const examQuestionRows = questionData.map(({ question, answers }) => ({
    question,
    snapshot: {
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
    },
  }));

  const insertedExamQuestionIds = new Map<number, number>();
  const batchSize = 250;
  const insertQuestionsStart = Date.now();

  for (let index = 0; index < examQuestionRows.length; index += batchSize) {
    const batch = examQuestionRows.slice(index, index + batchSize).map(({ question, snapshot }) => ({
      exam_id: examId,
      question_id: question.id,
      question_snapshot: JSON.stringify(snapshot),
    }));

    const { data: insertedRows, error: insertError } = await db
      .from('exam_questions')
      .insert(batch)
      .select('id, question_id');

    if (insertError || !insertedRows) {
      return NextResponse.json(
        { error: 'Failed to save exam questions', code: 'EXAM_QUESTIONS_CREATE_FAILED' },
        { status: 500 }
      );
    }

    for (const row of insertedRows) {
      insertedExamQuestionIds.set(row.question_id, row.id);
    }
  }
  stages.insert_exam_questions = Date.now() - insertQuestionsStart;

  const examQuestions = examQuestionRows
    .map(({ question, snapshot }) => ({
      id: insertedExamQuestionIds.get(question.id) ?? 0,
      question_snapshot: snapshot,
    }))
    .filter((entry) => entry.id > 0);

  const totalMs = Date.now() - requestStart;
  const response = NextResponse.json({ examId, total: examQuestions.length, questions: examQuestions });
  response.headers.set('Server-Timing', formatServerTiming(stages, totalMs));

  await recordApiMetric({
    route: '/api/exam/final-mock/start',
    statusCode: 200,
    userId: session.userId,
    totalMs,
    itemCount: examQuestions.length,
    stages,
    meta: {
      program,
      requestedTotalQuestions: totalQuestions,
    },
  });

  return response;
}
