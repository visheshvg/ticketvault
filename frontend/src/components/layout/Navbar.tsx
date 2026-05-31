import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { Ticket, Shield, LogOut, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

export function Navbar() {
  const { user, isAuthenticated, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const isActive = (path: string) => location.pathname === path;

  const handleLogout = () => {
    logout();
    setMenuOpen(false);
    navigate('/login');
  };

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="nav-brand">
          <div className="nav-brand-icon">
            <Ticket size={16} />
          </div>
          TicketVault
        </Link>

        <div className="nav-links">
          <Link to="/" className={`nav-link ${isActive('/') ? 'active' : ''}`}>
            Events
          </Link>
          {isAuthenticated && (
            <Link to="/bookings" className={`nav-link ${isActive('/bookings') ? 'active' : ''}`}>
              My Tickets
            </Link>
          )}
          {user?.role === 'admin' && (
            <Link to="/admin" className="nav-admin-badge">
              <Shield size={12} /> Admin
            </Link>
          )}
        </div>

        <div className="nav-right">
          {isAuthenticated ? (
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button
                className="nav-user-chip"
                onClick={() => setMenuOpen(v => !v)}
              >
                <div className="nav-avatar">{initials}</div>
                <span>{user?.name?.split(' ')[0]}</span>
                <ChevronDown size={13} style={{ opacity: 0.5, marginLeft: 2 }} />
              </button>

              {menuOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)', padding: '6px', minWidth: 160,
                  boxShadow: 'var(--shadow-lg)', zIndex: 200,
                }}>
                  <div style={{ padding: '8px 10px 10px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{user?.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{user?.email}</div>
                  </div>
                  <Link
                    to="/bookings"
                    className="btn btn-ghost"
                    style={{ width: '100%', justifyContent: 'flex-start', padding: '8px 10px', fontSize: '0.85rem' }}
                    onClick={() => setMenuOpen(false)}
                  >
                    My Tickets
                  </Link>
                  {user?.role === 'admin' && (
                    <Link
                      to="/admin"
                      className="btn btn-ghost"
                      style={{ width: '100%', justifyContent: 'flex-start', padding: '8px 10px', fontSize: '0.85rem' }}
                      onClick={() => setMenuOpen(false)}
                    >
                      Admin Dashboard
                    </Link>
                  )}
                  <button
                    onClick={handleLogout}
                    className="btn btn-ghost"
                    style={{ width: '100%', justifyContent: 'flex-start', padding: '8px 10px', fontSize: '0.85rem', color: 'var(--error)' }}
                  >
                    <LogOut size={14} /> Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <Link to="/login" className="btn btn-ghost btn-sm">Sign in</Link>
              <Link to="/register" className="btn btn-primary btn-sm">Get started</Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
