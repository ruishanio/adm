import React from 'react';
import { createRoot } from 'react-dom/client';
import type { Api } from '../shared/contracts';
import { App } from './App';
import './styles.css';
declare global {
  interface Window {
    androidTool: Api;
  }
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
