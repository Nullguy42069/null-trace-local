# Helius Preflight Fix for NullTrace SDK

## Problem
SDK `swap()` fails on Helius with "Invalid Request: running preflight check is not supported"
This happens because `createRpc()` from `@lightprotocol/stateless.js` wraps the connection and preflight simulation fails on compress operations.

## Solution: Dual Connection System
Use standard `Connection` for transaction sending (with `skipPreflight: true`), keep `createRpc` for ZK operations.

---

## Changes Required

### 1. Constructor (`src/index.js` line ~247)

**Add after existing connection:**
```javascript
constructor(rpcUrl, walletOrKey) {
  _validateHeliusRpc(rpcUrl);
  if (!walletOrKey)
    throw new Error('NullTrace: a wallet, Keypair, secret key, or private key string is required');

  this.rpcUrl = rpcUrl;
  this.wallet = NullTrace._resolveWallet(walletOrKey);
  
  // For ZK operations (proofs, compressed account queries)
  this.connection = createRpc(rpcUrl, rpcUrl, rpcUrl, { commitment: 'processed' });
  
  // NEW: For sending transactions with skipPreflight fix
  const { Connection } = await import('@solana/web3.js');
  this.sendConnection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60000
  });

  this._adlCache = null;
  this._sigCache = null;
}
```

### 2. `_signSendConfirm` Helper (line ~194)

**Change to accept connection parameter:**
```javascript
async function _signSendConfirm(connection, wallet, transactions, skipPreflight = false) {
  const signed = await wallet.signAllTransactions(transactions);
  const sigs = [];
  for (const tx of signed) {
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: skipPreflight,
      preflightCommitment: 'confirmed',
      maxRetries: skipPreflight ? 5 : undefined
    });
    await connection.confirmTransaction(sig, 'confirmed');
    sigs.push(sig);
  }
  return sigs;
}
```

### 3. `swap()` Method - Pre-transactions (line ~475)

**Change from:**
```javascript
const sig = await this.connection.sendRawTransaction(signed[i].serialize());
await this.connection.confirmTransaction(sig);
```

**To:**
```javascript
const sig = await this.sendConnection.sendRawTransaction(signed[i].serialize(), {
  skipPreflight: true,
  maxRetries: 5
});
await this.sendConnection.confirmTransaction(sig, 'confirmed');
```

### 4. `swap()` Method - Main transfers (line ~510)

**Change from:**
```javascript
const transferTxs = await _packTransactions(this.connection, owner, ixs, adl);
const allTxs = [...preTransactions, ...transferTxs];
// ... signing ...
const sig = await this.connection.sendRawTransaction(signed[i].serialize());
```

**To:**
```javascript
const transferTxs = await _packTransactions(this.connection, owner, ixs, adl);
const allTxs = [...preTransactions, ...transferTxs];
// ... signing ...
// Use sendConnection with skipPreflight for pre-transactions
for (let i = 0; i < preTransactions.length; i++) {
  const sig = await this.sendConnection.sendRawTransaction(signed[i].serialize(), {
    skipPreflight: true,
    maxRetries: 5
  });
  await this.sendConnection.confirmTransaction(sig, 'confirmed');
  preSigs.push(sig);
}
// Use _signSendConfirm with sendConnection for transfers
const sigs = await _signSendConfirm(this.sendConnection, this.wallet, transferTxs, true);
```

### 5. Same pattern for `nullify()`, `reveal()`, `transfer()`

All methods that call `sendRawTransaction` should use `this.sendConnection` with `skipPreflight: true`.

---

## Testing

```javascript
const nt = new NullTrace(RPC_URL, wallet);

// This should now work without preflight errors
const result = await nt.swap(
  'So11111111111111111111111111111111111111112', // SOL
  'TARGET_TOKEN_MINT',
  '0.05'
);
```

---

## Why This Works

| Connection | Purpose | skipPreflight |
|------------|---------|---------------|
| `this.connection` (createRpc) | ZK proofs, tree queries, account state | N/A (queries only) |
| `this.sendConnection` (standard) | Transaction sending | `true` for compress/transfer |

Helius simulation fails because the simulator doesn't have ZK state (Merkle trees). By bypassing simulation only for transaction sends, we preserve all ZK functionality while fixing the preflight issue.

---

## Files Modified
- `sdk/src/index.js` (source)
- `sdk/dist/index.cjs` (built)
- `sdk/dist/index.mjs` (built)

**Submitted by:** Jarvis Trading Stack  
**Date:** 2026-02-12  
**Issue:** GitHub PR to follow
