'use client';

import { useEffect, useRef, useState } from 'react';

interface TimerProps {
  startedAt: string;
  countdownMinutes?: number;
  onExpire?: () => void;
}

function formatTime(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const h = Math.floor(safe / 3600).toString().padStart(2, '0');
  const m = Math.floor((safe % 3600) / 60).toString().padStart(2, '0');
  const s = (safe % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export default function Timer({ startedAt, countdownMinutes = 0, onExpire }: TimerProps) {
  const [elapsed, setElapsed] = useState(0);
  const didExpireRef = useRef(false);

  const isCountdown = countdownMinutes > 0;
  const totalSeconds = countdownMinutes * 60;
  const remaining = totalSeconds - elapsed;
  const isWarning = isCountdown && remaining <= 60;

  useEffect(() => {
    const start = new Date(startedAt).getTime();

    function tick() {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  useEffect(() => {
    if (!isCountdown || didExpireRef.current || remaining > 0) return;
    didExpireRef.current = true;
    onExpire?.();
  }, [isCountdown, onExpire, remaining]);

  return (
    <div
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-mono font-medium ${
        isWarning ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-700'
      }`}
    >
      <svg
        className={`h-4 w-4 ${isWarning ? 'text-orange-600' : 'text-gray-500'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <circle cx="12" cy="12" r="10" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
      </svg>
      {isCountdown ? formatTime(remaining) : formatTime(elapsed)}
    </div>
  );
}
