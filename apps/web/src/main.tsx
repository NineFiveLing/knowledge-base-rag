import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// 全局样式
import './styles/global.css';

/**
 * React 应用入口
 * React 18 createRoot API
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
