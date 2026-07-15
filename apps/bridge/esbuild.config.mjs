import esbuild from 'esbuild';
import builtins from 'builtin-modules';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = dirname(fileURLToPath(import.meta.url));
await esbuild.build({
  entryPoints: [join(root, 'src/main.ts')],
  bundle: true,
  external: ['obsidian', '@codemirror/state', '@codemirror/view', ...builtins],
  format: 'cjs',
  target: 'es2022',
  outfile: join(root, 'main.js'),
  sourcemap: false,
  logLevel: 'info',
});
