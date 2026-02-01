// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Toaster } from 'react-hot-toast';

// Layout
import Layout from './components/Layout/Layout';

// Pages
import Login from './pages/auth/Login';
import Dashboard from './pages/Dashboard';
import EmployeeList from './pages/employees/EmployeeList';
import EmployeeDetail from './pages/employees/EmployeeDetail';

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
        <Route path="/clients" element={<PlaceholderPage title="取引先管理" />} />
        <Route path="/clients/:id" element={<PlaceholderPage title="取引先詳細" />} />

        {/* 現場管理 */}
        <Route path="/sites" element={<PlaceholderPage title="現場管理" />} />
        <Route path="/sites/:id" element={<PlaceholderPage title="現場詳細" />} />

        {/* 日報管理 */}
        <Route path="/reports" element={<PlaceholderPage title="日報管理" />} />
        <Route path="/reports/:id" element={<PlaceholderPage title="日報詳細" />} />

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
          <AdminRoute><PlaceholderPage title="ユーザー管理" /></AdminRoute>
        } />
        <Route path="/settings" element={
          <AdminRoute><PlaceholderPage title="自社情報設定" /></AdminRoute>
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
