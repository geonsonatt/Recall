import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import './app/globals.css';
import App from './app/App';

const rootNode = document.getElementById('app');

if (!rootNode) {
  throw new Error('Корневой контейнер #app не найден.');
}

createRoot(rootNode).render(<App />);
