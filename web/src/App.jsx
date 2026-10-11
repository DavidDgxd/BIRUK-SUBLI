import { Route, Routes } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import SearchResults from './pages/SearchResults.jsx';
import ReportLost from './pages/ReportLost.jsx';
import ReportFound from './pages/ReportFound.jsx';
import StaffIntake from './pages/StaffIntake.jsx';
import StaffLogin from './pages/StaffLogin.jsx';
import AdminOffices from './pages/AdminOffices.jsx';
import RoutePlaceholder from './pages/RoutePlaceholder.jsx';

/*
 * Route table. "/", "/search", "/report/lost", "/report/found",
 * "/staff/login", "/staff/intake" and "/admin/offices" are built. The remaining
 * paths are linked from the landing page and render a placeholder until their
 * features land.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/search" element={<SearchResults />} />
      <Route path="/report/lost" element={<ReportLost />} />
      <Route path="/report/found" element={<ReportFound />} />
      <Route path="/staff/intake" element={<StaffIntake />} />
      <Route path="/admin/offices" element={<AdminOffices />} />
      <Route path="/staff/login" element={<StaffLogin />} />
      <Route
        path="*"
        element={
          <RoutePlaceholder
            title="Page not found"
            message="We couldn't find that page. Head back to the search to look for an item."
          />
        }
      />
    </Routes>
  );
}
