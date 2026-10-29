import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import DemoRoot from './demo/DemoRoot';
import { isDemo } from './lib/supabase';
import './lib/install';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDemo ? <DemoRoot /> : <App />}
  </StrictMode>,
);
