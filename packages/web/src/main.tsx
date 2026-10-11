import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { auth } from './api/client';
import { App } from './app/App';
import { readLaunch } from './app/launch';
import './styles/global.css';

const launch = readLaunch(window);
auth.setToken(launch.token);

// 先按系统设置深浅色，避免首屏闪一下；之后由 useTheme 接管。
document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App launch={launch} />
    </StrictMode>,
  );
}
