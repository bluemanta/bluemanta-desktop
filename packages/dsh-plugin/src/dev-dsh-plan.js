/** `npm run dev:dsh` 重复运行时，哪些步骤可以跳过。 */

export const DEV_PROFILE_DIR = '.dsh-dev/home/profiles/bluemanta-dev';

export const PLUGIN_PACKAGE = '@bluemanta/dsh-plugin';

export function profileNeedsCreate(profileDirExists) {
  return profileDirExists !== true;
}

export function pluginNeedsAdd(dependencyNames) {
  const names = Array.isArray(dependencyNames) ? dependencyNames : [];
  return !names.includes(PLUGIN_PACKAGE);
}
