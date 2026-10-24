import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import { App } from './app/app';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><App /></StrictMode>);
