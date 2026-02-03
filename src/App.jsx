// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Toaster } from 'react-hot-toast';

// Layout
import Layout from './components/Layout/Layout';

// Auth Pages
import Login from './pages/auth/Login';
import ForgotPassword from './pages/auth/ForgotPassword';

// Main Pages
import Dashboard from './pages/Dashboard';

// Employee Pages
import EmployeeList from './pages/employees/EmployeeList';
import EmployeeDetail from './pages/employees/EmployeeDetail';

// Client Pages
import ClientList from './pages/clients/ClientList';
import ClientDetail from './pages/clients/ClientDetail';

// Site Pages
import SiteList from './pages/sites/SiteList';
import SiteDetail from './pages/sites/SiteDetail';

// User Pages
import UserList from './pages/users/UserList';
import UserDetail from './pages/users/UserDetail';

// Settings Pages
import CompanySettings from './pages/settings/CompanySettings';
import NotificationSettings from './pages/settings/NotificationSettings';

// Report Pages
import ReportList from './pages/reports/ReportList';
import ReportDetail from './pages/reports/ReportDetail';
import AttendanceSummary from './pages/reports/AttendanceSummary';

// Placeholder pages (開発中)
const PlaceholderPage = ({ title }) => (
  <div className="bg-white rounded-xl shadow-sm p-8 text-center">
    <div className="text-6xl mb-4">🚧</div>
    <h1 className="text-2xl font-bold text-gray-800 mb-2">{title}</h1>
    <p className="text-gray-500">この機能は開発中です</p>
  </div>
);

// 認証が必要なルート
function PrivateRoute({ children }) {
  const { currentUser, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return currentUser ? children : <Navigate to="/login" />;
}

// 管理者専用ルート
function AdminRoute({ children }) {
  const { isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return isAdmin() ? children : <Navigate to="/" />;
}

function AppRoutes() {
  const { currentUser } = useAuth();

  return (
    <Routes>
      {/* ログイン */}
      <Route
        path="/login"
        element={currentUser ? <Navigate to="/" /> : <Login />}
      />

      {/* パスワードリセット */}
      <Route
        path="/forgot-password"
        element={currentUser ? <Navigate to="/" /> : <ForgotPassword />}
      />

      {/* 認証が必要なルート */}
      <Route
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        {/* ダッシュボード */}
        <Route path="/" element={<Dashboard />} />

        {/* 社員管理 */}
        <Route path="/employees" element={<EmployeeList />} />
        <Route path="/employees/:id" element={<EmployeeDetail />} />

        {/* 取引先管理 */}
        <Route path="/clients" element={<ClientList />} />
        <Route path="/clients/:id" element={<ClientDetail />} />

        {/* 現場管理 */}
        <Route path="/sites" element={<SiteList />} />
        <Route path="/sites/:id" element={<SiteDetail />} />

        {/* 日報管理 */}
        <Route path="/reports" element={<ReportList />} />
        <Route path="/reports/attendance" element={<AttendanceSummary />} />
        <Route path="/reports/:id" element={<ReportDetail />} />

        {/* 管理者専用ルート */}
        <Route path="/contracts" element={
          <AdminRoute><PlaceholderPage title="雇用契約書管理" /></AdminRoute>
        } />
        <Route path="/documents" element={
          <AdminRoute><PlaceholderPage title="各種書類管理" /></AdminRoute>
        } />
        <Route path="/leaves" element={
          <AdminRoute><PlaceholderPage title="有給休暇管理" /></AdminRoute>
        } />
        <Route path="/users" element={
          <AdminRoute><UserList /></AdminRoute>
        } />
        <Route path="/users/:id" element={
          <AdminRoute><UserDetail /></AdminRoute>
        } />
        <Route path="/settings" element={
          <AdminRoute><CompanySettings /></AdminRoute>
        } />
        <Route path="/settings/notifications" element={
          <AdminRoute><NotificationSettings /></AdminRoute>
        } />
      </Route>

      {/* 404 */}
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#363636',
              color: '#fff',
            },
            success: {
              iconTheme: {
                primary: '#22c55e',
                secondary: '#fff',
              },
            },
            error: {
              iconTheme: {
                primary: '#ef4444',
                secondary: '#fff',
              },
            },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  );
}
