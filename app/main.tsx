import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { readTheme } from './theme';
import './styles.css';

document.documentElement.dataset.theme = readTheme();
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
