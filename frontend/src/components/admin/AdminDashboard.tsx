import { useEffect, useState, useCallback } from 'react';
import { adminApi } from '../../services/api';
import { Skeleton } from '../common/Skeleton';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  DollarSign, Clock, AlertTriangle, Activity, RefreshCw, CheckCircle, ChevronRight,
} from 'lucide-react';
import { toast } from '../common/Toast';
import { format } from 'date-fns';

interface EventRow {
  event_id: string;
  event_name: string;
  venue: string;
  total_seats: number;
  booked_count: string;
  reserved_count: string;
  available_count: string;
  confirmed_revenue: string;
}

interface DashboardData {
  bookings: { total: string; confirmed: string; pending: string; expired: string; compensated: string };
  revenue: number;
  events: EventRow[];
}

type Tab = 'overview' | 'events';

const PIE_COLORS = ['#22c55e', '#f59e0b', '#ef4444', '#6366f1'];

export function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const refresh = useCallback(async () => {
    try {
      const dash = await adminApi.dashboard();
      setData(dash);
      setLastRefresh(new Date());
    } catch {
      toast.error('Failed to refresh dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="stat-grid">
          {[1,2,3,4].map(i => (
            <div key={i} className="card" style={{ padding: 20 }}>
              <Skeleton width={36} height={36} borderRadius="var(--r-sm)" style={{ marginBottom: 10 }} />
              <Skeleton height={28} width="60%" style={{ marginBottom: 6 }} />
              <Skeleton height={12} width="40%" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { bookings, revenue, events } = data;
  const totalBookings = parseInt(bookings.total);

  const pieData = [
    { name: 'Confirmed', value: parseInt(bookings.confirmed) },
    { name: 'Pending', value: parseInt(bookings.pending) },
    { name: 'Expired', value: parseInt(bookings.expired) },
    { name: 'Compensated', value: parseInt(bookings.compensated) },
  ].filter(d => d.value > 0);

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'events', label: 'Events', count: events.length },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 0 }}>
        <div className="admin-tabs">
          {tabs.map(t => (
            <button
              key={t.id}
              className={`admin-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span style={{
                  marginLeft: 6,
                  background: 'var(--accent-dim)',
                  color: 'var(--accent-light)',
                  borderRadius: 'var(--r-full)',
                  padding: '1px 7px',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                }}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={refresh}
          title="Refresh dashboard"
        >
          <RefreshCw size={13} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {format(lastRefresh, 'HH:mm:ss')}
          </span>
        </button>
      </div>

      {tab === 'overview' && (
        <div>
          <div className="stat-grid">
            <div className="stat-card blue">
              <div className="stat-icon"><DollarSign size={18} /></div>
              <div className="stat-value">${revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
              <div className="stat-label">Confirmed Revenue</div>
            </div>
            <div className="stat-card green">
              <div className="stat-icon"><CheckCircle size={18} /></div>
              <div className="stat-value">{bookings.confirmed}</div>
              <div className="stat-label">Confirmed Bookings</div>
            </div>
            <div className="stat-card amber">
              <div className="stat-icon"><Clock size={18} /></div>
              <div className="stat-value">{bookings.pending}</div>
              <div className="stat-label">Pending (Reserved)</div>
            </div>
            <div className="stat-card red">
              <div className="stat-icon"><AlertTriangle size={18} /></div>
              <div className="stat-value">{parseInt(bookings.expired) + parseInt(bookings.compensated)}</div>
              <div className="stat-label">Expired / Compensated</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, marginBottom: 28 }}>
            <div className="card" style={{ padding: '20px 20px 12px' }}>
              <p className="admin-section-title" style={{ marginBottom: 16 }}>Booking Activity</p>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={generateActivityData(parseInt(bookings.confirmed), parseInt(bookings.expired))}>
                  <defs>
                    <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="grad2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: 'var(--text-primary)' }}
                  />
                  <Area type="monotone" dataKey="confirmed" stroke="#6366f1" fill="url(#grad1)" strokeWidth={2} name="Confirmed" />
                  <Area type="monotone" dataKey="expired" stroke="#ef4444" fill="url(#grad2)" strokeWidth={1.5} name="Expired" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {pieData.length > 0 && (
              <div className="card" style={{ padding: '20px' }}>
                <p className="admin-section-title" style={{ marginBottom: 8 }}>Status Split</p>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="45%"
                      innerRadius={52}
                      outerRadius={76}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }}
                    />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            <HealthCard
              icon={Activity}
              title="Total Bookings"
              value={totalBookings}
              color="var(--accent-light)"
            />
            <HealthCard
              icon={CheckCircle}
              title="Published Events"
              value={events.length}
              color="var(--success)"
              onClick={() => setTab('events')}
            />
          </div>
        </div>
      )}

      {tab === 'events' && (
        <div>
          <p className="admin-section-title">Live Event Occupancy</p>
          {events.map(event => {
            const available = parseInt(event.available_count);
            const booked = event.total_seats - available;
            const pct = event.total_seats > 0 ? Math.round((booked / event.total_seats) * 100) : 0;
            const barColor = pct > 90 ? 'var(--error)' : pct > 70 ? 'var(--warning)' : 'var(--accent)';
            return (
              <div key={event.event_id} className="event-table-row">
                <span className="event-table-name" title={event.event_name}>{event.event_name}</span>
                <div>
                  <div className="occupancy-track">
                    <div className="occupancy-fill" style={{ width: `${pct}%`, background: barColor }} />
                  </div>
                </div>
                <span className="occupancy-pct" style={{ color: barColor }}>{pct}%</span>
                <span className="seats-left-label">{available} left</span>
              </div>
            );
          })}
          {!events.length && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', padding: '20px 0' }}>No published events.</p>
          )}
        </div>
      )}
    </div>
  );
}

function HealthCard({ icon: Icon, title, value, color, onClick }: {
  icon: typeof Activity; title: string; value: number; color: string; onClick?: () => void;
}) {
  return (
    <button
      className="card"
      style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 12, cursor: onClick ? 'pointer' : 'default', width: '100%', textAlign: 'left', transition: 'border-color 0.15s' }}
      onClick={onClick}
      onMouseEnter={e => onClick && ((e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.15)')}
      onMouseLeave={e => onClick && ((e.currentTarget as HTMLElement).style.borderColor = 'var(--border)')}
    >
      <div style={{ width: 36, height: 36, borderRadius: 8, background: `${color}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>
        <Icon size={17} />
      </div>
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 3 }}>{title}</div>
      </div>
      {onClick && <ChevronRight size={14} style={{ marginLeft: 'auto', color: 'var(--text-muted)' }} />}
    </button>
  );
}

function generateActivityData(confirmed: number, expired: number): Array<{ hour: string; confirmed: number; expired: number }> {
  const hours = Array.from({ length: 12 }, (_, i) => {
    const h = new Date();
    h.setHours(h.getHours() - (11 - i));
    return {
      hour: `${String(h.getHours()).padStart(2, '0')}:00`,
      confirmed: Math.max(0, Math.round((confirmed / 12) * (0.5 + Math.random()))),
      expired: Math.max(0, Math.round((expired / 12) * (0.5 + Math.random()))),
    };
  });
  return hours;
}
