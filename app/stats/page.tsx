'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import SessionGuard from '@/app/components/SessionGuard';
import { apiGet } from '@/lib/apiClient';

interface StatRow {
  source_file: string;
  folder: string;
  file_name: string;
  answered_count: number;
  correct_count: number;
  partial_sum: number;
  total_questions: number;
  score: number;
  consistency: number;
  coverage: number;
  low_confidence: boolean;
}

interface StatsResponse {
  mode: string;
  stats: StatRow[];
  exam_count: number;
}

function pct(v: number): string {
  return (v * 100).toFixed(0) + '%';
}

function barClass(score: number, answered: boolean): string {
  if (!answered) return 'fill-gray-300 dark:fill-gray-600';
  if (score >= 0.7) return 'fill-green-600 dark:fill-green-500';
  if (score >= 0.5) return 'fill-amber-500 dark:fill-amber-400';
  return 'fill-red-600 dark:fill-red-500';
}

function barTextClass(score: number, answered: boolean): string {
  if (!answered) return 'fill-gray-400 dark:fill-gray-500';
  if (score >= 0.7) return 'fill-green-700 dark:fill-green-400';
  if (score >= 0.5) return 'fill-amber-600 dark:fill-amber-400';
  return 'fill-red-700 dark:fill-red-400';
}

function scoreTextColor(score: number, answered: boolean): string {
  if (!answered) return 'text-gray-400 dark:text-gray-500';
  if (score >= 0.7) return 'text-green-700 dark:text-green-400';
  if (score >= 0.5) return 'text-amber-700 dark:text-amber-400';
  return 'text-red-700 dark:text-red-400';
}

/** Strip file extension (.docx, .pdf, etc.) */
function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function BarChart({ rows }: { rows: StatRow[] }) {
  if (rows.length === 0) return null;

  const sorted = [...rows].sort((a, b) => a.score - b.score);

  const barW = 44;
  const gap = 6;
  const chartH = 180;
  const labelH = 68;
  const axisW = 38;
  const topPad = 12;
  const totalW = axisW + sorted.length * (barW + gap);

  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="overflow-x-auto">
      <svg
        width={totalW}
        height={chartH + labelH + topPad}
        aria-label="Score per file bar chart"
      >
        {gridLines.map((v) => {
          const y = topPad + chartH * (1 - v);
          return (
            <g key={v}>
              <line
                x1={axisW}
                y1={y}
                x2={totalW}
                y2={y}
                className="stroke-gray-200 dark:stroke-gray-700"
                strokeWidth={1}
              />
              <text
                x={axisW - 4}
                y={y + 4}
                textAnchor="end"
                fontSize={10}
                className="fill-gray-400 dark:fill-gray-500"
              >
                {(v * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}

        {sorted.map((row, i) => {
          const x = axisW + i * (barW + gap);
          const barH = chartH * row.score;
          const y = topPad + chartH - barH;
          const label = stripExt(row.file_name);

          return (
            <g key={row.source_file}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(barH, row.answered_count > 0 ? 2 : 0)}
                className={barClass(row.score, row.answered_count > 0)}
                rx={3}
              />
              {row.answered_count > 0 && (
                <text
                  x={x + barW / 2}
                  y={y - 3}
                  textAnchor="middle"
                  fontSize={9}
                  className={barTextClass(row.score, row.answered_count > 0)}
                  fontWeight="600"
                >
                  {(row.score * 100).toFixed(0)}%
                </text>
              )}
              <text
                x={x + barW / 2}
                y={topPad + chartH + 8}
                textAnchor="end"
                fontSize={10}
                className={row.answered_count > 0 ? 'fill-gray-700 dark:fill-gray-300' : 'fill-gray-400 dark:fill-gray-600'}
                transform={`rotate(-45, ${x + barW / 2}, ${topPad + chartH + 8})`}
              >
                {label.length > 18 ? label.slice(0, 16) + '…' : label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function StatsContent() {
  const [mode, setMode] = useState<'last' | 'all'>('last');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<StatsResponse | null>(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    setData(null);

    apiGet(`/api/stats?mode=${mode}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body?.error ?? 'Failed to load stats.');
          return;
        }
        const body: StatsResponse = await res.json();
        setData(body);
      })
      .catch(() => setError('Network error. Please try again.'))
      .finally(() => setLoading(false));
  }, [mode]);

  const stats = data?.stats ?? [];
  const hasData = stats.some((r) => r.answered_count > 0);
  const tableRows = stats;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-900">
      <header className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">MedQuiz</h1>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Performance Stats</h2>

          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-medium shadow-sm overflow-hidden">
            <button
              onClick={() => setMode('last')}
              className={`px-4 py-2 transition-colors ${
                mode === 'last'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              Last exam
            </button>
            <button
              onClick={() => setMode('all')}
              className={`px-4 py-2 transition-colors border-l border-gray-200 dark:border-gray-700 ${
                mode === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              All exams
            </button>
          </div>
        </div>

        {data && (
          <p className="mb-4 text-xs text-gray-400 dark:text-gray-500">
            {mode === 'last'
              ? 'Showing your most recent finished exam.'
              : `Aggregated across ${data.exam_count} finished exam${data.exam_count !== 1 ? 's' : ''} — one score per question (latest attempt).`}
          </p>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <p className="text-gray-400 dark:text-gray-500">Loading stats…</p>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/30 px-4 py-3 text-sm text-red-700 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-800">
            {error}
          </div>
        )}

        {!loading && !error && !hasData && (
          <div className="rounded-xl bg-white dark:bg-gray-800 p-10 text-center shadow-sm ring-1 ring-gray-200 dark:ring-gray-700">
            <p className="text-gray-500 dark:text-gray-400">No finished exams yet. Complete an exam to see your stats.</p>
            <Link
              href="/dashboard"
              className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Go to Dashboard
            </Link>
          </div>
        )}

        {!loading && !error && hasData && (
          <>
            <div className="mb-8 rounded-xl bg-white dark:bg-gray-800 p-5 shadow-sm ring-1 ring-gray-200 dark:ring-gray-700">
              <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Score by file — sorted weakest first (score = points earned / total questions in file)
              </h3>
              <BarChart rows={stats} />
            </div>

            <div className="overflow-hidden rounded-xl bg-white dark:bg-gray-800 shadow-sm ring-1 ring-gray-200 dark:ring-gray-700">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    <tr>
                      <th className="px-4 py-3 text-left">File</th>
                      <th className="px-4 py-3 text-right">Answered</th>
                      <th className="px-4 py-3 text-right">Correct</th>
                      <th className="px-4 py-3 text-right">Score</th>
                      <th className="px-4 py-3 text-right">Consistency</th>
                      <th className="px-4 py-3 text-right">Coverage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {(() => {
                      const elements: React.ReactNode[] = [];
                      let lastFolder = '';
                      for (const row of tableRows) {
                        if (row.folder !== lastFolder) {
                          lastFolder = row.folder;
                          elements.push(
                            <tr key={`folder-${row.folder}`} className="bg-gray-50 dark:bg-gray-700/30">
                              <td
                                colSpan={6}
                                className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500"
                              >
                                {row.folder}
                              </td>
                            </tr>
                          );
                        }

                        const noData = row.answered_count === 0;
                        const scoreColor = scoreTextColor(row.score, !noData);

                        elements.push(
                          <tr
                            key={row.source_file}
                            className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${noData ? 'opacity-50' : ''}`}
                          >
                            <td className="px-4 py-3 text-gray-900 dark:text-gray-100">
                              <span className="font-medium">{stripExt(row.file_name)}</span>
                              {row.low_confidence && (
                                <span
                                  className="ml-2 rounded-full bg-yellow-100 dark:bg-yellow-900/30 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700 dark:text-yellow-400 ring-1 ring-yellow-200 dark:ring-yellow-800"
                                  title="Fewer than 3 answered questions — low confidence"
                                >
                                  low data
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                              {row.answered_count}/{row.total_questions}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                              {row.correct_count}
                            </td>
                            <td className={`px-4 py-3 text-right tabular-nums font-semibold ${scoreColor}`}>
                              {noData ? '—' : `${row.partial_sum.toFixed(2)} / ${row.answered_count}`}
                              {!noData && (
                                <span className="ml-1 text-xs font-normal text-gray-400 dark:text-gray-500">
                                  ({(row.answered_count > 0 ? (row.partial_sum / row.answered_count) * 100 : 0).toFixed(0)}%)
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                              {noData ? '—' : pct(row.consistency)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                              {noData ? '—' : pct(row.coverage)}
                            </td>
                          </tr>
                        );
                      }
                      return elements;
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span>
                <strong>Score</strong> = earned points / answered (chart uses earned / total file size)
              </span>
              <span>
                <strong>Consistency</strong> = fully correct / answered
              </span>
              <span>
                <strong>Coverage</strong> = answered / total questions
              </span>
              <span className="rounded-full bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 text-yellow-700 dark:text-yellow-400 ring-1 ring-yellow-200 dark:ring-yellow-800">
                low data
              </span>{' '}
              = fewer than 3 answered
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default function StatsPage() {
  return (
    <SessionGuard>
      <StatsContent />
    </SessionGuard>
  );
}
