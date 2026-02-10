# NullTrace SDK

Standalone JavaScript SDK for [NullTrace](https://nulltrace.app) — privacy-focused Solana transactions powered by Light Protocol ZK compression. No server needed.

## Install

```bash
npm install nulltrace-sdk @solana/web3.js @solana/spl-token @lightprotocol/stateless.js @lightprotocol/compressed-token
```

> A **Helius RPC endpoint** is required. ZK compression depends on Helius's photon indexer. Get a free key at [helius.dev](https://helius.dev).

## Quick Start

```js
import { NullTrace } from 'nulltrace-sdk';

const nt = new NullTrace('https://mainnet.helius-rpc.com/?api-key=YOUR_KEY', wallet);

// Nullify 0.5 SOL (public -> private)
await nt.nullify('So11111111111111111111111111111111111111112', '0.5');

// Reveal 0.5 SOL (private -> public)
await nt.reveal('So11111111111111111111111111111111111111112', '0.5');

// Private transfer
await nt.transfer('So11111111111111111111111111111111111111112', '1.0', 'RecipientAddress...');

// Private swap SOL -> USDT
await nt.swap('So11111111111111111111111111111111111111112', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', '1.0');

// Get all balances
const balances = await nt.getBalances();
```

## Constructor

```js
const nt = new NullTrace(rpcUrl, wallet);
```

| Param | Type | Description |
|-------|------|-------------|
| `rpcUrl` | `string` | **Helius** RPC endpoint (validated, throws if not Helius) |
| `walletOrKey` | see below | Wallet adapter, Keypair, secret key, or private key string |

The second argument is flexible — pass whatever you have:

### Option 1: Wallet Adapter (browser)

```js
// Works with Phantom, Solflare, or any Solana wallet adapter
const nt = new NullTrace(rpcUrl, wallet);
```

### Option 2: Keypair (Node.js)

```js
import { Keypair } from '@solana/web3.js';

const keypair = Keypair.fromSecretKey(mySecretKey);
const nt = new NullTrace(rpcUrl, keypair);
```

### Option 3: Secret Key bytes (Uint8Array)

```js
const secretKey = new Uint8Array([/* 64 bytes */]);
const nt = new NullTrace(rpcUrl, secretKey);
```

### Option 4: Base58 private key string

```js
// As exported by Phantom, Solflare, etc.
const nt = new NullTrace(rpcUrl, '4wBqpZM9...');
```

All four options produce identical functionality. Options 2–4 automatically create a full wallet interface (including `signMessage` for private balance lookups).

### Static factory methods

You can also build wallet adapters independently:

```js
const wallet = NullTrace.fromKeypair(keypair);
const wallet = NullTrace.fromSecretKey(uint8Array);
const wallet = NullTrace.fromPrivateKey('base58string...');
```

---

## API Reference

### `nt.nullify(mint, amount)`

Convert public tokens into private ZK-compressed state.

```js
const sigs = await nt.nullify('So11111111111111111111111111111111111111112', '0.5');
// Returns: ['5xYk...', ...]  (transaction signatures)
```

### `nt.reveal(mint, amount)`

Decompress private tokens back to public state.

```js
const sigs = await nt.reveal('So11111111111111111111111111111111111111112', '0.5');
```

### `nt.transfer(mint, amount, recipient)`

Send compressed tokens privately to another address.

```js
const sigs = await nt.transfer(
  'So11111111111111111111111111111111111111112',
  '1.0',
  '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
);
```

### `nt.swap(fromMint, toMint, amount, options?)`

Execute a private swap via the NullTrace operator.

```js
const result = await nt.swap(
  'So11111111111111111111111111111111111111112',  // from SOL
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  // to USDT
  '1.0'
);
console.log(result.status); // 'completed'
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `onStatusChange` | `(s) => void` | — | Called with 'signing', 'processing', 'completed' |
| `timeout` | `number` | `120000` | Max wait time in ms |

```js
// With status updates
await nt.swap(SOL, USDT, '1.0', {
  onStatusChange: (status) => console.log('Status:', status),
});
```

### `nt.quoteSwap(inputMint, outputMint, amount)`

Get a swap quote without executing.

```js
const quote = await nt.quoteSwap(
  'So11111111111111111111111111111111111111112',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  '1.0'
);
console.log(`Output: ${quote.outAmount}, Impact: ${quote.priceImpact}%`);
```

### `nt.getPublicBalances()`

Fetch on-chain token balances. No signing needed.

```js
const balances = await nt.getPublicBalances();
// [{ symbol: 'SOL', amount: '2.5', address: 'So11...', decimals: 9, ... }]
```

### `nt.getPrivateBalances()`

Fetch ZK-compressed balances. Requires `wallet.signMessage` (prompted once, cached).

```js
const balances = await nt.getPrivateBalances();
```

### `nt.getBalances()`

Get all balances merged, with `publicAmount` and `privateAmount` fields.

```js
const all = await nt.getBalances();
for (const t of all) {
  console.log(`${t.symbol}: ${t.publicAmount} public, ${t.privateAmount} private`);
}
```

### `nt.getTokenMetadata(mint)`

Fetch token metadata (symbol, name, logo, decimals).

```js
const meta = await nt.getTokenMetadata('Es9vMFr...');
console.log(meta.symbol, meta.decimals); // 'USDT' 6
```

### `nt.clearSignatureCache()`

Clear the cached message signature so the next private balance call re-prompts.

---

## Usage with React + Wallet Adapter

```jsx
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { NullTrace } from 'nulltrace-sdk';
import { useMemo } from 'react';

function MyComponent() {
  const wallet = useWallet();

  const nt = useMemo(() => {
    if (!wallet.publicKey) return null;
    return new NullTrace('https://mainnet.helius-rpc.com/?api-key=YOUR_KEY', wallet);
  }, [wallet.publicKey]);

  const handleNullify = async () => {
    const sigs = await nt.nullify('So11111111111111111111111111111111111111112', '0.5');
    console.log('Done:', sigs);
  };

  return <button onClick={handleNullify}>Nullify 0.5 SOL</button>;
}
```

## Usage with Node.js

```js
import { Keypair } from '@solana/web3.js';
import { NullTrace } from 'nulltrace-sdk';

// Pass a Keypair directly — no manual wallet wiring needed
const nt = new NullTrace(
  'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY',
  Keypair.fromSecretKey(mySecretKey)
);

// Or use a base58 private key string (as exported by Phantom)
// const nt = new NullTrace(rpcUrl, '4wBqpZM9k...');

const balances = await nt.getBalances();
console.log(balances);

await nt.nullify('So11111111111111111111111111111111111111112', '0.5');
```

## License

MIT — [NullTrace](https://nulltrace.app)
