var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/limit-orders.js
var limit_orders_exports = {};
__export(limit_orders_exports, {
  LimitOrders: () => LimitOrders,
  default: () => limit_orders_default
});
module.exports = __toCommonJS(limit_orders_exports);
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
var limit_orders_default = LimitOrders;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LimitOrders
});
