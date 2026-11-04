import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AccountGate } from './Account';

createRoot(document.getElementById('root')!).render(<AccountGate><App /></AccountGate>);
