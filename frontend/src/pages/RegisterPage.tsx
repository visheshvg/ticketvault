import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { toast } from '../components/common/Toast';
import { Ticket } from 'lucide-react';

export function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await authApi.register(form.email, form.password, form.name);
      login(data.accessToken, data.user);
      toast.success('Account created!');
      navigate('/');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Registration failed';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-layout">
      <div className="auth-visual">
        <div className="nav-brand-icon" style={{ width: 52, height: 52, borderRadius: 14, marginBottom: 20 }}>
          <Ticket size={24} />
        </div>
        <h1 className="auth-visual-title">TicketVault</h1>
        <p className="auth-visual-sub">
          Create an account to start booking seats for live events with real-time availability.
        </p>
      </div>

      <div className="auth-form-panel">
        <motion.div
          className="auth-form-inner"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="auth-form-header">
            <h2 className="auth-form-title">Create account</h2>
            <p className="auth-form-sub">Join to start booking live events</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="field">
              <label className="field-label">Full name</label>
              <input
                className="field-input"
                value={form.name}
                onChange={set('name')}
                placeholder="Jane Smith"
                required
                autoComplete="name"
                minLength={2}
              />
            </div>
            <div className="field">
              <label className="field-label">Email address</label>
              <input
                className="field-input"
                type="email"
                value={form.email}
                onChange={set('email')}
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
                value={form.password}
                onChange={set('password')}
                placeholder="8+ characters"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-block"
              style={{ marginTop: 4 }}
              disabled={loading}
            >
              {loading ? <><LoadingSpinner size="sm" /> Creating account…</> : 'Create account'}
            </button>
          </form>

          <p className="auth-form-footer">
            Already have an account?{' '}
            <Link to="/login" className="auth-link">Sign in</Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
