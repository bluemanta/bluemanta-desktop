export const WORKBENCH_PANEL_ID = 'bluemanta.workbench';
export const WORKBENCH_FRAME_NAME = 'bluemanta-workbench-main';
export const WORKBENCH_CONFIG_ROUTE = 'api/bluemanta/workbench-config';

export function workbenchFrameAttrs() {
  return { 'data-html-preview': '', name: WORKBENCH_FRAME_NAME };
}
