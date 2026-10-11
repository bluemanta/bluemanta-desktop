import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('侧栏品牌', () => {
  it('停用官方品牌行，并用固定色占位图标填三个 slot', () => {
    const patch = readFileSync(root + 'cordis.patch.yml', 'utf8');
    expect(patch).toContain('id: ui-brand-official');
    expect(patch).toContain('disabled: true');
    expect(patch).toContain('single slot');
    expect(patch).toContain('卸载');

    const pkg = JSON.parse(readFileSync(root + 'package.json', 'utf8')) as {
      dsh: { client: { inject: string[] } };
    };
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-conversation');

    const client = readFileSync(root + 'client.js', 'utf8');
    expect(client).toContain('function BrandMark({ size = 24, className })');
    expect(client).toContain("fill: '#2A715A'");
    expect(client).toContain("fill: '#FFFFFF'");
    expect(client).not.toContain('#1f6feb');
    expect(client).not.toMatch(/var\(--dsw-alias-brand-primary\)/);
    expect(client).toContain("color: 'var(--dsw-alias-label-primary)'");
    expect(client).toContain("}, 'bluemanta')");
    expect(client).toMatch(
      /ctx\.slots\.inject\('sidebar\.brand\.mark', \(\) =>\s*ctx\.slots\.inject\('sidebar\.brand\.name', function\* \(\) \{\s*yield ctx\.slots\.register\(\{ name: 'sidebar\.brand\.mark' \}, BrandMark\)\s*yield ctx\.slots\.register\(\{ name: 'sidebar\.brand\.name' \}, BrandName\)/,
    );
    expect(client).toContain("ctx.slots.inject('conversation.hero.brand.mark', () =>");
    expect(client).toContain("ctx.slots.register({ name: 'conversation.hero.brand.mark' }, BrandMark)");
    expect(client).not.toContain('@deepseek-ai/');

    const readme = readFileSync(root + 'README.md', 'utf8');
    expect(readme).toContain('ui-brand-official');
    expect(readme).toContain('BrandMark');
    expect(readme).toContain('卸载本插件后');
  });
});
