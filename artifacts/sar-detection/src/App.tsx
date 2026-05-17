import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth-context";
import { ProtectedRoute } from "@/components/protected-route";

import Home from "@/pages/home";
import Login from "@/pages/login";
import Register from "@/pages/register";
import Dashboard from "@/pages/dashboard";
import UploadAnalysis from "@/pages/upload";
import Detections from "@/pages/detections";
import DetectionDetail from "@/pages/detection-detail";
import CCTVPage from "@/pages/cctv";
import MonitorsPage from "@/pages/monitors";
import MyAccount from "@/pages/my-account";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      {/* Public Routes */}
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      
      {/* Protected Routes */}
      <Route path="/dashboard">
        <ProtectedRoute><Dashboard /></ProtectedRoute>
      </Route>
      <Route path="/upload">
        <ProtectedRoute><UploadAnalysis /></ProtectedRoute>
      </Route>
      <Route path="/detections">
        <ProtectedRoute><Detections /></ProtectedRoute>
      </Route>
      <Route path="/detections/:id">
        <ProtectedRoute><DetectionDetail /></ProtectedRoute>
      </Route>
      <Route path="/cctv">
        <ProtectedRoute><CCTVPage /></ProtectedRoute>
      </Route>
      <Route path="/monitors">
        <ProtectedRoute><MonitorsPage /></ProtectedRoute>
      </Route>
      <Route path="/my-account">
        <ProtectedRoute><MyAccount /></ProtectedRoute>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
