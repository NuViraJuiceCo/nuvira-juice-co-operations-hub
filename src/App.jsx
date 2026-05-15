import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import PageTransition from './components/PageTransition';
import ThemeProvider from './components/ThemeProvider';
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

import UserManagement from './pages/UserManagement';
import AuditLogs from './pages/AuditLogs';
import ReportScheduler from './pages/ReportScheduler';
import Settings from './pages/Settings';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import ComplianceCenter from './pages/ComplianceCenter';
import LoyaltyAdmin from './pages/LoyaltyAdmin';
import ComplianceLogs from './pages/ComplianceLogs';
import OperationsManager from './pages/OperationsManager';
import DriverPortal from './pages/DriverPortal';
import ProductionPlanning from './pages/ProductionPlanning';
import StripeRepair from './pages/StripeRepair';
import OrderReviewQueue from './pages/OrderReviewQueue';
import Alerts from './pages/Alerts';
import LiveOrderMonitor from './pages/LiveOrderMonitor';
import DeliveryRouteReviews from './pages/DeliveryRouteReviews';
import POSValidation from './pages/POSValidation';

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
      navigateToLogin();
      return null;
    }
  }



  // Render the main app
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<PageTransition><Dashboard /></PageTransition>} />
        <Route path="/orders" element={<PageTransition><Orders /></PageTransition>} />
        <Route path="/production" element={<PageTransition><Production /></PageTransition>} />
        <Route path="/fulfillment" element={<PageTransition><Fulfillment /></PageTransition>} />
        <Route path="/reporting" element={<PageTransition><Reporting /></PageTransition>} />
        <Route path="/calendar" element={<PageTransition><OperationsCalendar /></PageTransition>} />
        <Route path="/inventory" element={<PageTransition><Inventory /></PageTransition>} />
        <Route path="/suppliers" element={<PageTransition><Suppliers /></PageTransition>} />
        <Route path="/resources" element={<PageTransition><Resources /></PageTransition>} />
        <Route path="/events" element={<PageTransition><Events /></PageTransition>} />
        <Route path="/partnerships" element={<PageTransition><Partnerships /></PageTransition>} />
        <Route path="/prod-scheduler" element={<PageTransition><ProdScheduler /></PageTransition>} />
        <Route path="/purchase-orders" element={<PageTransition><PurchaseOrders /></PageTransition>} />
        <Route path="/driver-portal" element={<PageTransition><DriverPortal /></PageTransition>} />
        <Route path="/production-planning" element={<PageTransition><ProductionPlanning /></PageTransition>} />
        <Route path="/users" element={<PageTransition><UserManagement /></PageTransition>} />
        <Route path="/audit-logs" element={<PageTransition><AuditLogs /></PageTransition>} />
        <Route path="/report-scheduler" element={<PageTransition><ReportScheduler /></PageTransition>} />
        <Route path="/settings" element={<PageTransition><Settings /></PageTransition>} />
        <Route path="/compliance" element={<PageTransition><ComplianceLogs /></PageTransition>} />
        <Route path="/compliance-center" element={<PageTransition><ComplianceCenter /></PageTransition>} />
        <Route path="/loyalty-admin" element={<PageTransition><LoyaltyAdmin /></PageTransition>} />
        <Route path="/operations-manager" element={<PageTransition><OperationsManager /></PageTransition>} />
        <Route path="/stripe-repair" element={<PageTransition><StripeRepair /></PageTransition>} />
        <Route path="/order-review-queue" element={<PageTransition><OrderReviewQueue /></PageTransition>} />
        <Route path="/alerts" element={<PageTransition><Alerts /></PageTransition>} />
        <Route path="/live-monitor" element={<PageTransition><LiveOrderMonitor /></PageTransition>} />
        <Route path="/delivery-route-reviews" element={<PageTransition><DeliveryRouteReviews /></PageTransition>} />
        <Route path="/pos-validation" element={<PageTransition><POSValidation /></PageTransition>} />

        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="*" element={<PageNotFound />} />
      </Route>
    </Routes>
  );
};


function App() {

  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App