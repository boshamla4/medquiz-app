import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';

const FeedbackSchema = z.object({
  comment: z.string().min(5).max(2000),
  whatsapp: z
    .string()
    .trim()
    .max(32)
    .regex(/^[+0-9\s()-]*$/)
    .optional()
    .or(z.literal('')),
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

  const parsed = FeedbackSchema.safeParse(body);
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

  const comment = parsed.data.comment.trim();
  const whatsapp = parsed.data.whatsapp?.trim() || null;

  const { error } = await db.from('feedback_comments').insert({
    user_id: session.userId,
    comment,
    whatsapp,
  });

  if (error) {
    return NextResponse.json(
      { error: 'Failed to save feedback', code: 'FEEDBACK_SAVE_FAILED' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
