import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Route, Switch } from 'wouter';
import { auth } from '../api/client';
import { createQueryClient, listenWindowFocus } from '../api/queries';
import { IdeasPage } from '../ideas/IdeasPage';
import { IdeasStateProvider } from '../ideas/IdeasState';
import { IdeaHotkeys } from '../ideas/hotkeys';
import { NavigationGuard } from '../ideas/NavigationGuard';
import { TrashPage } from '../ideas/TrashPage';
import { ComingSoon } from '../shell/ComingSoon';
import { NeedsReopen } from '../shell/NeedsReopen';
import { Shell } from '../shell/Shell';
import { ConfirmProvider } from '../ui/ConfirmDialog';
import { ToastProvider } from '../ui/Toast';
import { TooltipProvider } from '../ui/Tooltip';
import { LaunchContext, useAppNavigate } from './context';
import type { Launch } from './launch';
import { useTheme } from './theme';

function RedirectToIdeas() {
  const navigate = useAppNavigate();
  useEffect(() => navigate('/ideas', { replace: true }), [navigate]);
  return null;
}

function Routes() {
  return (
    <Switch>
      <Route path="/ideas">
        <IdeasPage id={null} />
      </Route>
      <Route path="/ideas/stats">
        <Shell section="stats">
          <ComingSoon title="统计即将上线" text="指标、记录频率和分类分布会在后续版本上线。" />
        </Shell>
      </Route>
      <Route path="/ideas/trash">
        <TrashPage />
      </Route>
      <Route path="/ideas/:id">{(params) => <IdeasPage id={decodeURIComponent(params.id)} />}</Route>
      <Route>
        <RedirectToIdeas />
      </Route>
    </Switch>
  );
}

export function App({ launch }: { launch: Launch }) {
  const [client] = useState(() => {
    listenWindowFocus();
    return createQueryClient();
  });
  const rejected = useSyncExternalStore(
    (listener) => auth.subscribe(listener),
    () => auth.isRejected(),
  );
  useTheme(launch.parentOrigin);

  useEffect(() => {
    if (rejected) client.clear();
  }, [rejected, client]);

  let content;
  if (launch.token === null) content = <NeedsReopen reason="missing" />;
  else if (rejected) content = <NeedsReopen reason="rejected" />;
  else
    content = (
      <ConfirmProvider>
        <IdeasStateProvider>
          <NavigationGuard />
          <IdeaHotkeys />
          <Routes />
        </IdeasStateProvider>
      </ConfirmProvider>
    );

  return (
    <LaunchContext.Provider value={launch}>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={300}>
          <ToastProvider>{content}</ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </LaunchContext.Provider>
  );
}
