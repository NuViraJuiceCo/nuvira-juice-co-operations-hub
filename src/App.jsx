import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import AppLayout from './components/layout/AppLayout';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import Production from './pages/Production';
import Fulfillment from './pages/Fulfillment';
import Reporting from './pages/Reporting';
import OperationsCalendar from './pages/OperationsCalendar';
import Inventory from './pages/Inventory';
import Suppliers from './pages/Suppliers';
import Compliance from './pages/Compliance';
import Resources from './pages/Resources';
import Events from './pages/Events';
import Partnerships from './pages/Partnerships';
import ProdScheduler from './pages/ProdScheduler';
import PurchaseOrders from './pages/PurchaseOrders';
import RouteOptimizer from './pages/RouteOptimizer';
import UserManagement from './pages/UserManagement';
import AuditLogs from './pages/AuditLogs';
import ReportScheduler from './pages/ReportScheduler';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/production" element={<Production />} />
        <Route path="/fulfillment" element={<Fulfillment />} />
        <Route path="/reporting" element={<Reporting />} />
        <Route path="/calendar" element={<OperationsCalendar />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/compliance" element={<Compliance />} />
        <Route path="/resources" element={<Resources />} />
        <Route path="/events" element={<Events />} />
        <Route path="/partnerships" element={<Partnerships />} />
        <Route path="/prod-scheduler" element={<ProdScheduler />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/route-optimizer" element={<RouteOptimizer />} />
        <Route path="/users" element={<UserManagement />} />
        <Route path="/audit-logs" element={<AuditLogs />} />
        <Route path="/report-scheduler" element={<ReportScheduler />} />
        <Route path="*" element={<PageNotFound />} />
      </Route>
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App