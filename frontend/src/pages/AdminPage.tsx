import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { AdminDashboard } from '../components/admin/AdminDashboard';

export function AdminPage() {
  const user = useAuthStore(s => s.user);
  if (user?.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <div className="page-content">
      <div className="container admin-page">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 24 }}>
          <h1 className="admin-heading">Operations Console</h1>
        </div>
        <AdminDashboard />
      </div>
    </div>
  );
}
