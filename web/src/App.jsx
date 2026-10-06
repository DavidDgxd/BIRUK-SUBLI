import { Route, Routes } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import SearchResults from './pages/SearchResults.jsx';
import RoutePlaceholder from './pages/RoutePlaceholder.jsx';

/*
 * Route table. "/" and "/search" are built. The other paths are linked from the
 * landing page and render a placeholder until their features land.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/search" element={<SearchResults />} />
      <Route
        path="/report/lost"
        element={<RoutePlaceholder title="Report a lost item" />}
      />
      <Route
        path="/report/found"
        element={<RoutePlaceholder title="Report a found item" />}
      />
      <Route
        path="/staff/login"
        element={<RoutePlaceholder title="Staff / Admin log in" />}
      />
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
