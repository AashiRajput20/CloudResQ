import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Services from './pages/Services';
import ServiceDetails from './pages/ServiceDetails';
import ComingSoon from './pages/ComingSoon';
import Instances from './pages/Instances';
import FailureHistory from './pages/FailureHistory';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/services" element={<Services />} />
          <Route path="/services/:id" element={<ServiceDetails />} />
         <Route path="/instances" element={<Instances />} />
          <Route path="/recovery-history" element={<ComingSoon title="Recovery History" phase="Phase 10" />} />
          <Route path="/failure-history" element={<ComingSoon title="Failure History" phase="Phase 8" />} />
          <Route path="/scaling-history" element={<ComingSoon title="Scaling History" phase="Phase 13" />} />
          <Route path="/analytics" element={<ComingSoon title="Analytics" phase="Phase 14" />} />
          <Route path="/settings" element={<ComingSoon title="System Settings" phase="Phase 14" />} />
          <Route path="*" element={<ComingSoon title="Page Not Found" phase="never :)" />} />
          <Route path="/failure-history" element={<FailureHistory />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}