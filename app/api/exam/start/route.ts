import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';

const StartExamSchema = z.object({
  module: z.string().optional(),
  files: z.array(z.string()).optional(),
  topics: z.array(z.string()).optional(),
  questionTypes: z.array(z.enum(['single', 'multiple'])).optional(),
  includeRepeated: z.boolean().optional().default(true),
  wrongOnly: z.boolean().optional().default(false),
  limit: z.number().int().positive().max(200).optional().default(20),
  source_exam_id: z.number().int().positive().optional(),
  filter: z.enum(['all', 'wrong_only']).optional().default('all'),
});

interface QuestionRow {
  id: number;
  module: string;
  topic?: string | null;
  source_file?: string | null;
  type: string;
  question_text: string;
}

interface AnswerRow {
  id: number;
  question_id: number;
  answer_text: string;
  is_correct: boolean;
}

async function fetchQuestionsWithAnswers(questionIds: number[]): Promise<{
  question: QuestionRow;
  answers: AnswerRow[];
}[]> {
  if (questionIds.length === 0) return [];

  const primaryQuestions = await db
    .from('questions')
    .select('id, module, topic, source_file, type, question_text')
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
        topic: q.topic ?? q.module,
        source_file: q.source_file ?? q.module,
      },
      answers: answersByQuestion.get(q.id) ?? [],
    }));
}

async function hasQuestionMetadataColumns(): Promise<boolean> {
  const probe = await db.from('questions').select('source_file, topic').limit(1);
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
    topics = [],
    questionTypes = [],
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

    const rpcResult = await db.rpc('get_random_questions', {
      p_module: module ?? null,
      p_limit: limit,
    });

    if (rpcResult.error || !rpcResult.data) {
      let fallbackQuery = db
        .from('questions')
        .select(
          metadataColumnsAvailable
            ? 'id, module, topic, source_file, type, question_text'
            : 'id, module, type, question_text'
        )
        .is('deleted_at', null)
        .order('id')
        .limit(limit * 20);

      if (module) {
        fallbackQuery = fallbackQuery.eq('module', module);
      }

      if (files.length > 0 && metadataColumnsAvailable) {
        fallbackQuery = fallbackQuery.in('source_file', files);
      }

      if (topics.length > 0 && metadataColumnsAvailable) {
        fallbackQuery = fallbackQuery.in('topic', topics);
      }

      if (!metadataColumnsAvailable && (files.length > 0 || topics.length > 0)) {
        const union = Array.from(new Set([...files, ...topics]));
        if (union.length > 0) {
          fallbackQuery = fallbackQuery.in('module', union);
        }
      }

      if (questionTypes.length > 0) {
        fallbackQuery = fallbackQuery.in('type', questionTypes);
      }

      const { data: fallbackQuestions, error: fallbackError } = await fallbackQuery;
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
        topic: q.topic ?? q.module,
        source_file: q.source_file ?? q.module,
        type: q.type,
        question_text: q.question_text,
      }));

      if (normalizedFilter === 'wrong_only') {
        filtered = filtered.filter((q) => wrongIds.has(q.id));
      } else if (!includeRepeated) {
        filtered = filtered.filter((q) => !answeredIds.has(q.id));
      }

      questions = [...filtered].sort(() => Math.random() - 0.5).slice(0, limit);
    } else {
      questions = rpcResult.data.map((q: QuestionRow) => ({
        id: q.id,
        module: q.module,
        topic: q.topic ?? q.module,
        source_file: q.source_file ?? q.module,
        type: q.type,
        question_text: q.question_text,
      }));

      if (files.length > 0) {
        questions = questions.filter(
          (q) => typeof q.source_file === 'string' && files.includes(q.source_file)
        );
      }

      if (topics.length > 0) {
        questions = questions.filter(
          (q) => typeof q.topic === 'string' && topics.includes(q.topic)
        );
      }

      if (questionTypes.length > 0) {
        questions = questions.filter((q) => questionTypes.includes(q.type as 'single' | 'multiple'));
      }

      if (normalizedFilter === 'wrong_only') {
        questions = questions.filter((q) => wrongIds.has(q.id));
      } else if (!includeRepeated) {
        questions = questions.filter((q) => !answeredIds.has(q.id));
      }

      questions = questions.slice(0, limit);
    }

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
      topic: question.topic ?? question.module,
      source_file: question.source_file ?? question.module,
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
