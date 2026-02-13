#!/usr/bin/env node
/**
 * Limit Orders + Take Profit / Stop Loss Example
 * 
 * This example demonstrates:
 * 1. Creating take profit orders (sell when price goes up)
 * 2. Creating stop loss orders (sell when price goes down)
 * 3. Creating bracket orders (TP + SL as OCO pair)
 * 4. Monitoring and execution
 */

import { NullTrace, LimitOrders } from 'nulltrace-sdk';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// Configuration
const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY';
const SECRET_KEY = process.env.WALLET_SECRET; // Base58 private key
const TOKEN_CA = 'YOUR_TOKEN_MINT_ADDRESS_HERE';

async function main() {
  // Initialize wallet and SDK
  const keypair = Keypair.fromSecretKey(bs58.decode(SECRET_KEY));
  const wallet = NullTrace.fromKeypair(keypair);
  const nt = new NullTrace(RPC_URL, wallet);
  
  // Initialize Limit Orders manager
  const lo = new LimitOrders(nt, {
    ordersFile: './my-orders.json',
    checks: {
      requireLiquidity: true,
      minVolume24h: 10000,
    }
  });

  console.log('═══════════════════════════════════════════');
  console.log('  Limit Orders + TP/SL Example');
  console.log('═══════════════════════════════════════════\n');

  // Example 1: Simple Take Profit (+35%)
  console.log('EXAMPLE 1: Take Profit Order (+35%)');
  console.log('------------------------------------');
  
  const tpOrder = await lo.createTakeProfit({
    token: TOKEN_CA,
    amount: '10000',              // Sell 10,000 tokens
    entryPrice: '0.00030',        // Entry price
    gainPercent: 35,              // Trigger at +35%
    label: 'My Token +35% TP'
  });
  
  console.log('TP Order created:', tpOrder.id);
  console.log('Trigger price: $' + tpOrder.triggerPrice);
  console.log('');

  // Example 2: Simple Stop Loss (-15%)
  console.log('EXAMPLE 2: Stop Loss Order (-15%)');
  console.log('-----------------------------------');
  
  const slOrder = await lo.createStopLoss({
    token: TOKEN_CA,
    amount: '10000',              // Sell 10,000 tokens
    entryPrice: '0.00030',        // Entry price
    lossPercent: 15,              // Trigger at -15%
    label: 'My Token -15% SL'
  });
  
  console.log('SL Order created:', slOrder.id);
  console.log('Trigger price: $' + slOrder.triggerPrice);
  console.log('');

  // Example 3: Bracket Order (TP + SL as OCO pair)
  console.log('EXAMPLE 3: Bracket Order (OCO)');
  console.log('--------------------------------');
  console.log('Setting TP at +35% and SL at -15%');
  console.log('When one executes, the other auto-cancels\n');
  
  const { tpOrder: bracketTP, slOrder: bracketSL } = await lo.createBracketOrder({
    token: TOKEN_CA,
    amount: '10000',
    entryPrice: '0.00030',
    takeProfitPercent: 35,        // +35% TP
    stopLossPercent: 15,          // -15% SL
  });
  
  console.log('Bracket created:');
  console.log('  TP:', bracketTP.id, '@ +' + bracketTP.gainPercent + '%');
  console.log('  SL:', bracketSL.id, '@ -' + bracketSL.lossPercent + '%');
  console.log('');

  // Example 4: Manual price target (not % based)
  console.log('EXAMPLE 4: Manual Price Targets');
  console.log('---------------------------------');
  
  const manualTP = await lo.createTakeProfit({
    token: TOKEN_CA,
    amount: '5000',
    triggerPrice: '0.00050',      // Exact price target
    label: 'Manual TP @ $0.00050'
  });
  
  const manualSL = await lo.createStopLoss({
    token: TOKEN_CA,
    amount: '5000',
    triggerPrice: '0.00020',      // Exact price target
    label: 'Manual SL @ $0.00020'
  });
  
  console.log('Manual orders created');
  console.log('');

  // View all pending orders
  console.log('PENDING ORDERS:');
  console.log('---------------');
  const pending = lo.getOrders('PENDING');
  pending.forEach(order => {
    console.log(`  ${order.label}`);
    console.log(`    ID: ${order.id}`);
    console.log(`    Type: ${order.type}`);
    console.log(`    Trigger: $${order.triggerPrice}`);
    console.log('');
  });

  // Start monitoring (checks every 30 seconds)
  console.log('Starting order monitor...');
  console.log('Press Ctrl+C to stop\n');
  
  lo.startMonitoring(30000);
  
  // Display stats every minute
  setInterval(() => {
    const stats = lo.getStats();
    console.log(`[${new Date().toLocaleTimeString()}] Orders: ${stats.pending} pending, ${stats.executed} executed`);
  }, 60000);
}

main().catch(console.error);
