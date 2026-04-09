import { NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'MedQuiz API',
      version: '1.2.7',
      description: 'API documentation for MedQuiz routes. Authenticated routes use session cookies.',
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local development' },
      { url: 'https://medquiz-app-eight.vercel.app', description: 'Production' },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'session_id',
        },
      },
      schemas: {
        LoginRequest: {
          type: 'object',
          required: ['token'],
          properties: {
            token: { type: 'string' },
          },
        },
        ActiveUsersResponse: {
          type: 'object',
          properties: {
            activeUsers: { type: 'integer', minimum: 0 },
            activeSessions: { type: 'integer', minimum: 0 },
            windowMinutes: { type: 'integer', minimum: 1 },
            asOf: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    paths: {
      '/api/auth/login': {
        post: {
          summary: 'Authenticate with token',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LoginRequest' },
              },
            },
          },
          responses: {
            '200': { description: 'Login succeeded, session cookies set' },
            '401': { description: 'Invalid token' },
            '429': { description: 'Rate limited' },
          },
        },
      },
      '/api/auth/logout': {
        post: {
          summary: 'Logout current user',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': { description: 'Logged out and cookies cleared' },
          },
        },
      },
      '/api/auth/validate': {
        get: {
          summary: 'Validate session cookie',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': { description: 'Session valid' },
            '401': { description: 'Session invalid or missing' },
          },
        },
      },
      '/api/exam/history': {
        get: {
          summary: 'Get user exam history',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['date', 'score'] } },
          ],
          responses: {
            '200': { description: 'History payload returned' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/exam/start': {
        post: {
          summary: 'Start a new exam',
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            },
          },
          responses: {
            '200': { description: 'Exam started' },
            '400': { description: 'Invalid payload' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/exam/preview': {
        post: {
          summary: 'Preview exam question availability',
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            },
          },
          responses: {
            '200': { description: 'Preview returned' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/exam/retry': {
        post: {
          summary: 'Start retry exam from prior exam',
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['examId', 'filter'],
                  properties: {
                    examId: { type: 'integer' },
                    filter: { type: 'string', enum: ['all', 'wrong_only'] },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Retry exam created' },
            '400': { description: 'Invalid request' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/feedback': {
        post: {
          summary: 'Submit user feedback',
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['comment'],
                  properties: {
                    comment: { type: 'string' },
                    whatsapp: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Feedback accepted' },
            '400': { description: 'Validation error' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/users/active': {
        get: {
          summary: 'Get active users and active sessions in recent window',
          description: 'Counts unique users based on active sessions with recent last_seen.',
          security: [{ cookieAuth: [] }],
          responses: {
            '200': {
              description: 'Active users snapshot',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ActiveUsersResponse' },
                },
              },
            },
            '401': { description: 'Unauthorized' },
          },
        },
      },
    },
  };

  return NextResponse.json(spec);
}