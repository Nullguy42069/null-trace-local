# Limit Orders Extension

The `nulltrace-sdk/limit-orders` extension adds automated limit order functionality to the NullTrace SDK. Orders are stored locally and executed automatically when price targets are hit, eliminating the need for polling loops.

## Installation

```bash
npm install nulltrace-sdk
```

## Usage

```javascript
import { NullTrace } from 'nulltrace-sdk';
import { LimitOrders } from 'nulltrace-sdk/limit-orders';
import { Keypair } from '@solana/web3.js';

// Initialize
const nt = new NullTrace('https://helius-rpc.com/?api-key=YOUR_KEY', wallet);
const lo = new LimitOrders(nt);

// Create take profit order
await lo.createLimitOrder({
  type: 'SELL_TP',
  token: 'F7CiHvT1AL...',  // Token address
  amount: '12000',         // Amount to sell
  triggerPrice: '0.000399', // Target price in USD
  slippage: 0.10,         // 10% max slippage
  label: 'MEGA TP +30%',
});

// Create stop loss order
await lo.createLimitOrder({
  type: 'SELL_SL',
  token: 'F7CiHvT1AL...',
  amount: '12000',
  triggerPrice: '0.000153', // -50% stop
  slippage: 0.15,
  label: 'MEGA SL -50%',
});

// Start monitoring (executes automatically)
lo.startMonitoring(30000); // Check every 30 seconds

// Check stats
console.log(lo.getStats());
// { total: 2, pending: 2, executed: 0, failed: 0, monitoring: true }
```

## API Reference

### `new LimitOrders(nulltrace, options)`

Creates a limit orders manager.

- `nulltrace` - NullTrace SDK instance
- `options.ordersFile` - Path to store orders (default: `./limit-orders.json`)
- `options.checks.minVolume24h` - Minimum 24h volume ($) to execute (default: 10000)
- `options.checks.maxSlippage` - Maximum slippage tolerance (default: 0.15)
- `options.checks.requireLiquidity` - Require minimum liquidity (default: true)

### `createLimitOrder(params)`

Creates a new limit order.

| Param | Type | Description |
|-------|------|-------------|
| `type` | `'SELL_TP' \| 'SELL_SL' \| 'BUY'` | Order type |
| `token` | `string` | Token mint address |
| `amount` | `string` | Amount to trade |
| `triggerPrice` | `string` | Price in USD to trigger at |
| `slippage` | `number` | Max slippage (0.1 = 10%) |
| `expiry` | `number` | Unix timestamp (default: 7 days) |
| `label` | `string` | Human-readable label |

Returns: Order object with `id`, `status: 'PENDING'`, etc.

### `getOrders(status?)`

Returns all orders, optionally filtered by status.

### `cancelOrder(orderId)`

Cancels a pending order.

### `startMonitoring(intervalMs)`

Starts the monitoring loop. Executes orders automatically when targets hit.

- `intervalMs` - Check interval in milliseconds (default: 30000)

### `stopMonitoring()`

Stops the monitoring loop.

### `getStats()`

Returns statistics: `{ total, pending, executed, failed, expired, cancelled, monitoring }`

## Order Types

| Type | Description |
|------|-------------|
| `SELL_TP` | Sell when price >= target (take profit) |
| `SELL_SL` | Sell when price <= target (stop loss) |
| `BUY` | Buy when price <= target (entry) |

## Safety Features

- ✅ Minimum volume check before execution (prevents thin market dumps)
- ✅ Liquidity verification
- ✅ Slippage limits
- ✅ Expiry handling (auto-cancel after deadline)
- ✅ Persistent storage (orders survive restarts)
- ✅ Error tracking (failed orders logged with reason)

## Example: Replace Polling with Limit Orders

**Before (manual polling):**
```javascript
// Check every 2 minutes... all night
setInterval(() => {
  const price = fetchPrice();
  if (price >= 0.000399) sell();
}, 120000);
```

**After (limit orders):**
```javascript
// Create once, executes automatically
await lo.createLimitOrder({
  type: 'SELL_TP',
  token: MEGA,
  amount: '12000',
  triggerPrice: '0.000399'
});
lo.startMonitoring();
// Done! Executes when target hit.
```

## Architecture

Orders are stored locally in JSON format:
```json
{
  "id": "order_1234567890_abc123",
  "type": "SELL_TP",
  "token": "F7CiHvT1AL...",
  "amount": "12000",
  "triggerPrice": "0.000399",
  "entryPrice": "0.000307",
  "status": "PENDING",
  "createdAt": 1770863818687,
  "expiry": 1771468618687
}
```

Price monitoring uses DexScreener API. Execution uses NullTrace's native `swap()` method.

## Future Improvements

This is a **client-side** implementation. For production use:

1. **Server-side monitoring** - Move monitoring to backend for 24/7 uptime
2. **WebSocket prices** - Real-time price feeds instead of polling
3. **Partial fills** - Support selling portions of position
4. **Position sizing** - Auto-calculate position from portfolio %

See `/examples/limit-orders.js` for complete working example.
