import { useCountdown } from '../../hooks/useCountdown';
import { Clock, AlertTriangle } from 'lucide-react';

interface Props {
  expiresAt: Date;
  onExpire?: () => void;
}

export function CountdownTimer({ expiresAt, onExpire }: Props) {
  const { minutes, seconds, expired } = useCountdown(expiresAt);

  if (expired) {
    onExpire?.();
    return null;
  }

  const isUrgent = minutes === 0 && seconds < 120;
  const Icon = isUrgent ? AlertTriangle : Clock;

  return (
    <div className={`countdown-timer ${isUrgent ? 'urgent' : ''}`}>
      <Icon size={14} style={{ flexShrink: 0, color: isUrgent ? 'var(--error)' : 'var(--accent-light)' }} />
      <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
        Seat reserved for{' '}
      </span>
      <span className="countdown-digits" style={{ color: isUrgent ? 'var(--error)' : 'var(--text-primary)', fontSize: '0.95rem' }}>
        {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
      </span>
    </div>
  );
}
