export const DEV_PROFILE_DIR: '.dsh-dev/home/profiles/bluemanta-dev';

export const PLUGIN_PACKAGE: '@bluemanta/dsh-plugin';

export function profileNeedsCreate(profileDirExists: boolean): boolean;

export function pluginNeedsAdd(dependencyNames: readonly string[] | null | undefined): boolean;
