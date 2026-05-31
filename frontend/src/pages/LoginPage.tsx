import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { toast } from '../components/common/Toast';
import { Ticket, Zap, Shield, Clock } from 'lucide-react';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await authApi.login(email, password);
      login(data.accessToken, data.user);
      navigate('/');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Invalid credentials';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (role: 'admin' | 'user') => {
    setEmail(role === 'admin' ? 'admin@ticketvault.com' : 'user@ticketvault.com');
    setPassword(role === 'admin' ? 'admin123' : 'user123');
  };

  return (
    <div className="auth-layout">
      <div className="auth-visual">
        <div className="nav-brand-icon" style={{ width: 52, height: 52, borderRadius: 14, marginBottom: 20 }}>
          <Ticket size={24} />
        </div>
        <h1 className="auth-visual-title">TicketVault</h1>
        <p className="auth-visual-sub">
          A distributed booking engine built for concurrency, reliability, and zero double-bookings.
        </p>

        <div className="auth-visual-stats">
          {[
            { icon: Zap, value: '< 40ms', label: 'p99 latency' },
            { icon: Shield, value: '0', label: 'double-bookings' },
            { icon: Clock, value: '10 min', label: 'seat hold window' },
            { icon: Ticket, value: '99.5%', label: 'booking SLO' },
          ].map(({ icon: Icon, value, label }) => (
            <div key={label} className="auth-stat-card">
              <Icon size={14} style={{ color: 'var(--accent-light)', marginBottom: 6, opacity: 0.7 }} />
              <div className="auth-stat-value">{value}</div>
              <div className="auth-stat-label">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="auth-form-panel">
        <motion.div
          className="auth-form-inner"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="auth-form-header">
            <h2 className="auth-form-title">Welcome back</h2>
            <p className="auth-form-sub">Sign in to manage your tickets</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="field">
              <label className="field-label">Email address</label>
              <input
                className="field-input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>
            <div className="field">
              <label className="field-label">Password</label>
              <input
                className="field-input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-block"
              style={{ marginTop: 4 }}
              disabled={loading}
            >
              {loading ? <><LoadingSpinner size="sm" /> Signing in…</> : 'Sign in'}
            </button>
          </form>

          <p className="auth-form-footer">
            Don't have an account?{' '}
            <Link to="/register" className="auth-link">Create one</Link>
          </p>

          <div className="auth-demo-creds">
            <div className="auth-demo-label">Quick fill — demo credentials</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ flex: 1, fontSize: '0.75rem' }}
                onClick={() => fillDemo('user')}
              >
                User account
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ flex: 1, fontSize: '0.75rem' }}
                onClick={() => fillDemo('admin')}
              >
                Admin account
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
