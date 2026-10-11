import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { auth } from './api/client';
import { App } from './app/App';
import { readLaunch } from './app/launch';
import { initialTheme } from './app/theme';
import './styles/global.css';

const launch = readLaunch(window);
auth.setToken(launch.token);

// 先涂上深浅色，避免首屏闪一下；之后由 useTheme 接管。嵌入模式不读本地偏好。
document.documentElement.dataset.theme = initialTheme(launch.embed !== null);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App launch={launch} />
    </StrictMode>,
  );
}
