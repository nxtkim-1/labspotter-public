import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AccountGate } from './Account';
import './dark.css';

try { document.documentElement.dataset.theme = localStorage.getItem('labspotter_theme') || 'light'; } catch {}

createRoot(document.getElementById('root')!).render(<AccountGate><App /></AccountGate>);
