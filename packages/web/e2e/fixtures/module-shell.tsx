import { QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { Route, Switch, useLocation } from 'wouter';
import { auth } from '../../src/api/client';
import { createQueryClient } from '../../src/api/queries';
import { LaunchContext } from '../../src/app/context';
import { readLaunch } from '../../src/app/launch';
import { CommandPaletteProvider } from '../../src/ideas/CommandPalette';
import { IdeasPage } from '../../src/ideas/IdeasPage';
import { IdeasStateProvider } from '../../src/ideas/IdeasState';
import { IdeaHotkeys } from '../../src/ideas/hotkeys';
import { Shell } from '../../src/shell/Shell';
import { IDEAS_MODULE, type WorkbenchModule } from '../../src/shell/modules';
import { ConfirmProvider } from '../../src/ui/ConfirmDialog';
import { ToastProvider } from '../../src/ui/Toast';
import { TooltipProvider } from '../../src/ui/Tooltip';
import '../../src/styles/global.css';

const fakeModule: WorkbenchModule = {
  id: 'fake',
  name: '假模块',
  icon: 'extension',
  pathPrefix: '/fake',
  rootPath: '/fake',
  sections: [
    { id: 'home', label: '首页', path: '/fake' },
    { id: 'matrix', label: '矩阵', path: '/fake/matrix' },
  ],
  commands: [{ id: 'matrix', label: '打开假模块矩阵', path: '/fake/matrix' }],
};
const modules = [IDEAS_MODULE, fakeModule];
const launch = readLaunch(window);
auth.setToken(launch.token);

function FakePage() {
  const [path] = useLocation();
  return (
    <Shell module={fakeModule} section={path === '/fake/matrix' ? 'matrix' : 'home'}>
      <p>虚构模块页面</p>
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(
  <LaunchContext.Provider value={launch}>
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider delayDuration={0}>
        <ToastProvider>
          <ConfirmProvider>
            <IdeasStateProvider>
              <CommandPaletteProvider modules={modules}>
                <IdeaHotkeys />
                <Switch>
                  <Route path="/ideas"><IdeasPage id={null} /></Route>
                  <Route><FakePage /></Route>
                </Switch>
              </CommandPaletteProvider>
            </IdeasStateProvider>
          </ConfirmProvider>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </LaunchContext.Provider>,
);
