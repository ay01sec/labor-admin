// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Toaster } from 'react-hot-toast';

// Layout
import Layout from './components/Layout/Layout';

// Auth Pages
import Login from './pages/auth/Login';
import ForgotPassword from './pages/auth/ForgotPassword';
import Register from './pages/auth/Register';

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
import MfaSettings from './pages/settings/MfaSettings';

// Report Pages
import ReportList from './pages/reports/ReportList';
import ReportDetail from './pages/reports/ReportDetail';
import AttendanceSummary from './pages/reports/AttendanceSummary';

// Help Page
import HelpPage from './pages/HelpPage';

// Legal Pages
import TermsOfService from './pages/legal/TermsOfService';
import PrivacyPolicy from './pages/legal/PrivacyPolicy';
import Tokushoho from './pages/legal/Tokushoho';

// Placeholder pages (開発中)
const PlaceholderPage = ({ title }) => (
  <div className="bg-white rounded-xl shadow-sm p-8 text-center">
    <div className="text-6xl mb-4">🚧</div>
    <h1 className="text-2xl font-bold text-gray-800 mb-2">{title}</h1>
    <p className="text-gray-500">この機能は開発中です</p>
  </div>
);

// 認証が必要なルート
function PrivateRoute({ children, skipMfaCheck = false }) {
  const { currentUser, loading, requiresMfaSetup, requires2FA, loginInProgress } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ログイン処理中または2FA待ちの場合はログインページへ
  if (!currentUser || loginInProgress || requires2FA) {
    return <Navigate to="/login" />;
  }

  // 管理者でMFA未設定の場合、MFA設定ページにリダイレクト（MFA設定ページ自体は除外）
  if (!skipMfaCheck && requiresMfaSetup() && location.pathname !== '/settings/mfa') {
    return <Navigate to="/settings/mfa" replace />;
  }

  return children;
}

// 事務員以上（管理者・事務員）がアクセス可能なルート
function OfficeRoute({ children }) {
  const { isOfficeOrAbove, loading, userInfo } = useAuth();

  if (loading || !userInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return isOfficeOrAbove() ? children : <Navigate to="/" />;
}

function AppRoutes() {
  const { currentUser, requires2FA, loginInProgress } = useAuth();

  // デバッグ
  console.log('AppRoutes - currentUser:', !!currentUser, 'requires2FA:', requires2FA, 'loginInProgress:', loginInProgress);

  // 2FA待ち or ログイン処理中の場合はログイン未完了として扱う
  const isFullyLoggedIn = currentUser && !requires2FA && !loginInProgress;
  console.log('AppRoutes - isFullyLoggedIn:', isFullyLoggedIn);

  return (
    <Routes>
      {/* ログイン */}
      <Route
        path="/login"
        element={isFullyLoggedIn ? <Navigate to="/" /> : <Login />}
      />

      {/* パスワードリセット */}
      <Route
        path="/forgot-password"
        element={isFullyLoggedIn ? <Navigate to="/" /> : <ForgotPassword />}
      />

      {/* 新規利用開始手続き */}
      <Route
        path="/register"
        element={isFullyLoggedIn ? <Navigate to="/" /> : <Register />}
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

        {/* 事務員以上がアクセス可能なルート */}
        <Route path="/contracts" element={
          <OfficeRoute><PlaceholderPage title="雇用契約書管理" /></OfficeRoute>
        } />
        <Route path="/documents" element={
          <OfficeRoute><PlaceholderPage title="各種書類管理" /></OfficeRoute>
        } />
        <Route path="/leaves" element={
          <OfficeRoute><PlaceholderPage title="有給休暇管理" /></OfficeRoute>
        } />
        <Route path="/users" element={
          <OfficeRoute><UserList /></OfficeRoute>
        } />
        <Route path="/users/:id" element={
          <OfficeRoute><UserDetail /></OfficeRoute>
        } />
        <Route path="/settings" element={
          <OfficeRoute><CompanySettings /></OfficeRoute>
        } />
        <Route path="/settings/notifications" element={
          <OfficeRoute><NotificationSettings /></OfficeRoute>
        } />
        <Route path="/settings/mfa" element={
          <PrivateRoute skipMfaCheck><MfaSettings /></PrivateRoute>
        } />

        {/* ヘルプ */}
        <Route path="/help" element={<HelpPage />} />

        {/* 法務関連ページ */}
        <Route path="/legal/terms" element={<TermsOfService />} />
        <Route path="/legal/privacy" element={<PrivacyPolicy />} />
        <Route path="/legal/tokushoho" element={<Tokushoho />} />
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
