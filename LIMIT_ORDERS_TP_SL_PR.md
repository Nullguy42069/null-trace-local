# Pull Request: Limit Orders + Take Profit / Stop Loss Extension

## Summary
Adds comprehensive limit order functionality to NullTrace SDK, including take profit, stop loss, and OCO (One Cancels Other) bracket orders for automated trading.

## Features

### 1. Take Profit Orders (`createTakeProfit`)
- Sell tokens when price reaches target (higher than entry)
- Support for % gain from entry (e.g., +35%)
- Or manual price targets

### 2. Stop Loss Orders (`createStopLoss`)  
- Sell tokens when price drops to target (lower than entry)
- Support for % loss from entry (e.g., -15%)
- Higher default slippage tolerance (15% vs 10% TP)
- Critical for risk management

### 3. Bracket Orders (`createBracketOrder`)
- Creates TP + SL as linked OCO pair
- When one executes, other auto-cancels
- Perfect for "set and forget" risk management
- Example: +35% TP / -15% SL on same position

### 4. Safety Features
- Liquidity check before creating orders
- Volume verification (min $10k default)
- Order expiry (default 7 days)
- Slippage protection per order
- Order persistence to disk

## Usage Example

```javascript
import { NullTrace, LimitOrders } from 'nulltrace-sdk';

const nt = new NullTrace(rpcUrl, wallet);
const lo = new LimitOrders(nt);

// Create TP at +35%
await lo.createTakeProfit({
  token: TOKEN_CA,
  amount: '10000',
  entryPrice: '0.00030',
  gainPercent: 35
});

// Create SL at -15%
await lo.createStopLoss({
  token: TOKEN_CA,
  amount: '10000',
  entryPrice: '0.00030',
  lossPercent: 15
});

// Or create both as OCO bracket
await lo.createBracketOrder({
  token: TOKEN_CA,
  amount: '10000',
  entryPrice: '0.00030',
  takeProfitPercent: 35,
  stopLossPercent: 15
});

// Start monitoring - executes automatically
lo.startMonitoring(30000); // Check every 30s
```

## Files Changed

| File | Change |
|------|--------|
| `sdk/src/limit-orders.js` | Enhanced with TP/SL methods + OCO support |
| `sdk/src/index.js` | Export LimitOrders class |
| `sdk/examples/limit-orders-tp-sl-example.js` | Comprehensive usage examples |
| `sdk/dist/*` | Built outputs |

## Benefits for Trading Operations

1. **Risk Management**: Automatic SL prevents catastrophic losses
2. **Profit Taking**: TP executes without emotional interference
3. **24/7 Operation**: Orders execute even when user offline
4. **OCO Logic**: Bracket orders ensure one outcome (profit OR controlled loss)
5. **Low Resource**: Client-side monitoring, minimal compute needed

## Testing

Tested on:
- Aztec position management
- Simulated TP/SL triggers
- OCO cancellation logic

## Related

- Builds on existing limit-orders foundation
- Works with preflight fix (commit `40882ed`)
- Ready for Anne agent integration

## PR Checklist

- [x] Code follows SDK patterns
- [x] Exported from main index
- [x] Example file provided
- [x] Built and tested
- [x] Documentation in PR

---

**GitHub Link:** https://github.com/Nullguy42069/null-trace-local/commit/c5264f1
