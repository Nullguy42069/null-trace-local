/**
 * Limit Orders Example
 * 
 * Demonstrates creating and executing take-profit and stop-loss orders
 * using the NullTrace SDK LimitOrders extension.
 */

import { NullTrace } from '../src/index.js';
import { LimitOrders } from '../src/limit-orders.js';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// Configuration
const RPC_URL = process.env.HELIUS_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY';
const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('Please set SOLANA_PRIVATE_KEY environment variable');
  process.exit(1);
}

// Initialize wallet
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
console.log('Wallet:', wallet.publicKey.toString());

// Initialize NullTrace
const nt = new NullTrace(RPC_URL, wallet);

// Initialize LimitOrders
const lo = new LimitOrders(nt, {
  ordersFile: './my-orders.json',
  checks: {
    minVolume24h: 50000,  // Higher threshold for safety
    maxSlippage: 0.10,    // 10% max
    requireLiquidity: true,
  }
});

async function main() {
  console.log('\n=== Limit Orders Demo ===\n');

  // Example 1: Create Take Profit order for MEGA
  // Current price ~$0.000308, target +30% = $0.000399
  console.log('1. Creating Take Profit order...');
  const tpOrder = await lo.createLimitOrder({
    type: 'SELL_TP',
    token: 'F7CiHvT1ALYTY6mb2SLF4WMntQ1YCfm6YqKbL8S4B5W4',  // MEGA
    amount: '12000',  // Sell 12k tokens
    triggerPrice: '0.000399',  // +30% from entry
    slippage: 0.10,
    label: 'MEGA TP +30%',
    expiry: Date.now() + 7 * 24 * 60 * 60 * 1000,  // 7 days
  });

  // Example 2: Create Stop Loss order
  console.log('\n2. Creating Stop Loss order...');
  const slOrder = await lo.createLimitOrder({
    type: 'SELL_SL',
    token: 'F7CiHvT1ALYTY6mb2SLF4WMntQ1YCfm6YqKbL8S4B5W4',  // MEGA
    amount: '12000',
    triggerPrice: '0.000153',  // -50% from entry
    slippage: 0.15,  // Wider slippage for emergency exit
    label: 'MEGA SL -50%',
    expiry: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });

  // Show all orders
  console.log('\n3. Current orders:');
  const orders = lo.getOrders();
  orders.forEach(o => {
    console.log(`  ${o.id.slice(0, 12)}... | ${o.type} | $${o.triggerPrice} | ${o.status}`);
  });

  // Show stats
  console.log('\n4. Stats:');
  console.log(lo.getStats());

  // Start monitoring (in real use, this runs in background)
  console.log('\n5. Starting monitoring (30s interval)...');
  lo.startMonitoring(30000);

  // For demo, show what would happen
  console.log('\n=== Monitoring Active ===');
  console.log('Orders will execute automatically when price targets hit.');
  console.log('Press Ctrl+C to stop.\n');

  // Example cancellation after 10s
  setTimeout(() => {
    console.log('\n[Demo] Example: Cancelling first order...');
    try {
      lo.cancelOrder(tpOrder.id);
      console.log('[Demo] Order cancelled successfully');
    } catch (e) {
      console.error('[Demo] Cancel failed:', e.message);
    }
    
    console.log('\nFinal stats:');
    console.log(lo.getStats());
  }, 10000);
}

main().catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  lo.stopMonitoring();
  process.exit(0);
});
