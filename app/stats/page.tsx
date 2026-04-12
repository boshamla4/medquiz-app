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

function barColor(score: number, answered: boolean): string {
  if (!answered) return '#d1d5db'; // gray-300
  if (score >= 0.7) return '#16a34a'; // green-600
  if (score >= 0.5) return '#d97706'; // amber-600
  return '#dc2626'; // red-600
}

function scoreTextColor(score: number, answered: boolean): string {
  if (!answered) return 'text-gray-400';
  if (score >= 0.7) return 'text-green-700';
  if (score >= 0.5) return 'text-amber-700';
  return 'text-red-700';
}

/** Strip file extension (.docx, .pdf, etc.) */
function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/** Bar chart rendered as inline SVG — no external deps */
function BarChart({ rows }: { rows: StatRow[] }) {
  if (rows.length === 0) return null;

  // Sort ascending by score (weakest first)
  const sorted = [...rows].sort((a, b) => a.score - b.score);

  const barW = 44;
  const gap = 6;
  const chartH = 180;
  const labelH = 68; // rotated label space
  const axisW = 38;
  const topPad = 12;
  const totalW = axisW + sorted.length * (barW + gap);

  // Y-axis grid lines at 0%, 25%, 50%, 75%, 100%
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="overflow-x-auto">
      <svg
        width={totalW}
        height={chartH + labelH + topPad}
        aria-label="Score per file bar chart"
      >
        {/* Y-axis grid lines and labels */}
        {gridLines.map((v) => {
          const y = topPad + chartH * (1 - v);
          return (
            <g key={v}>
              <line
                x1={axisW}
                y1={y}
                x2={totalW}
                y2={y}
                stroke="#e5e7eb"
                strokeWidth={1}
              />
              <text
                x={axisW - 4}
                y={y + 4}
                textAnchor="end"
                fontSize={10}
                fill="#9ca3af"
              >
                {(v * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}

        {/* Bars and X-axis labels */}
        {sorted.map((row, i) => {
          const x = axisW + i * (barW + gap);
          const barH = chartH * row.score;
          const y = topPad + chartH - barH;
          const color = barColor(row.score, row.answered_count > 0);
          const label = stripExt(row.file_name);

          return (
            <g key={row.source_file}>
              {/* Bar */}
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(barH, row.answered_count > 0 ? 2 : 0)}
                fill={color}
                rx={3}
              />
              {/* Score label on top of bar */}
              {row.answered_count > 0 && (
                <text
                  x={x + barW / 2}
                  y={y - 3}
                  textAnchor="middle"
                  fontSize={9}
                  fill={color}
                  fontWeight="600"
                >
                  {(row.score * 100).toFixed(0)}%
                </text>
              )}
              {/* X-axis label, rotated */}
              <text
                x={x + barW / 2}
                y={topPad + chartH + 8}
                textAnchor="end"
                fontSize={10}
                fill={row.answered_count > 0 ? '#374151' : '#9ca3af'}
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

  // Files with at least one attempt, sorted for the table (folder → file_name)
  const tableRows = stats; // already sorted by API

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">MedQuiz</h1>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-gray-900">Performance Stats</h2>

          {/* Mode toggle */}
          <div className="flex rounded-lg border border-gray-200 bg-white text-sm font-medium shadow-sm overflow-hidden">
            <button
              onClick={() => setMode('last')}
              className={`px-4 py-2 transition-colors ${
                mode === 'last'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Last exam
            </button>
            <button
              onClick={() => setMode('all')}
              className={`px-4 py-2 transition-colors border-l border-gray-200 ${
                mode === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              All exams
            </button>
          </div>
        </div>

        {data && (
          <p className="mb-4 text-xs text-gray-400">
            {mode === 'last'
              ? 'Showing your most recent finished exam.'
              : `Aggregated across ${data.exam_count} finished exam${data.exam_count !== 1 ? 's' : ''} — one score per question (latest attempt).`}
          </p>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <p className="text-gray-400">Loading stats…</p>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
            {error}
          </div>
        )}

        {!loading && !error && !hasData && (
          <div className="rounded-xl bg-white p-10 text-center shadow-sm ring-1 ring-gray-200">
            <p className="text-gray-500">No finished exams yet. Complete an exam to see your stats.</p>
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
            {/* Bar chart */}
            <div className="mb-8 rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
              <h3 className="mb-4 text-sm font-semibold text-gray-700">
                Score by file — sorted weakest first (score = points earned / total questions in file)
              </h3>
              <BarChart rows={stats} />
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left">File</th>
                      <th className="px-4 py-3 text-right">Answered</th>
                      <th className="px-4 py-3 text-right">Correct</th>
                      <th className="px-4 py-3 text-right">Score</th>
                      <th className="px-4 py-3 text-right">Consistency</th>
                      <th className="px-4 py-3 text-right">Coverage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(() => {
                      const elements: React.ReactNode[] = [];
                      let lastFolder = '';
                      for (const row of tableRows) {
                        // Folder separator row
                        if (row.folder !== lastFolder) {
                          lastFolder = row.folder;
                          elements.push(
                            <tr key={`folder-${row.folder}`} className="bg-gray-50">
                              <td
                                colSpan={6}
                                className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400"
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
                            className={`hover:bg-gray-50 ${noData ? 'opacity-50' : ''}`}
                          >
                            <td className="px-4 py-3 text-gray-900">
                              <span className="font-medium">{stripExt(row.file_name)}</span>
                              {row.low_confidence && (
                                <span
                                  className="ml-2 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700 ring-1 ring-yellow-200"
                                  title="Fewer than 3 answered questions — low confidence"
                                >
                                  low data
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                              {row.answered_count}/{row.total_questions}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                              {row.correct_count}
                            </td>
                            <td className={`px-4 py-3 text-right tabular-nums font-semibold ${scoreColor}`}>
                              {noData ? '—' : `${row.partial_sum.toFixed(2)} / ${row.answered_count}`}
                              {!noData && (
                                <span className="ml-1 text-xs font-normal text-gray-400">
                                  ({(row.answered_count > 0 ? (row.partial_sum / row.answered_count) * 100 : 0).toFixed(0)}%)
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                              {noData ? '—' : pct(row.consistency)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-600">
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

            {/* Legend */}
            <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-500">
              <span>
                <strong>Score</strong> = earned points / answered (chart uses earned / total file size)
              </span>
              <span>
                <strong>Consistency</strong> = fully correct / answered
              </span>
              <span>
                <strong>Coverage</strong> = answered / total questions
              </span>
              <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-yellow-700 ring-1 ring-yellow-200">
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
