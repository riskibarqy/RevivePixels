import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import App from './App';

const container = document.getElementById('root');

if (!container) {
    throw new Error("Root container not found. Make sure the element with ID 'root' exists in your HTML.");
}

const root = createRoot(container); // Now container is guaranteed to be non-null

root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
