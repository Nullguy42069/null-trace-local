var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.js
var src_exports = {};
__export(src_exports, {
  LimitOrders: () => LimitOrders,
  NullTrace: () => NullTrace,
  default: () => src_default
});
module.exports = __toCommonJS(src_exports);
var import_web3 = require("@solana/web3.js");
var import_spl_token = require("@solana/spl-token");
var import_stateless = require("@lightprotocol/stateless.js");
var import_compressed_token = require("@lightprotocol/compressed-token");
var import_bs58 = __toESM(require("bs58"), 1);
var import_crypto = require("crypto");
var import_tweetnacl = __toESM(require("tweetnacl"), 1);

// src/limit-orders.js
var import_fs = require("fs");
var import_path = require("path");
var DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens";
var DEFAULT_CHECKS = {
  minVolume24h: 1e4,
  // $10k minimum
  maxSlippage: 0.15,
  // 15% max slippage
  requireLiquidity: true
};
var LimitOrders = class {
  constructor(nulltrace, options = {}) {
    this.nt = nulltrace;
    const defaultPath = (0, import_path.resolve)("./limit-orders.json");
    const customPath = options.ordersFile;
    if (customPath && (customPath.includes("..") || !customPath.endsWith(".json"))) {
      throw new Error("LimitOrders: Invalid ordersFile path");
    }
    this.ordersFile = customPath || defaultPath;
    this.checks = { ...DEFAULT_CHECKS, ...options.checks };
    this.monitoring = false;
    this.monitorInterval = null;
  }
  /**
   * Load orders from disk
   * @private
   */
  _loadOrders() {
    if (!(0, import_fs.existsSync)(this.ordersFile))
      return [];
    try {
      return JSON.parse((0, import_fs.readFileSync)(this.ordersFile, "utf8"));
    } catch {
      return [];
    }
  }
  /**
   * Save orders to disk
   * @private
   */
  _saveOrders(orders) {
    (0, import_fs.writeFileSync)(this.ordersFile, JSON.stringify(orders, null, 2));
  }
  /**
   * Get current price from DexScreener
   * @private
   */
  async _getPrice(tokenAddress) {
    try {
      const res = await fetch(`${DEXSCREENER_API}/${tokenAddress}`, {
        cache: "no-store",
        headers: { "Accept": "application/json" }
      });
      if (!res.ok)
        throw new Error(`Price fetch failed: ${res.status}`);
      const data = await res.json();
      const pair = data.pairs?.[0];
      if (!pair)
        throw new Error("No trading pair found");
      return {
        price: parseFloat(pair.priceUsd),
        volume24h: pair.volume?.h24 || 0,
        liquidity: pair.liquidity?.usd || 0,
        priceChange24h: pair.priceChange?.h24 || 0
      };
    } catch (err) {
      console.error(`[LimitOrders] Price fetch failed for ${tokenAddress}:`, err.message);
      return null;
    }
  }
  /**
   * Check if order conditions are met
   * @private
   */
  _shouldExecute(order, marketData) {
    const { price, volume24h, liquidity } = marketData;
    const trigger = parseFloat(order.triggerPrice);
    if (this.checks.requireLiquidity && volume24h < this.checks.minVolume24h) {
      console.log(`[LimitOrders] Skip ${order.id}: Low volume ($${volume24h.toFixed(0)})`);
      return false;
    }
    if (this.checks.requireLiquidity && liquidity < 1e4) {
      console.log(`[LimitOrders] Skip ${order.id}: Low liquidity ($${liquidity.toFixed(0)})`);
      return false;
    }
    if (order.type === "SELL_TP" && price >= trigger)
      return true;
    if (order.type === "SELL_SL" && price <= trigger)
      return true;
    if (order.type === "BUY" && price <= trigger)
      return true;
    return false;
  }
  /**
   * Create a new limit order
   * 
   * @param {Object} params
   * @param {'SELL_TP'|'SELL_SL'|'BUY'} params.type - Order type
   * @param {string} params.token - Token mint address
   * @param {string} params.amount - Amount to trade
   * @param {string} params.triggerPrice - Price to trigger at (in USD)
   * @param {number} [params.expiry] - Unix timestamp when order expires
   * @param {number} [params.slippage=0.1] - Max slippage (0.1 = 10%)
   * @param {string} [params.label] - Human-readable label
   * @returns {Object} Order details
   */
  async createLimitOrder(params) {
    return this._createOrder(params);
  }
  /**
   * Create a Take Profit order (sell when price goes UP)
   * 
   * @param {Object} params
   * @param {string} params.token - Token mint address
   * @param {string} params.amount - Amount to sell
   * @param {string} params.triggerPrice - Price to sell at (higher than current)
   * @param {number} [params.gainPercent] - Alternative: % gain from entry (e.g., 35 for +35%)
   * @param {number} [params.expiry] - Unix timestamp when order expires
   * @param {number} [params.slippage=0.1] - Max slippage
   * @param {string} [params.label] - Human-readable label
   * @returns {Object} Order details
   * 
   * @example
   * // Sell 10000 tokens when price hits $0.00040 (+33% from $0.00030)
   * await lo.createTakeProfit({
   *   token: 'F7Ci...',
   *   amount: '10000',
   *   triggerPrice: '0.00040',
   *   label: 'MEGA +33% TP'
   * });
   */
  async createTakeProfit(params) {
    const { token, amount, triggerPrice, gainPercent, entryPrice, ...rest } = params;
    let finalTriggerPrice = triggerPrice;
    if (gainPercent && entryPrice) {
      finalTriggerPrice = (parseFloat(entryPrice) * (1 + gainPercent / 100)).toString();
    }
    return this._createOrder({
      type: "SELL_TP",
      token,
      amount,
      triggerPrice: finalTriggerPrice,
      label: params.label || `TP ${gainPercent ? "+" + gainPercent + "%" : "@ $" + finalTriggerPrice}`,
      ...rest
    });
  }
  /**
   * Create a Stop Loss order (sell when price goes DOWN)
   * 
   * @param {Object} params
   * @param {string} params.token - Token mint address
   * @param {string} params.amount - Amount to sell
   * @param {string} params.triggerPrice - Price to sell at (lower than current)
   * @param {number} [params.lossPercent] - Alternative: % loss from entry (e.g., 15 for -15%)
   * @param {number} [params.expiry] - Unix timestamp when order expires
   * @param {number} [params.slippage=0.15] - Max slippage (default 15% for SL)
   * @param {string} [params.label] - Human-readable label
   * @returns {Object} Order details
   * 
   * @example
   * // Sell 10000 tokens when price drops to $0.00025 (-17% from $0.00030)
   * await lo.createStopLoss({
   *   token: 'F7Ci...',
   *   amount: '10000',
   *   triggerPrice: '0.00025',
   *   label: 'MEGA -17% SL'
   * });
   */
  async createStopLoss(params) {
    const { token, amount, triggerPrice, lossPercent, entryPrice, ...rest } = params;
    let finalTriggerPrice = triggerPrice;
    if (lossPercent && entryPrice) {
      finalTriggerPrice = (parseFloat(entryPrice) * (1 - lossPercent / 100)).toString();
    }
    return this._createOrder({
      type: "SELL_SL",
      token,
      amount,
      triggerPrice: finalTriggerPrice,
      slippage: params.slippage || 0.15,
      // Higher default slippage for SL
      label: params.label || `SL ${lossPercent ? "-" + lossPercent + "%" : "@ $" + finalTriggerPrice}`,
      ...rest
    });
  }
  /**
   * Create order with TP and SL as a pair (OCO - One Cancels Other)
   * 
   * @param {Object} params
   * @param {string} params.token - Token mint address
   * @param {string} params.amount - Amount to sell (same for both orders)
   * @param {string} params.entryPrice - Entry price for % calculations
   * @param {number} params.takeProfitPercent - % gain for TP (e.g., 35)
   * @param {number} params.stopLossPercent - % loss for SL (e.g., 15)
   * @returns {Object} { tpOrder, slOrder }
   * 
   * @example
   * // Set TP at +35% and SL at -15% from entry
   * await lo.createBracketOrder({
   *   token: 'F7Ci...',
   *   amount: '10000',
   *   entryPrice: '0.00030',
   *   takeProfitPercent: 35,
   *   stopLossPercent: 15
   * });
   */
  async createBracketOrder(params) {
    const { token, amount, entryPrice, takeProfitPercent, stopLossPercent, ...rest } = params;
    const tpOrder = await this.createTakeProfit({
      token,
      amount,
      entryPrice,
      gainPercent: takeProfitPercent,
      label: `TP +${takeProfitPercent}%`,
      ...rest
    });
    const slOrder = await this.createStopLoss({
      token,
      amount,
      entryPrice,
      lossPercent: stopLossPercent,
      label: `SL -${stopLossPercent}%`,
      ...rest
    });
    const orders = this._loadOrders();
    const tp = orders.find((o) => o.id === tpOrder.id);
    const sl = orders.find((o) => o.id === slOrder.id);
    if (tp && sl) {
      tp.linkedOrderId = slOrder.id;
      sl.linkedOrderId = tpOrder.id;
      this._saveOrders(orders);
    }
    console.log(`[LimitOrders] Created bracket order: TP +${takeProfitPercent}% / SL -${stopLossPercent}%`);
    return { tpOrder, slOrder };
  }
  /**
   * Internal: Create order (used by all public methods)
   * @private
   */
  async _createOrder(params) {
    const { type, token, amount, triggerPrice, expiry, slippage = 0.1, label } = params;
    if (!type || !token || !amount || !triggerPrice) {
      throw new Error("LimitOrders: type, token, amount, and triggerPrice are required");
    }
    const marketData = await this._getPrice(token);
    if (!marketData) {
      throw new Error("LimitOrders: Could not fetch token price data");
    }
    const orders = this._loadOrders();
    const order = {
      id: `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      token,
      amount: amount.toString(),
      triggerPrice: triggerPrice.toString(),
      entryPrice: marketData.price.toString(),
      expiry: expiry || Date.now() + 7 * 24 * 60 * 60 * 1e3,
      // Default 7 days
      slippage,
      label: label || `${type} ${amount} tokens at $${triggerPrice}`,
      status: "PENDING",
      createdAt: Date.now(),
      executedAt: null,
      txHash: null,
      error: null
    };
    orders.push(order);
    this._saveOrders(orders);
    console.log(`[LimitOrders] Created ${type} order ${order.id}`);
    console.log(`  Token: ${token.slice(0, 12)}...`);
    console.log(`  Trigger: $${triggerPrice} | Current: $${marketData.price.toFixed(6)}`);
    console.log(`  Distance: ${((parseFloat(triggerPrice) / marketData.price - 1) * 100).toFixed(1)}%`);
    return order;
  }
  /**
   * Get all orders (optionally filtered by status)
   * @param {'PENDING'|'EXECUTED'|'FAILED'|'EXPIRED'} [status]
   */
  getOrders(status = null) {
    const orders = this._loadOrders();
    if (status)
      return orders.filter((o) => o.status === status);
    return orders;
  }
  /**
   * Cancel a pending order
   * @param {string} orderId
   */
  cancelOrder(orderId) {
    const orders = this._loadOrders();
    const index = orders.findIndex((o) => o.id === orderId && o.status === "PENDING");
    if (index === -1) {
      throw new Error(`LimitOrders: Order ${orderId} not found or not pending`);
    }
    orders[index].status = "CANCELLED";
    orders[index].cancelledAt = Date.now();
    this._saveOrders(orders);
    console.log(`[LimitOrders] Cancelled order ${orderId}`);
    return orders[index];
  }
  /**
   * Check and execute pending orders
   * @private
   */
  async _checkOrders() {
    const orders = this._loadOrders();
    const pending = orders.filter((o) => o.status === "PENDING" && o.expiry > Date.now());
    if (pending.length === 0)
      return;
    console.log(`[LimitOrders] Checking ${pending.length} pending orders...`);
    for (const order of pending) {
      try {
        const marketData = await this._getPrice(order.token);
        if (!marketData)
          continue;
        if (!this._shouldExecute(order, marketData))
          continue;
        console.log(`[LimitOrders] \u{1F6A8} TRIGGERED: ${order.label}`);
        console.log(`  Current: $${marketData.price.toFixed(6)} | Target: $${order.triggerPrice}`);
        const result = await this._executeOrder(order);
        order.status = result.success ? "EXECUTED" : "FAILED";
        order.executedAt = Date.now();
        order.txHash = result.txHash || null;
        order.error = result.error || null;
        order.executionPrice = marketData.price.toString();
        this._saveOrders(orders);
        if (result.success) {
          console.log(`[LimitOrders] \u2705 EXECUTED: ${order.id}`);
          console.log(`  TX: ${result.txHash}`);
          if (order.linkedOrderId) {
            const linkedOrder = orders.find((o) => o.id === order.linkedOrderId && o.status === "PENDING");
            if (linkedOrder) {
              linkedOrder.status = "CANCELLED";
              linkedOrder.cancelledAt = Date.now();
              linkedOrder.cancellationReason = `Linked order ${order.id} executed (OCO)`;
              console.log(`[LimitOrders] Cancelled linked order ${linkedOrder.id} (OCO)`);
              this._saveOrders(orders);
            }
          }
        } else {
          console.error(`[LimitOrders] \u274C FAILED: ${order.id}`);
          console.error(`  Error: ${result.error}`);
        }
      } catch (err) {
        console.error(`[LimitOrders] Error checking order ${order.id}:`, err.message);
        order.status = "FAILED";
        order.error = err.message;
        this._saveOrders(orders);
      }
    }
    const expired = orders.filter((o) => o.status === "PENDING" && o.expiry <= Date.now());
    for (const order of expired) {
      order.status = "EXPIRED";
      console.log(`[LimitOrders] Order ${order.id} expired`);
    }
    if (expired.length > 0)
      this._saveOrders(orders);
  }
  /**
   * Execute a triggered order
   * @private
   */
  async _executeOrder(order) {
    const SOL = "So11111111111111111111111111111111111111112";
    try {
      const fromMint = order.type.startsWith("SELL") ? order.token : SOL;
      const toMint = order.type.startsWith("SELL") ? SOL : order.token;
      console.log(`[LimitOrders] Executing swap: ${order.amount} ${fromMint.slice(0, 8)} -> ${toMint.slice(0, 8)}`);
      const result = await this.nt.swap(fromMint, toMint, order.amount, {
        slippage: order.slippage,
        timeout: 12e4,
        onStatusChange: (status) => console.log(`[LimitOrders] Swap status: ${status}`)
      });
      return {
        success: result.status === "completed",
        txHash: result.result?.txHash || result.result,
        result
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }
  /**
   * Start monitoring loop
   * @param {number} intervalMs - Check interval in milliseconds (default: 30000)
   */
  startMonitoring(intervalMs = 3e4) {
    if (this.monitoring) {
      console.log("[LimitOrders] Already monitoring");
      return;
    }
    this.monitoring = true;
    console.log(`[LimitOrders] Started monitoring (interval: ${intervalMs}ms)`);
    this._checkOrders();
    this.monitorInterval = setInterval(() => {
      this._checkOrders();
    }, intervalMs);
  }
  /**
   * Stop monitoring loop
   */
  stopMonitoring() {
    if (!this.monitoring)
      return;
    clearInterval(this.monitorInterval);
    this.monitoring = false;
    this.monitorInterval = null;
    console.log("[LimitOrders] Stopped monitoring");
  }
  /**
   * Get summary statistics
   */
  getStats() {
    const orders = this._loadOrders();
    return {
      total: orders.length,
      pending: orders.filter((o) => o.status === "PENDING").length,
      executed: orders.filter((o) => o.status === "EXECUTED").length,
      failed: orders.filter((o) => o.status === "FAILED").length,
      expired: orders.filter((o) => o.status === "EXPIRED").length,
      cancelled: orders.filter((o) => o.status === "CANCELLED").length,
      monitoring: this.monitoring
    };
  }
};

// src/index.js
var OPERATOR_KEY = "5STUuhrL8kJ4up9spEY39VJ6ibQCFrg8x8cRV5UeEcfv";
var OPERATOR_PUBLIC_KEY = new import_web3.PublicKey(OPERATOR_KEY);
var ALT_ADDRESS = new import_web3.PublicKey("9NYFyEqPkyXUhkerbGHXUXkvb4qpzeEdHuGpgbgpH1NJ");
var REMOTE_OPERATOR_URL = "http://34.68.76.183:3333";
var SHARED_SECRET = "NULL_TRACE_OPERATOR_SECRET_BASE_V1";
var FEE_BPS = 1e-3;
var COMPUTE_UNITS = 14e5;
var COMPUTE_PRICE = 5e3;
var MAX_TX_SIZE = 1232;
function _getAuthToken() {
  const step = 180;
  const counter = Math.floor(Date.now() / 1e3 / step);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 4294967296), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = (0, import_crypto.createHmac)("sha1", Buffer.from(SHARED_SECRET, "ascii"));
  hmac.update(buf);
  const hash = hmac.digest();
  const offset = hash[hash.length - 1] & 15;
  const code = (hash[offset] & 127) << 24 | (hash[offset + 1] & 255) << 16 | (hash[offset + 2] & 255) << 8 | hash[offset + 3] & 255;
  return (code % 1e6).toString().padStart(6, "0");
}
function _validateHeliusRpc(url) {
  if (!url || typeof url !== "string") {
    throw new Error("NullTrace: Valid Helius rpcUrl is required");
  }
  const lower = url.toLowerCase();
  if (!lower.includes("helius")) {
    throw new Error(
      "NullTrace: A Helius RPC endpoint is required. Get a key at https://helius.dev"
    );
  }
  return url;
}
function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function _getMintInfo(connection, mintAddress) {
  if (mintAddress === import_spl_token.NATIVE_MINT.toBase58()) {
    return { decimals: 9, tokenProgram: import_spl_token.TOKEN_PROGRAM_ID };
  }
  const mintInfo = await connection.getParsedAccountInfo(new import_web3.PublicKey(mintAddress));
  if (!mintInfo.value)
    throw new Error(`Mint not found: ${mintAddress}`);
  return {
    decimals: mintInfo.value.data.parsed.info.decimals,
    tokenProgram: new import_web3.PublicKey(mintInfo.value.owner)
  };
}
async function _getCompressedAccounts(connection, owner, mint, isSOL) {
  const accounts = isSOL ? await connection.getCompressedAccountsByOwner(owner) : await connection.getCompressedTokenAccountsByOwner(owner, { mint: new import_web3.PublicKey(mint) });
  return accounts.items.sort((a, b) => {
    const aAmt = isSOL ? a.lamports : a.parsed.amount;
    const bAmt = isSOL ? b.lamports : b.parsed.amount;
    return Number(bAmt) - Number(aAmt);
  });
}
function _selectInputs(sortedAccounts, amountLamports, isSOL) {
  const selected = [];
  let total = 0;
  for (const a of sortedAccounts) {
    if (total >= amountLamports)
      break;
    total += Number(isSOL ? a.lamports : a.parsed.amount);
    selected.push(a);
  }
  return { selected, total };
}
function _batchAccounts(accounts) {
  const validSizes = [8, 4, 2, 1];
  const batches = [];
  let remaining = [...accounts];
  while (remaining.length > 0) {
    const size = validSizes.find((s) => remaining.length >= s) || 1;
    batches.push(remaining.slice(0, size));
    remaining = remaining.slice(size);
  }
  return batches;
}
async function _packTransactions(connection, payer, instructions, adl) {
  const { blockhash } = await connection.getLatestBlockhash();
  const computeIxs = [
    import_web3.ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
    import_web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_PRICE })
  ];
  let current = [...computeIxs];
  const messages = [];
  for (const ix of instructions) {
    try {
      current.push(ix);
      const msg = new import_web3.TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash,
        instructions: current
      }).compileToV0Message([adl]);
      if (msg.serialize().length > MAX_TX_SIZE)
        throw new Error("oversize");
    } catch {
      current.pop();
      if (current.length > computeIxs.length) {
        messages.push(
          new import_web3.TransactionMessage({
            payerKey: payer,
            recentBlockhash: blockhash,
            instructions: current
          }).compileToV0Message([adl])
        );
      }
      current = [...computeIxs, ix];
    }
  }
  if (current.length > computeIxs.length) {
    messages.push(
      new import_web3.TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash,
        instructions: current
      }).compileToV0Message([adl])
    );
  }
  return messages.map((m) => new import_web3.VersionedTransaction(m));
}
async function _signSendConfirm(connection, wallet, transactions) {
  const signed = await wallet.signAllTransactions(transactions);
  const sigs = [];
  for (const tx of signed) {
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig);
    sigs.push(sig);
  }
  return sigs;
}
async function _enrichMetadata(tokenBalances) {
  if (!tokenBalances.length)
    return tokenBalances;
  const addresses = tokenBalances.map((t) => t.address).join(",");
  try {
    const dexRes = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + addresses);
    if (dexRes.ok) {
      const data = await dexRes.json();
      if (data.pairs) {
        const pairs = data.pairs.sort(
          (a, b) => parseFloat(b.volume?.h24 ?? "0") - parseFloat(a.volume?.h24 ?? "0")
        );
        for (const t of tokenBalances) {
          const pair = pairs.find((p) => p.baseToken.address === t.address);
          if (pair) {
            t.symbol = t.symbol || pair.baseToken.symbol;
            t.name = t.name || pair.baseToken.name;
            t.logo = t.logo || (pair.info?.imageUrl ?? "");
            t.dexscreener = t.dexscreener || (pair.url ?? "");
          }
        }
      }
    }
  } catch {
  }
  try {
    const geckoRes = await fetch(
      "https://api.geckoterminal.com/api/v2/networks/solana/tokens/multi/" + addresses + "?include=top_pools"
    );
    if (geckoRes.ok) {
      const data = await geckoRes.json();
      if (data.data) {
        for (const t of tokenBalances) {
          const gt = Object.values(data.data).find((x) => x.attributes?.address === t.address);
          if (gt) {
            t.symbol = t.symbol || gt.attributes.symbol;
            t.name = t.name || gt.attributes.name;
            t.logo = t.logo || gt.attributes.image_url;
            t.decimals = t.decimals || gt.attributes.decimals;
            if (t.decimals)
              t.amount = (t.lamports / 10 ** t.decimals).toFixed(t.decimals);
          }
        }
      }
    }
  } catch {
  }
  try {
    const jupRes = await fetch(
      "https://datapi.jup.ag/v1/assets/search?query=" + addresses + "&sortBy=verified"
    );
    if (jupRes.ok) {
      const tokens = await jupRes.json();
      if (tokens) {
        for (const t of tokenBalances) {
          const jt = tokens.find((x) => x.id === t.address);
          if (jt) {
            t.symbol = t.symbol || jt.symbol;
            t.name = t.name || jt.name;
            t.logo = t.logo || jt.icon;
            t.decimals = t.decimals || jt.decimals;
            if (t.decimals)
              t.amount = (t.lamports / 10 ** t.decimals).toFixed(t.decimals);
          }
        }
      }
    }
  } catch {
  }
  return tokenBalances;
}
var NullTrace = class _NullTrace {
  /**
   * Create a standalone NullTrace client.
   *
   * The second argument can be any of the following:
   *
   * 1. **Wallet adapter** — an object with `publicKey`, `signAllTransactions`, and optionally `signMessage`.
   * 2. **Keypair** — a `@solana/web3.js` Keypair instance.
   * 3. **Secret key (Uint8Array)** — a 64-byte secret key array.
   * 4. **Private key (base58 string)** — a base58-encoded private key.
   *
   * @param {string} rpcUrl  A Helius RPC endpoint (required for ZK compression).
   * @param {Object|Keypair|Uint8Array|string} walletOrKey  Wallet adapter, Keypair, secret key bytes, or base58 private key.
   *
   * @example
   * // Wallet adapter (browser)
   * const nt = new NullTrace(rpcUrl, wallet);
   *
   * @example
   * // Keypair (Node.js)
   * const nt = new NullTrace(rpcUrl, Keypair.fromSecretKey(secretKey));
   *
   * @example
   * // Raw secret key bytes
   * const nt = new NullTrace(rpcUrl, mySecretKeyUint8Array);
   *
   * @example
   * // Base58 private key string
   * const nt = new NullTrace(rpcUrl, '4wBqp...');
   */
  constructor(rpcUrl, walletOrKey) {
    _validateHeliusRpc(rpcUrl);
    if (!walletOrKey)
      throw new Error("NullTrace: a wallet, Keypair, secret key, or private key string is required");
    this.rpcUrl = rpcUrl;
    this.wallet = _NullTrace._resolveWallet(walletOrKey);
    this.connection = (0, import_stateless.createRpc)(rpcUrl, rpcUrl, rpcUrl, { commitment: "processed" });
    this.sendConnection = new import_web3.Connection(rpcUrl, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 6e4
    });
    this._adlCache = null;
    this._sigCache = null;
  }
  // -----------------------------------------------------------------------
  // Static helpers for wallet resolution
  // -----------------------------------------------------------------------
  /**
   * Create a wallet adapter interface from a Keypair.
   *
   * @param {Keypair} keypair  A `@solana/web3.js` Keypair.
   * @returns {{ publicKey: PublicKey, signAllTransactions: Function, signMessage: Function }}
   */
  static fromKeypair(keypair) {
    if (!keypair?.publicKey || !keypair?.secretKey) {
      throw new Error("NullTrace.fromKeypair: invalid Keypair");
    }
    return {
      publicKey: keypair.publicKey,
      signAllTransactions: async (txs) => {
        for (const tx of txs)
          tx.sign([keypair]);
        return txs;
      },
      signMessage: async (msg) => import_tweetnacl.default.sign.detached(msg, keypair.secretKey)
    };
  }
  /**
   * Create a wallet adapter interface from a raw secret key (64 bytes).
   *
   * @param {Uint8Array} secretKey  A 64-byte Ed25519 secret key.
   * @returns {{ publicKey: PublicKey, signAllTransactions: Function, signMessage: Function }}
   */
  static fromSecretKey(secretKey) {
    if (!(secretKey instanceof Uint8Array) || secretKey.length !== 64) {
      throw new Error("NullTrace.fromSecretKey: expected a 64-byte Uint8Array");
    }
    return _NullTrace.fromKeypair(import_web3.Keypair.fromSecretKey(secretKey));
  }
  /**
   * Create a wallet adapter interface from a base58-encoded private key string.
   *
   * @param {string} base58Key  A base58-encoded private key (as exported by Phantom, Solflare, etc.).
   * @returns {{ publicKey: PublicKey, signAllTransactions: Function, signMessage: Function }}
   */
  static fromPrivateKey(base58Key) {
    if (typeof base58Key !== "string" || base58Key.length < 32) {
      throw new Error("NullTrace.fromPrivateKey: expected a base58-encoded private key string");
    }
    const decoded = import_bs58.default.decode(base58Key);
    return _NullTrace.fromKeypair(import_web3.Keypair.fromSecretKey(decoded));
  }
  /**
   * @internal Resolve any supported wallet input into a wallet adapter interface.
   */
  static _resolveWallet(input) {
    if (input?.publicKey && typeof input.signAllTransactions === "function") {
      return input;
    }
    if (input instanceof import_web3.Keypair) {
      return _NullTrace.fromKeypair(input);
    }
    if (input instanceof Uint8Array && input.length === 64) {
      return _NullTrace.fromSecretKey(input);
    }
    if (typeof input === "string") {
      return _NullTrace.fromPrivateKey(input);
    }
    throw new Error(
      "NullTrace: unsupported wallet type. Provide a wallet adapter, Keypair, 64-byte Uint8Array, or base58 private key string."
    );
  }
  /** @internal Get the address lookup table (cached). */
  async _getAlt() {
    if (this._adlCache)
      return this._adlCache;
    const result = await this.connection.getAddressLookupTable(ALT_ADDRESS);
    this._adlCache = result.value;
    return this._adlCache;
  }
  // -----------------------------------------------------------------------
  // Nullify  (public -> private)
  // -----------------------------------------------------------------------
  /**
   * Convert public tokens into private ZK-compressed state.
   *
   * @param {string} mint   Token mint address (use NATIVE_MINT for SOL).
   * @param {string} amount Human-readable amount (e.g. "1.5").
   * @returns {Promise<string[]>} Transaction signatures.
   *
   * @example
   * const sigs = await nt.nullify('So11111111111111111111111111111111111111112', '0.5');
   */
  async nullify(mint, amount) {
    if (!mint || !amount)
      throw new Error("NullTrace.nullify: mint and amount are required");
    const owner = this.wallet.publicKey;
    const isSOL = mint === import_spl_token.NATIVE_MINT.toBase58();
    const { decimals, tokenProgram } = await _getMintInfo(this.connection, mint);
    const amountLamports = (0, import_stateless.bn)(Math.floor(parseFloat(amount) * 10 ** decimals).toString());
    const feeLamports = (0, import_stateless.bn)(Math.floor(parseInt(amountLamports.toString()) * FEE_BPS).toString());
    const ixs = [];
    const activeStateTrees = await this.connection.getStateTreeInfos();
    const tree = (0, import_stateless.selectStateTreeInfo)(activeStateTrees);
    if (isSOL) {
      ixs.push(
        await import_stateless.LightSystemProgram.compress({
          payer: owner,
          toAddress: owner,
          lamports: amountLamports.sub(feeLamports),
          outputStateTreeInfo: tree
        }),
        await import_stateless.LightSystemProgram.compress({
          payer: owner,
          toAddress: OPERATOR_PUBLIC_KEY,
          lamports: feeLamports,
          outputStateTreeInfo: tree
        })
      );
    } else {
      const mintPk = new import_web3.PublicKey(mint);
      const sourceAta = await (0, import_spl_token.getAssociatedTokenAddress)(mintPk, owner, false, tokenProgram);
      const [tokenPoolPda] = import_web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), mintPk.toBuffer()],
        import_stateless.COMPRESSED_TOKEN_PROGRAM_ID
      );
      const poolInfo = await this.connection.getAccountInfo(tokenPoolPda);
      if (!poolInfo) {
        ixs.push(
          await import_compressed_token.CompressedTokenProgram.createTokenPool({
            feePayer: owner,
            mint: mintPk,
            tokenProgramId: tokenProgram
          })
        );
      }
      ixs.push(
        await import_compressed_token.CompressedTokenProgram.compress({
          payer: owner,
          owner,
          source: sourceAta,
          toAddress: [owner, OPERATOR_PUBLIC_KEY],
          amount: [amountLamports.sub(feeLamports), feeLamports],
          mint: mintPk,
          outputStateTreeInfo: tree,
          tokenPoolInfo: {
            tokenPoolPda,
            tokenProgram,
            isInitialized: true,
            balance: (0, import_stateless.bn)("0"),
            poolIndex: 0,
            mint: mintPk
          }
        })
      );
    }
    const adl = await this._getAlt();
    const txs = await _packTransactions(this.connection, owner, ixs, adl);
    return _signSendConfirm(this.connection, this.wallet, txs);
  }
  // -----------------------------------------------------------------------
  // Reveal  (private -> public)
  // -----------------------------------------------------------------------
  /**
   * Decompress private tokens back to public state.
   *
   * @param {string} mint   Token mint address.
   * @param {string} amount Human-readable amount.
   * @returns {Promise<string[]>} Transaction signatures.
   *
   * @example
   * const sigs = await nt.reveal('So11111111111111111111111111111111111111112', '0.5');
   */
  async reveal(mint, amount) {
    if (!mint || !amount)
      throw new Error("NullTrace.reveal: mint and amount are required");
    const owner = this.wallet.publicKey;
    const isSOL = mint === import_spl_token.NATIVE_MINT.toBase58();
    const { decimals, tokenProgram } = await _getMintInfo(this.connection, mint);
    const amountLamports = Math.floor(parseFloat(amount) * 10 ** decimals);
    const sorted = await _getCompressedAccounts(this.connection, owner, mint, isSOL);
    const { selected, total } = _selectInputs(sorted, amountLamports, isSOL);
    if (total < amountLamports)
      throw new Error("Insufficient private balance");
    const batches = _batchAccounts(selected);
    const ixs = [];
    let selectedTokenPoolInfos;
    let destinationAta;
    if (!isSOL) {
      const tokenPoolInfos = await (0, import_compressed_token.getTokenPoolInfos)(this.connection, new import_web3.PublicKey(mint));
      selectedTokenPoolInfos = (0, import_compressed_token.selectTokenPoolInfosForDecompression)(tokenPoolInfos, amountLamports);
      destinationAta = await (0, import_spl_token.getAssociatedTokenAddress)(new import_web3.PublicKey(mint), owner, false, tokenProgram);
      const info = await this.connection.getAccountInfo(destinationAta);
      if (!info) {
        ixs.push((0, import_spl_token.createAssociatedTokenAccountInstruction)(owner, destinationAta, owner, new import_web3.PublicKey(mint), tokenProgram));
      }
    }
    let remaining = amountLamports;
    for (const batch of batches) {
      const proof = await this.connection.getValidityProofV0(
        batch.map((a) => ({
          hash: a.hash ?? a.compressedAccount?.hash,
          tree: a.treeInfo?.tree ?? a.compressedAccount?.treeInfo?.tree,
          queue: a.treeInfo?.queue ?? a.compressedAccount?.treeInfo?.queue
        }))
      );
      const batchAmount = decimals === 0 ? 1 : Math.min(remaining, batch.reduce((s, a) => s + Number(isSOL ? a.lamports : a.parsed.amount), 0));
      ixs.push(
        await (isSOL ? import_stateless.LightSystemProgram.decompress({
          payer: owner,
          inputCompressedAccounts: batch,
          toAddress: owner,
          lamports: (0, import_stateless.bn)(batchAmount.toString()),
          recentInputStateRootIndices: proof.rootIndices,
          recentValidityProof: proof.compressedProof
        }) : import_compressed_token.CompressedTokenProgram.decompress({
          payer: owner,
          inputCompressedTokenAccounts: batch,
          toAddress: destinationAta,
          amount: (0, import_stateless.bn)(batchAmount.toString()),
          recentInputStateRootIndices: proof.rootIndices,
          recentValidityProof: proof.compressedProof,
          tokenPoolInfos: selectedTokenPoolInfos
        }))
      );
      remaining -= batchAmount;
    }
    const adl = await this._getAlt();
    const txs = await _packTransactions(this.connection, owner, ixs, adl);
    return _signSendConfirm(this.connection, this.wallet, txs);
  }
  // -----------------------------------------------------------------------
  // Transfer  (private -> private)
  // -----------------------------------------------------------------------
  /**
   * Send compressed tokens privately to another Solana address.
   *
   * @param {string} mint      Token mint address.
   * @param {string} amount    Human-readable amount.
   * @param {string} recipient Recipient's Solana public key.
   * @returns {Promise<string[]>} Transaction signatures.
   *
   * @example
   * const sigs = await nt.transfer('So11...', '1.0', 'Recip1ent...');
   */
  async transfer(mint, amount, recipient) {
    if (!mint || !amount || !recipient) {
      throw new Error("NullTrace.transfer: mint, amount, and recipient are required");
    }
    const owner = this.wallet.publicKey;
    const recipientPk = new import_web3.PublicKey(recipient);
    const isSOL = mint === import_spl_token.NATIVE_MINT.toBase58();
    const { decimals, tokenProgram } = await _getMintInfo(this.connection, mint);
    const amountLamports = Math.floor(parseFloat(amount) * 10 ** decimals);
    const sorted = await _getCompressedAccounts(this.connection, owner, mint, isSOL);
    const { selected, total } = _selectInputs(sorted, amountLamports, isSOL);
    const { blockhash } = await this.connection.getLatestBlockhash();
    const adl = await this._getAlt();
    const preTransactions = [];
    if (total < amountLamports) {
      const deficit = amountLamports - total;
      const fee = (0, import_stateless.bn)(Math.floor(deficit * FEE_BPS).toString());
      const trees = await this.connection.getStateTreeInfos();
      const tree = (0, import_stateless.selectStateTreeInfo)(trees);
      if (isSOL) {
        const solBal = await this.connection.getBalance(owner);
        if (solBal < deficit + 1e5)
          throw new Error("Insufficient balance");
        const compressIx = await import_stateless.LightSystemProgram.compress({
          payer: owner,
          toAddress: recipientPk,
          lamports: (0, import_stateless.bn)(deficit.toString()).sub(fee),
          outputStateTreeInfo: tree
        });
        const feeIx = await import_stateless.LightSystemProgram.compress({
          payer: owner,
          toAddress: OPERATOR_PUBLIC_KEY,
          lamports: fee,
          outputStateTreeInfo: tree
        });
        const msg = new import_web3.TransactionMessage({
          payerKey: owner,
          recentBlockhash: blockhash,
          instructions: [
            import_web3.ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
            import_web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_PRICE }),
            compressIx,
            feeIx
          ]
        }).compileToV0Message([adl]);
        preTransactions.push(new import_web3.VersionedTransaction(msg));
      } else {
        let instructions = [
          import_web3.ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
          import_web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_PRICE })
        ];
        const sourceAta = await (0, import_spl_token.getAssociatedTokenAddress)(
          new import_web3.PublicKey(mint),
          owner,
          false,
          tokenProgram
        );
        const tokenAccountInfos = await this.connection.getParsedTokenAccountsByOwner(
          owner,
          { programId: tokenProgram, mint: new import_web3.PublicKey(mint) },
          "processed"
        );
        const publicBalance = tokenAccountInfos.value?.[0].account.data.parsed.info.tokenAmount.amount ?? 0;
        if (publicBalance < deficit)
          throw new Error("Insufficient balance");
        const [tokenPoolPda] = import_web3.PublicKey.findProgramAddressSync(
          [Buffer.from("pool"), new import_web3.PublicKey(mint).toBuffer()],
          import_stateless.COMPRESSED_TOKEN_PROGRAM_ID
        );
        const tokenPoolInfo = await this.connection.getAccountInfo(tokenPoolPda, "processed");
        if (!tokenPoolInfo) {
          const createTokenPoolIx = await import_compressed_token.CompressedTokenProgram.createTokenPool({
            feePayer: owner,
            mint: new import_web3.PublicKey(mint),
            tokenProgramId: tokenProgram
          });
          instructions.push(createTokenPoolIx);
        }
        const compressInstruction = await import_compressed_token.CompressedTokenProgram.compress({
          payer: owner,
          owner,
          source: sourceAta,
          toAddress: [recipientPk, OPERATOR_PUBLIC_KEY],
          amount: [(0, import_stateless.bn)(deficit.toString()).sub(fee), fee],
          mint: new import_web3.PublicKey(mint),
          outputStateTreeInfo: tree,
          tokenPoolInfo: {
            tokenPoolPda,
            tokenProgram,
            isInitialized: true,
            balance: (0, import_stateless.bn)("0"),
            poolIndex: 0,
            mint: new import_web3.PublicKey(mint)
          }
        });
        instructions.push(compressInstruction);
        let tx = new import_web3.VersionedTransaction(new import_web3.TransactionMessage({
          payerKey: owner,
          recentBlockhash: blockhash,
          instructions
        }).compileToV0Message([adl]));
        preTransactions.push(tx);
      }
    }
    if (total < amountLamports && preTransactions.length === 0) {
      throw new Error("Insufficient balance");
    }
    const batches = _batchAccounts(selected);
    let remaining = amountLamports;
    const ixs = [];
    for (const batch of batches) {
      const proof = await this.connection.getValidityProofV0(
        batch.map((a) => ({
          hash: a.hash ?? a.compressedAccount?.hash,
          tree: a.treeInfo?.tree ?? a.compressedAccount?.treeInfo?.tree,
          queue: a.treeInfo?.queue ?? a.compressedAccount?.treeInfo?.queue
        }))
      );
      const batchAmount = decimals === 0 ? 1 : Math.min(remaining, batch.reduce((s, a) => s + Number(isSOL ? a.lamports : a.parsed.amount), 0));
      ixs.push(
        await (isSOL ? import_stateless.LightSystemProgram.transfer({
          payer: owner,
          inputCompressedAccounts: batch,
          toAddress: recipientPk,
          lamports: (0, import_stateless.bn)(batchAmount.toString()),
          recentInputStateRootIndices: proof.rootIndices,
          recentValidityProof: proof.compressedProof
        }) : import_compressed_token.CompressedTokenProgram.transfer({
          payer: owner,
          inputCompressedTokenAccounts: batch,
          toAddress: recipientPk,
          amount: (0, import_stateless.bn)(batchAmount.toString()),
          recentInputStateRootIndices: proof.rootIndices,
          recentValidityProof: proof.compressedProof
        }))
      );
      remaining -= batchAmount;
    }
    const txs = await _packTransactions(this.connection, owner, ixs, adl);
    const allTxs = [...preTransactions, ...txs];
    return _signSendConfirm(this.connection, this.wallet, allTxs);
  }
  // -----------------------------------------------------------------------
  // Swap  (private swap via operator)
  // -----------------------------------------------------------------------
  /**
   * Get a swap quote. No signing required.
   *
   * @param {string} inputMint   Input token mint.
   * @param {string} outputMint  Output token mint.
   * @param {string} amount      Human-readable input amount.
   * @returns {Promise<{inAmount: string, outAmount: string, priceImpact: number}>}
   *
   * @example
   * const quote = await nt.quoteSwap('So11...', 'Es9v...', '1.0');
   */
  async quoteSwap(inputMint, outputMint, amount) {
    if (!inputMint || !outputMint || !amount) {
      throw new Error("NullTrace.quoteSwap: inputMint, outputMint, and amount are required");
    }
    const { decimals } = await _getMintInfo(this.connection, inputMint);
    const amountLamports = Math.floor(parseFloat(amount) * 10 ** decimals);
    const res = await fetch(`${REMOTE_OPERATOR_URL}/operator/quote-swap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-null-client-secret": _getAuthToken()
      },
      body: JSON.stringify({ inputMint, outputMint, amount: amountLamports })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Quote failed: ${res.status}`);
    }
    return res.json();
  }
  /**
   * Execute a private swap via the NullTrace operator.
   *
   * @param {string} fromMint  Input token mint.
   * @param {string} toMint    Output token mint.
   * @param {string} amount    Human-readable input amount.
   * @param {Object} [options]
   * @param {(status: string) => void} [options.onStatusChange]
   * @param {number} [options.timeout=120000]
   * @returns {Promise<{status: string, result: Object}>}
   *
   * @example
   * const result = await nt.swap('So11...', 'Es9v...', '1.0');
   */
  async swap(fromMint, toMint, amount, options = {}) {
    if (!fromMint || !toMint || !amount) {
      throw new Error("NullTrace.swap: fromMint, toMint, and amount are required");
    }
    const { onStatusChange, timeout = 12e4 } = options;
    const owner = this.wallet.publicKey;
    const isSOL = fromMint === import_spl_token.NATIVE_MINT.toBase58();
    const { decimals, tokenProgram } = await _getMintInfo(this.connection, fromMint);
    const amountLamports = Math.floor(parseFloat(amount) * 10 ** decimals);
    const sorted = await _getCompressedAccounts(this.connection, owner, fromMint, isSOL);
    const { selected, total } = _selectInputs(sorted, amountLamports, isSOL);
    const { blockhash } = await this.connection.getLatestBlockhash();
    const adl = await this._getAlt();
    const preTransactions = [];
    if (total < amountLamports) {
      const deficit = amountLamports - total;
      const fee = (0, import_stateless.bn)(Math.floor(deficit * FEE_BPS).toString());
      const trees = await this.connection.getStateTreeInfos();
      const tree = (0, import_stateless.selectStateTreeInfo)(trees);
      if (isSOL) {
        const solBal = await this.connection.getBalance(owner);
        if (solBal < deficit + 1e5)
          throw new Error("Insufficient balance");
        const compressIx = await import_stateless.LightSystemProgram.compress({
          payer: owner,
          toAddress: OPERATOR_PUBLIC_KEY,
          lamports: (0, import_stateless.bn)(deficit.toString()),
          outputStateTreeInfo: tree
        });
        const msg = new import_web3.TransactionMessage({
          payerKey: owner,
          recentBlockhash: blockhash,
          instructions: [
            import_web3.ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
            import_web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_PRICE }),
            compressIx
          ]
        }).compileToV0Message([adl]);
        preTransactions.push(new import_web3.VersionedTransaction(msg));
      } else {
        let instructions = [
          import_web3.ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
          import_web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_PRICE })
        ];
        const sourceAta = await (0, import_spl_token.getAssociatedTokenAddress)(
          new import_web3.PublicKey(fromMint),
          owner,
          false,
          tokenProgram
        );
        const tokenAccountInfos = await this.connection.getParsedTokenAccountsByOwner(
          owner,
          { programId: tokenProgram, mint: new import_web3.PublicKey(fromMint) },
          "processed"
        );
        const publicBalance = tokenAccountInfos.value?.[0].account.data.parsed.info.tokenAmount.amount ?? 0;
        if (publicBalance < deficit)
          throw new Error("Insufficient balance");
        const [tokenPoolPda] = import_web3.PublicKey.findProgramAddressSync(
          [Buffer.from("pool"), new import_web3.PublicKey(fromMint).toBuffer()],
          import_stateless.COMPRESSED_TOKEN_PROGRAM_ID
        );
        const tokenPoolInfo = await this.connection.getAccountInfo(tokenPoolPda, "processed");
        if (!tokenPoolInfo) {
          const createTokenPoolIx = await import_compressed_token.CompressedTokenProgram.createTokenPool({
            feePayer: owner,
            mint: new import_web3.PublicKey(fromMint),
            tokenProgramId: tokenProgram
          });
          instructions.push(createTokenPoolIx);
        }
        const compressInstruction = await import_compressed_token.CompressedTokenProgram.compress({
          payer: owner,
          owner,
          source: sourceAta,
          toAddress: OPERATOR_PUBLIC_KEY,
          amount: (0, import_stateless.bn)(deficit.toString()),
          mint: new import_web3.PublicKey(fromMint),
          outputStateTreeInfo: tree,
          tokenPoolInfo: {
            tokenPoolPda,
            tokenProgram,
            isInitialized: true,
            balance: (0, import_stateless.bn)("0"),
            poolIndex: 0,
            mint: new import_web3.PublicKey(fromMint)
          }
        });
        instructions.push(compressInstruction);
        let tx = new import_web3.VersionedTransaction(new import_web3.TransactionMessage({
          payerKey: owner,
          recentBlockhash: blockhash,
          instructions
        }).compileToV0Message([adl]));
        preTransactions.push(tx);
      }
    }
    if (total < amountLamports && preTransactions.length === 0) {
      throw new Error("Insufficient balance");
    }
    const batches = _batchAccounts(selected);
    const ixs = [];
    let remaining = amountLamports;
    for (const batch of batches) {
      const proof = await this.connection.getValidityProofV0(
        batch.map((a) => ({
          hash: a.hash ?? a.compressedAccount?.hash,
          tree: a.treeInfo?.tree ?? a.compressedAccount?.treeInfo?.tree,
          queue: a.treeInfo?.queue ?? a.compressedAccount?.treeInfo?.queue
        }))
      );
      const batchAmount = decimals === 0 ? 1 : Math.min(remaining, batch.reduce((s, a) => s + Number(isSOL ? a.lamports : a.parsed.amount), 0));
      ixs.push(
        await (isSOL ? import_stateless.LightSystemProgram.transfer({
          payer: owner,
          inputCompressedAccounts: batch,
          toAddress: OPERATOR_PUBLIC_KEY,
          lamports: (0, import_stateless.bn)(batchAmount.toString()),
          recentInputStateRootIndices: proof.rootIndices,
          recentValidityProof: proof.compressedProof
        }) : import_compressed_token.CompressedTokenProgram.transfer({
          payer: owner,
          inputCompressedTokenAccounts: batch,
          toAddress: OPERATOR_PUBLIC_KEY,
          amount: (0, import_stateless.bn)(batchAmount.toString()),
          recentInputStateRootIndices: proof.rootIndices,
          recentValidityProof: proof.compressedProof
        }))
      );
      remaining -= batchAmount;
    }
    const transferTxs = await _packTransactions(this.connection, owner, ixs, adl);
    const allTxs = [...preTransactions, ...transferTxs];
    if (onStatusChange)
      onStatusChange("signing");
    const signed = await this.wallet.signAllTransactions(allTxs);
    const signedBase64 = signed.map((tx) => {
      const bytes = tx.serialize();
      return typeof Buffer !== "undefined" ? Buffer.from(bytes).toString("base64") : btoa(String.fromCharCode(...bytes));
    });
    const preSigs = [];
    for (let i = 0; i < preTransactions.length; i++) {
      const sig = await this.sendConnection.sendRawTransaction(signed[i].serialize(), {
        skipPreflight: true,
        maxRetries: 5,
        preflightCommitment: "confirmed"
      });
      await this.sendConnection.confirmTransaction(sig, "confirmed");
      preSigs.push(sig);
    }
    const swapId = import_web3.Keypair.generate().publicKey.toString();
    const swapData = {
      id: swapId,
      fromToken: fromMint,
      toToken: toMint,
      amount,
      amountValue: amountLamports,
      fromTokenDecimals: decimals,
      userPublicKey: owner.toString(),
      recipient: OPERATOR_PUBLIC_KEY.toString(),
      status: "initialized",
      created: Date.now()
    };
    if (onStatusChange)
      onStatusChange("processing");
    const transferBase64 = signedBase64.slice(preTransactions.length);
    const execRes = await fetch(`${REMOTE_OPERATOR_URL}/operator/process-swap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-null-client-secret": _getAuthToken()
      },
      body: JSON.stringify({ swapData, signedTransferData: transferBase64 })
    });
    if (!execRes.ok) {
      const err = await execRes.json().catch(() => ({}));
      throw new Error(err.error || `Swap submission failed: ${execRes.status}`);
    }
    const execData = await execRes.json();
    if (execData.status === "completed") {
      if (onStatusChange)
        onStatusChange("completed");
      return { status: "completed", result: execData };
    }
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await _sleep(2e3);
      if (onStatusChange)
        onStatusChange("pending");
    }
    return { status: "pending", swapId, result: execData };
  }
  // -----------------------------------------------------------------------
  // Balances
  // -----------------------------------------------------------------------
  /**
   * Get public (on-chain) token balances.
   *
   * @returns {Promise<Array<{symbol: string, name: string, amount: string, lamports: number, decimals: number, address: string}>>}
   */
  async getPublicBalances() {
    const owner = this.wallet.publicKey;
    const tokenBalances = [];
    const solBal = await this.connection.getBalance(owner);
    if (solBal > 0) {
      tokenBalances.push({
        symbol: "SOL",
        name: "Solana",
        amount: (solBal / 1e9 - 0.01).toString(),
        lamports: solBal - 0.01 * 1e9,
        decimals: 9,
        logo: "",
        address: import_spl_token.NATIVE_MINT.toString()
      });
    }
    const [spl, spl22] = await Promise.all([
      this.connection.getParsedTokenAccountsByOwner(owner, { programId: import_spl_token.TOKEN_PROGRAM_ID }, "processed"),
      this.connection.getParsedTokenAccountsByOwner(owner, { programId: import_spl_token.TOKEN_2022_PROGRAM_ID }, "processed")
    ]);
    for (const ta of [...spl.value, ...spl22.value]) {
      const p = ta.account.data.parsed;
      if (p.info.tokenAmount.amount === "0")
        continue;
      tokenBalances.push({
        symbol: "",
        name: "",
        amount: (parseInt(p.info.tokenAmount.amount) / 10 ** p.info.tokenAmount.decimals).toString(),
        lamports: parseInt(p.info.tokenAmount.amount),
        decimals: p.info.tokenAmount.decimals,
        logo: "",
        address: p.info.mint,
        dexscreener: ""
      });
    }
    return _enrichMetadata(tokenBalances);
  }
  /**
   * Get private (ZK-compressed) token balances.
   * Requires `wallet.signMessage`.
   *
   * @returns {Promise<Array<{symbol: string, name: string, amount: string, lamports: number, decimals: number, address: string}>>}
   */
  async getPrivateBalances() {
    if (!this.wallet.signMessage) {
      throw new Error("NullTrace: wallet.signMessage is required for getPrivateBalances");
    }
    const owner = this.wallet.publicKey;
    if (!this._sigCache) {
      const msg = new TextEncoder().encode("Reveal Private Balances");
      this._sigCache = await this.wallet.signMessage(msg);
    }
    const tokenBalances = [];
    const compressedSol = await this.connection.getCompressedBalanceByOwner(owner);
    if (parseInt(compressedSol.toString()) > 0) {
      tokenBalances.push({
        symbol: "SOL",
        name: "Solana",
        amount: (parseInt(compressedSol.toString()) / 1e9).toString(),
        lamports: parseInt(compressedSol.toString()),
        decimals: 9,
        logo: "",
        address: import_spl_token.NATIVE_MINT.toString()
      });
    }
    const compressedTokens = await this.connection.getCompressedTokenAccountsByOwner(owner);
    for (const item of compressedTokens.items) {
      const mintAddr = item.parsed.mint.toString();
      const amt = (0, import_stateless.bn)(item.parsed.amount.toString());
      let entry = tokenBalances.find((t) => t.address === mintAddr);
      if (!entry) {
        entry = { symbol: "", name: "", amount: "0", lamports: 0, decimals: 0, logo: "", address: mintAddr };
        tokenBalances.push(entry);
      }
      entry.lamports += parseInt(amt.toString());
    }
    return _enrichMetadata(tokenBalances.filter((t) => t.lamports > 0));
  }
  /**
   * Get all balances merged (public + private) with `publicAmount` and `privateAmount` fields.
   * Requires `wallet.signMessage`.
   *
   * @returns {Promise<Array<{symbol: string, name: string, amount: number, publicAmount: number, privateAmount: number, address: string}>>}
   */
  async getBalances() {
    const [pub, priv] = await Promise.all([this.getPublicBalances(), this.getPrivateBalances()]);
    const merged = pub.map((t) => ({
      ...t,
      publicAmount: parseFloat(t.amount),
      privateAmount: 0,
      amount: parseFloat(t.amount)
    }));
    for (const token of priv) {
      const existing = merged.find((t) => t.address === token.address);
      if (existing) {
        existing.privateAmount += parseFloat(token.amount);
        existing.amount += parseFloat(token.amount);
      } else {
        merged.push({ ...token, publicAmount: 0, privateAmount: parseFloat(token.amount), amount: parseFloat(token.amount) });
      }
    }
    return merged;
  }
  /**
   * Fetch metadata for a token (symbol, name, logo, decimals).
   *
   * @param {string} mint Token mint address.
   * @returns {Promise<{symbol: string, name: string, logo: string, decimals: number}>}
   */
  async getTokenMetadata(mint) {
    if (!mint)
      throw new Error("NullTrace.getTokenMetadata: mint is required");
    if (mint === import_spl_token.NATIVE_MINT.toBase58()) {
      return { symbol: "SOL", name: "Solana", logo: "", decimals: 9 };
    }
    const result = [{ address: mint, symbol: "", name: "", logo: "", decimals: 0, lamports: 0 }];
    await _enrichMetadata(result);
    return result[0];
  }
  /** Clear cached message signature. Next getPrivateBalances will re-prompt. */
  clearSignatureCache() {
    this._sigCache = null;
  }
};
var src_default = NullTrace;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LimitOrders,
  NullTrace
});
