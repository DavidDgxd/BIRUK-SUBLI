import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { StaffAuthProvider } from './context/StaffAuthContext.jsx';
import './theme.css';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <StaffAuthProvider>
        <App />
      </StaffAuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
