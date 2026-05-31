import { useState, useEffect } from 'react';

interface CountdownResult {
  minutes: number;
  seconds: number;
  expired: boolean;
}

export function useCountdown(expiresAt: Date | null): CountdownResult {
  const calculate = (): CountdownResult => {
    if (!expiresAt) return { minutes: 0, seconds: 0, expired: false };
    const diff = expiresAt.getTime() - Date.now();
    if (diff <= 0) return { minutes: 0, seconds: 0, expired: true };
    return {
      minutes: Math.floor(diff / 60000),
      seconds: Math.floor((diff % 60000) / 1000),
      expired: false,
    };
  };

  const [state, setState] = useState<CountdownResult>(calculate);

  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setState(calculate()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return state;
}
