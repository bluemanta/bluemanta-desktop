import { useLocation } from 'wouter';
import { useAppNavigate } from '../app/context';
import { DISCARD_CONFIRM, useConfirm } from '../ui/ConfirmDialog';
import { useIdeasState } from './IdeasState';
import { sectionOf } from './model/paths';

export type IdeaView = 'list' | 'stats' | 'trash';

/** 页头分段和命令面板共用：离开清单时，有未保存修改先确认。 */
export function useGoToSection(): (target: IdeaView) => void {
  const navigate = useAppNavigate();
  const [location] = useLocation();
  const { tabs, lastActive, dirtyIds, discardSessions } = useIdeasState();
  const confirm = useConfirm();
  const current = sectionOf(location);

  return (target) => {
    const run = () => {
      if (target === 'list') {
        const last = lastActive.current;
        navigate(last && tabs.includes(last) ? `/ideas/${encodeURIComponent(last)}` : '/ideas');
        return;
      }
      navigate(target === 'stats' ? '/ideas/stats' : '/ideas/trash');
    };
    if (target !== 'list' && target !== current && dirtyIds.size > 0) {
      void confirm(DISCARD_CONFIRM).then((ok) => {
        if (!ok) return;
        discardSessions();
        run();
      });
      return;
    }
    run();
  };
}
