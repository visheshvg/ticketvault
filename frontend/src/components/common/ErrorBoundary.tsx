import { Component, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 40,
          textAlign: 'center',
        }}>
          <div style={{
            width: 64, height: 64,
            background: 'var(--error-dim)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--error)',
          }}>
            <AlertTriangle size={28} />
          </div>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, marginBottom: 6 }}>
              Something went wrong
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              {this.state.error.message}
            </p>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
