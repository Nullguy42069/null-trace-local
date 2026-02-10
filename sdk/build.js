import { build } from 'esbuild';

const shared = {
  entryPoints: ['src/index.js'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  external: [
    '@solana/web3.js',
    '@solana/spl-token',
    '@lightprotocol/stateless.js',
    '@lightprotocol/compressed-token',
    'tweetnacl',
    'bs58',
    'crypto',
  ],
};

await build({ ...shared, outfile: 'dist/index.mjs', format: 'esm' });
await build({ ...shared, outfile: 'dist/index.cjs', format: 'cjs' });

console.log('Build complete: dist/index.mjs + dist/index.cjs');
