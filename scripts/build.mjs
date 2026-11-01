import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
export async function buildNode() {
  await build({
    entryPoints: ['src/main/index.ts'],
    outfile: 'dist/main/index.cjs',
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
  });
  await build({
    entryPoints: ['src/preload/index.ts'],
    outfile: 'dist/preload/index.cjs',
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
  });
}
if (process.argv[1]?.endsWith('build.mjs')) {
  await buildNode();
  await viteBuild();
}
