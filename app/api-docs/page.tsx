'use client';

import { useEffect } from 'react';
import Script from 'next/script';

declare global {
  interface Window {
    SwaggerUIBundle?: (options: Record<string, unknown>) => unknown;
  }
}

function loadSwaggerUi() {
  if (typeof window === 'undefined') return;
  if (!window.SwaggerUIBundle) return;

  window.SwaggerUIBundle({
    url: '/api/openapi',
    dom_id: '#swagger-ui',
    deepLinking: true,
    persistAuthorization: true,
    tryItOutEnabled: true,
    requestInterceptor: (request: RequestInit & { credentials?: RequestCredentials }) => {
      request.credentials = 'include';
      return request;
    },
  });
}

export default function ApiDocsPage() {
  useEffect(() => {
    loadSwaggerUi();
  }, []);

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6">
      <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
      <div className="mx-auto mb-4 max-w-6xl rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
        <p className="font-semibold text-gray-900">MedQuiz API Docs</p>
        <p className="mt-1">
          Use <strong>/api/auth/login</strong> first to set cookies, then test protected endpoints with Try it out.
        </p>
      </div>

      <div id="swagger-ui" className="mx-auto max-w-6xl rounded-xl border border-gray-200 bg-white" />

      <Script
        src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"
        strategy="afterInteractive"
        onLoad={loadSwaggerUi}
      />
    </main>
  );
}