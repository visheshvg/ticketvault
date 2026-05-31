import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Navbar } from './components/layout/Navbar';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { HomePage } from './pages/HomePage';
import { EventPage } from './pages/EventPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { BookingsPage } from './pages/BookingsPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { AdminPage } from './pages/AdminPage';
import { useAuthStore } from './store/authStore';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

// Auth pages don't use the standard shell (they have their own full-page layout)
function AuthRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  return isAuthenticated ? <Navigate to="/" replace /> : <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-sans)',
            fontSize: '0.875rem',
          },
        }}
      />

      <Routes>
        <Route path="/login"    element={<AuthRoute><LoginPage /></AuthRoute>} />
        <Route path="/register" element={<AuthRoute><RegisterPage /></AuthRoute>} />

        <Route path="/*" element={
          <div className="app-shell">
            <Navbar />
            <ErrorBoundary>
              <Routes>
                <Route path="/"         element={<HomePage />} />
                <Route path="/events/:id" element={<EventPage />} />
                <Route path="/checkout/:bookingId" element={
                  <ProtectedRoute><CheckoutPage /></ProtectedRoute>
                } />
                <Route path="/bookings" element={
                  <ProtectedRoute><BookingsPage /></ProtectedRoute>
                } />
                <Route path="/admin" element={
                  <ProtectedRoute><AdminPage /></ProtectedRoute>
                } />
              </Routes>
            </ErrorBoundary>
          </div>
        } />
      </Routes>
    </BrowserRouter>
  );
}
