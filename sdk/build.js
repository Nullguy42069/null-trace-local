import { build } from 'esbuild';

const shared = {
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
    'fs',
    'path',
  ],
};

// Build main SDK
await build({ ...shared, entryPoints: ['src/index.js'], outfile: 'dist/index.mjs', format: 'esm' });
await build({ ...shared, entryPoints: ['src/index.js'], outfile: 'dist/index.cjs', format: 'cjs' });

// Build limit-orders extension
await build({ ...shared, entryPoints: ['src/limit-orders.js'], outfile: 'dist/limit-orders.mjs', format: 'esm' });
await build({ ...shared, entryPoints: ['src/limit-orders.js'], outfile: 'dist/limit-orders.cjs', format: 'cjs' });

console.log('Build complete: dist/index + dist/limit-orders (mjs + cjs)');
