import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PrivacyAmountsProvider } from './components/PrivacyAmounts';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><PrivacyAmountsProvider><App /></PrivacyAmountsProvider></React.StrictMode>,
);
