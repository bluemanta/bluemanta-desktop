import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Route, Switch } from 'wouter';
import { auth } from '../api/client';
import { createQueryClient, listenWindowFocus } from '../api/queries';
import { CommandPaletteProvider } from '../ideas/CommandPalette';
import { IdeasPage } from '../ideas/IdeasPage';
import { IdeasStateProvider, useIdeasState } from '../ideas/IdeasState';
import { IdeaHotkeys } from '../ideas/hotkeys';
import { KnowledgePage } from '../knowledge/KnowledgePage';
import { NavigationGuard } from '../ideas/NavigationGuard';
import { StatsPage } from '../ideas/StatsPage';
import { TrashPage } from '../ideas/TrashPage';
import { NeedsReopen } from '../shell/NeedsReopen';
import { Shell } from '../shell/Shell';
import { ConfirmProvider } from '../ui/ConfirmDialog';
import { ToastProvider } from '../ui/Toast';
import { TooltipProvider } from '../ui/Tooltip';
import { postToParent } from './bridge';
import { LaunchContext, useAppNavigate, useLaunch } from './context';
import type { Launch } from './launch';
import { useTheme } from './theme';

/** 嵌入时把未保存状态告诉 dsh，右侧栏关标签前由插件确认。 */
function EmbedDirty() {
  const { embed, parentOrigin } = useLaunch();
  const { dirtyIds } = useIdeasState();
  const dirty = dirtyIds.size > 0;
  useEffect(() => {
    if (embed === null) return;
    postToParent(window, parentOrigin, { type: 'bm:dirty', dirty });
  }, [embed, parentOrigin, dirty]);
  return null;
}

function RedirectToIdeas() {
  const navigate = useAppNavigate();
  useEffect(() => navigate('/ideas', { replace: true }), [navigate]);
  return null;
}

function Routes() {
  return (
    <Switch>
      {/* Register each module's top-level routes here; shell metadata lives in shell/modules.ts. */}
      <Route path="/ideas">
        <IdeasPage id={null} />
      </Route>
      <Route path="/ideas/stats">
        <Shell section="stats">
          <StatsPage />
        </Shell>
      </Route>
      <Route path="/ideas/trash">
        <TrashPage />
      </Route>
      <Route path="/ideas/:id">{(params) => <IdeasPage id={decodeURIComponent(params.id)} />}</Route>
      <Route path="/knowledge">
        <KnowledgePage />
      </Route>
      <Route path="/knowledge/*">
        <KnowledgePage />
      </Route>
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
  useTheme(launch.parentOrigin, launch.embed !== null);

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
          <CommandPaletteProvider>
            <EmbedDirty />
            <NavigationGuard />
            <IdeaHotkeys />
            <Routes />
          </CommandPaletteProvider>
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
