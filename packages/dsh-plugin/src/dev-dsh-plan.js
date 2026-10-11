/** `npm run dev:dsh` 重复运行时，哪些步骤可以跳过。 */

export const DEV_PROFILE_DIR = '.dsh-dev/home/profiles/bluemanta-dev';

export const PLUGIN_PACKAGE = '@bluemanta/dsh-plugin';

/** 开发用端口，避开用户本机可能已经开着的 4310。 */
export const DEV_SERVER_PORT = '4311';

export function dataDirNeedsSeed(fileNames) {
  const names = Array.isArray(fileNames) ? fileNames : [];
  return !names.includes('store.sqlite');
}

export function profileNeedsCreate(profileDirExists) {
  return profileDirExists !== true;
}

export function pluginNeedsAdd(dependencyNames) {
  const names = Array.isArray(dependencyNames) ? dependencyNames : [];
  return !names.includes(PLUGIN_PACKAGE);
}
