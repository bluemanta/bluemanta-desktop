import { useLocation } from 'wouter';
import { useAppNavigate, useViewport } from '../../app/context';
import { DISCARD_CONFIRM, useConfirm } from '../../ui/ConfirmDialog';
import { useIdeasState } from '../IdeasState';
import { ideaIdFromPath, sectionOf } from '../model/paths';

/** 打开快速记录。在统计、回收站或窄屏详情里时先回到清单。 */
export function useOpenCapture(): () => void {
  const { openCapture, dirtyIds, discardSessions } = useIdeasState();
  const navigate = useAppNavigate();
  const [location] = useLocation();
  const viewport = useViewport();
  const confirm = useConfirm();

  return () => {
    const id = ideaIdFromPath(location);
    const leaveDetail = viewport === 'narrow' && id !== null;
    const leaveSection = sectionOf(location) !== 'list';
    const mustConfirm = (leaveDetail && id !== null && dirtyIds.has(id)) || (leaveSection && dirtyIds.size > 0);
    const go = () => {
      if (leaveSection) discardSessions();
      else if (leaveDetail && id) discardSessions([id]);
      openCapture();
      if (leaveDetail || leaveSection) navigate('/ideas');
    };
    if (!mustConfirm) {
      go();
      return;
    }
    void confirm(DISCARD_CONFIRM).then((ok) => {
      if (ok) go();
    });
  };
}
