/**
 * NullTrace SDK
 * Standalone privacy-focused Solana transaction SDK powered by Light Protocol ZK compression.
 *
 * @example
 * import { NullTrace } from 'nulltrace-sdk';
 *
 * const nt = new NullTrace('https://mainnet.helius-rpc.com/?api-key=YOUR_KEY', wallet);
 * await nt.nullify('So11111111111111111111111111111111111111112', '0.5');
 */

import {
  VersionedTransaction,
  PublicKey,
  TransactionMessage,
  ComputeBudgetProgram,
  Keypair,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  NATIVE_MINT,
} from '@solana/spl-token';
import {
  createRpc,
  bn,
  LightSystemProgram,
  COMPRESSED_TOKEN_PROGRAM_ID,
  selectStateTreeInfo,
} from '@lightprotocol/stateless.js';
import {
  getTokenPoolInfos,
  selectTokenPoolInfosForDecompression,
  CompressedTokenProgram,
} from '@lightprotocol/compressed-token';
import bs58 from 'bs58';
import { createHmac } from 'crypto';
import nacl from 'tweetnacl';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPERATOR_KEY = '5STUuhrL8kJ4up9spEY39VJ6ibQCFrg8x8cRV5UeEcfv';
const OPERATOR_PUBLIC_KEY = new PublicKey(OPERATOR_KEY);
const ALT_ADDRESS = new PublicKey('9NYFyEqPkyXUhkerbGHXUXkvb4qpzeEdHuGpgbgpH1NJ');
const REMOTE_OPERATOR_URL = 'http://34.68.76.183:3333';
const SHARED_SECRET = 'NULL_TRACE_OPERATOR_SECRET_BASE_V1';
const FEE_BPS = 0.001; // 0.1%
const COMPUTE_UNITS = 1_400_000;
const COMPUTE_PRICE = 5000;
const MAX_TX_SIZE = 1232;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Generate a TOTP token (6-digit, SHA1, step=180s) matching speakeasy output. */
function _getAuthToken() {
  const step = 180;
  const counter = Math.floor(Date.now() / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', Buffer.from(SHARED_SECRET, 'ascii'));
  hmac.update(buf);
  const hash = hmac.digest();
  const offset = hash[hash.length - 1] & 0x0f;
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return (code % 1000000).toString().padStart(6, '0');
}

function _validateHeliusRpc(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('NullTrace: Valid Helius rpcUrl is required');
  }
  const lower = url.toLowerCase();
  if (!lower.includes('helius')) {
    throw new Error(
      'NullTrace: A Helius RPC endpoint is required. ' +
      'Get a key at https://helius.dev'
    );
  }
  return url;
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Get mint decimals and token program. Returns { decimals, tokenProgram } */
async function _getMintInfo(connection, mintAddress) {
  if (mintAddress === NATIVE_MINT.toBase58()) {
    return { decimals: 9, tokenProgram: TOKEN_PROGRAM_ID };
  }
  const mintInfo = await connection.getParsedAccountInfo(new PublicKey(mintAddress));
  if (!mintInfo.value) throw new Error(`Mint not found: ${mintAddress}`);
  return {
    decimals: mintInfo.value.data.parsed.info.decimals,
    tokenProgram: new PublicKey(mintInfo.value.owner),
  };
}

/** Fetch compressed accounts for an owner, sorted largest first. */
async function _getCompressedAccounts(connection, owner, mint, isSOL) {
  const accounts = isSOL
    ? await connection.getCompressedAccountsByOwner(owner)
    : await connection.getCompressedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
  return accounts.items.sort((a, b) => {
    const aAmt = isSOL ? a.lamports : a.parsed.amount;
    const bAmt = isSOL ? b.lamports : b.parsed.amount;
    return Number(bAmt) - Number(aAmt);
  });
}

/** Select enough input accounts to cover amountLamports. */
function _selectInputs(sortedAccounts, amountLamports, isSOL) {
  const selected = [];
  let total = 0;
  for (const a of sortedAccounts) {
    if (total >= amountLamports) break;
    total += Number(isSOL ? a.lamports : a.parsed.amount);
    selected.push(a);
  }
  return { selected, total };
}

/** Split accounts into batches of valid sizes (8, 4, 2, 1). */
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

/**
 * Pack instructions into versioned transactions that fit within MAX_TX_SIZE.
 * Returns serialized base64 strings.
 */
async function _packTransactions(connection, payer, instructions, adl) {
  const { blockhash } = await connection.getLatestBlockhash();
  const computeIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_PRICE }),
  ];

  let current = [...computeIxs];
  const messages = [];

  for (const ix of instructions) {
    try {
      current.push(ix);
      const msg = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash,
        instructions: current,
      }).compileToV0Message([adl]);
      if (msg.serialize().length > MAX_TX_SIZE) throw new Error('oversize');
    } catch {
      current.pop();
      if (current.length > computeIxs.length) {
        messages.push(
          new TransactionMessage({
            payerKey: payer,
            recentBlockhash: blockhash,
            instructions: current,
          }).compileToV0Message([adl])
        );
      }
      current = [...computeIxs, ix];
    }
  }

  if (current.length > computeIxs.length) {
    messages.push(
      new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash,
        instructions: current,
      }).compileToV0Message([adl])
    );
  }

  return messages.map((m) => new VersionedTransaction(m));
}

/** Sign transactions + send + confirm. Returns array of signatures. */
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

/** Fetch token metadata from DexScreener, GeckoTerminal, and Jupiter. */
async function _enrichMetadata(tokenBalances) {
  if (!tokenBalances.length) return tokenBalances;
  const addresses = tokenBalances.map((t) => t.address).join(',');

  try {
    const dexRes = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + addresses);
    if (dexRes.ok) {
      const data = await dexRes.json();
      if (data.pairs) {
        const pairs = data.pairs.sort(
          (a, b) => parseFloat(b.volume?.h24 ?? '0') - parseFloat(a.volume?.h24 ?? '0')
        );
        for (const t of tokenBalances) {
          const pair = pairs.find((p) => p.baseToken.address === t.address);
          if (pair) {
            t.symbol = t.symbol || pair.baseToken.symbol;
            t.name = t.name || pair.baseToken.name;
            t.logo = t.logo || (pair.info?.imageUrl ?? '');
            t.dexscreener = t.dexscreener || (pair.url ?? '');
          }
        }
      }
    }
  } catch {}

  try {
    const geckoRes = await fetch(
      'https://api.geckoterminal.com/api/v2/networks/solana/tokens/multi/' +
        addresses +
        '?include=top_pools'
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
            if (t.decimals) t.amount = (t.lamports / 10 ** t.decimals).toFixed(t.decimals);
          }
        }
      }
    }
  } catch {}

  try {
    const jupRes = await fetch(
      'https://datapi.jup.ag/v1/assets/search?query=' + addresses + '&sortBy=verified'
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
            if (t.decimals) t.amount = (t.lamports / 10 ** t.decimals).toFixed(t.decimals);
          }
        }
      }
    }
  } catch {}

  return tokenBalances;
}

// ---------------------------------------------------------------------------
// NullTrace
// ---------------------------------------------------------------------------

class NullTrace {
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
    if (!walletOrKey) throw new Error('NullTrace: a wallet, Keypair, secret key, or private key string is required');

    this.rpcUrl = rpcUrl;
    this.wallet = NullTrace._resolveWallet(walletOrKey);
    this.connection = createRpc(rpcUrl, rpcUrl, rpcUrl, { commitment: 'processed' });

    /** @internal */
    this._adlCache = null;
    /** @internal */
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
      throw new Error('NullTrace.fromKeypair: invalid Keypair');
    }
    return {
      publicKey: keypair.publicKey,
      signAllTransactions: async (txs) => {
        for (const tx of txs) tx.sign([keypair]);
        return txs;
      },
      signMessage: async (msg) => nacl.sign.detached(msg, keypair.secretKey),
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
      throw new Error('NullTrace.fromSecretKey: expected a 64-byte Uint8Array');
    }
    return NullTrace.fromKeypair(Keypair.fromSecretKey(secretKey));
  }

  /**
   * Create a wallet adapter interface from a base58-encoded private key string.
   *
   * @param {string} base58Key  A base58-encoded private key (as exported by Phantom, Solflare, etc.).
   * @returns {{ publicKey: PublicKey, signAllTransactions: Function, signMessage: Function }}
   */
  static fromPrivateKey(base58Key) {
    if (typeof base58Key !== 'string' || base58Key.length < 32) {
      throw new Error('NullTrace.fromPrivateKey: expected a base58-encoded private key string');
    }
    const decoded = bs58.decode(base58Key);
    return NullTrace.fromKeypair(Keypair.fromSecretKey(decoded));
  }

  /**
   * @internal Resolve any supported wallet input into a wallet adapter interface.
   */
  static _resolveWallet(input) {
    // Already a wallet adapter
    if (input?.publicKey && typeof input.signAllTransactions === 'function') {
      return input;
    }

    // Keypair instance
    if (input instanceof Keypair) {
      return NullTrace.fromKeypair(input);
    }

    // Uint8Array secret key (64 bytes)
    if (input instanceof Uint8Array && input.length === 64) {
      return NullTrace.fromSecretKey(input);
    }

    // Base58 private key string
    if (typeof input === 'string') {
      return NullTrace.fromPrivateKey(input);
    }

    throw new Error(
      'NullTrace: unsupported wallet type. Provide a wallet adapter, Keypair, 64-byte Uint8Array, or base58 private key string.'
    );
  }

  /** @internal Get the address lookup table (cached). */
  async _getAlt() {
    if (this._adlCache) return this._adlCache;
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
    if (!mint || !amount) throw new Error('NullTrace.nullify: mint and amount are required');
    const owner = this.wallet.publicKey;
    const isSOL = mint === NATIVE_MINT.toBase58();
    const { decimals, tokenProgram } = await _getMintInfo(this.connection, mint);

    const amountLamports = bn(Math.floor(parseFloat(amount) * 10 ** decimals).toString());
    const feeLamports = bn(Math.floor(parseInt(amountLamports.toString()) * FEE_BPS).toString());
    const ixs = [];

    const activeStateTrees = await this.connection.getStateTreeInfos();
    const tree = selectStateTreeInfo(activeStateTrees);

    if (isSOL) {
      ixs.push(
        await LightSystemProgram.compress({
          payer: owner,
          toAddress: owner,
          lamports: amountLamports.sub(feeLamports),
          outputStateTreeInfo: tree,
        }),
        await LightSystemProgram.compress({
          payer: owner,
          toAddress: OPERATOR_PUBLIC_KEY,
          lamports: feeLamports,
          outputStateTreeInfo: tree,
        })
      );
    } else {
      const mintPk = new PublicKey(mint);
      const sourceAta = await getAssociatedTokenAddress(mintPk, owner, false, tokenProgram);
      const [tokenPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('pool'), mintPk.toBuffer()],
        COMPRESSED_TOKEN_PROGRAM_ID
      );
      const poolInfo = await this.connection.getAccountInfo(tokenPoolPda);

      if (!poolInfo) {
        ixs.push(
          await CompressedTokenProgram.createTokenPool({
            feePayer: owner,
            mint: mintPk,
            tokenProgramId: tokenProgram,
          })
        );
      }

      ixs.push(
        await CompressedTokenProgram.compress({
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
            balance: bn('0'),
            poolIndex: 0,
            mint: mintPk,
          },
        })
      );

      // const operatorAta = await getAssociatedTokenAddress(mintPk, OPERATOR_PUBLIC_KEY, false, tokenProgram);
      // const operatorInfo = await this.connection.getAccountInfo(operatorAta);
      // if (!operatorInfo) {
      //   ixs.push(createAssociatedTokenAccountInstruction(owner, operatorAta, OPERATOR_PUBLIC_KEY, mintPk, tokenProgram));
      // }

      // ixs.push(
      //   createTransferCheckedInstruction(sourceAta, mintPk, operatorAta, owner, feeLamports, decimals, [], tokenProgram)
      // );
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
    if (!mint || !amount) throw new Error('NullTrace.reveal: mint and amount are required');
    const owner = this.wallet.publicKey;
    const isSOL = mint === NATIVE_MINT.toBase58();
    const { decimals, tokenProgram } = await _getMintInfo(this.connection, mint);
    const amountLamports = Math.floor(parseFloat(amount) * 10 ** decimals);

    const sorted = await _getCompressedAccounts(this.connection, owner, mint, isSOL);
    const { selected, total } = _selectInputs(sorted, amountLamports, isSOL);
    if (total < amountLamports) throw new Error('Insufficient private balance');

    const batches = _batchAccounts(selected);
    const ixs = [];

    let selectedTokenPoolInfos;
    let destinationAta;

    if (!isSOL) {
      const tokenPoolInfos = await getTokenPoolInfos(this.connection, new PublicKey(mint));
      selectedTokenPoolInfos = selectTokenPoolInfosForDecompression(tokenPoolInfos, amountLamports);
      destinationAta = await getAssociatedTokenAddress(new PublicKey(mint), owner, false, tokenProgram);
      const info = await this.connection.getAccountInfo(destinationAta);
      if (!info) {
        ixs.push(createAssociatedTokenAccountInstruction(owner, destinationAta, owner, new PublicKey(mint), tokenProgram));
      }
    }

    let remaining = amountLamports;

    for (const batch of batches) {
      const proof = await this.connection.getValidityProofV0(
        batch.map((a) => ({
          hash: a.hash ?? a.compressedAccount?.hash,
          tree: a.treeInfo?.tree ?? a.compressedAccount?.treeInfo?.tree,
          queue: a.treeInfo?.queue ?? a.compressedAccount?.treeInfo?.queue,
        }))
      );
      const batchAmount =
        decimals === 0
          ? 1
          : Math.min(remaining, batch.reduce((s, a) => s + Number(isSOL ? a.lamports : a.parsed.amount), 0));

      ixs.push(
        await (isSOL
          ? LightSystemProgram.decompress({
              payer: owner,
              inputCompressedAccounts: batch,
              toAddress: owner,
              lamports: bn(batchAmount.toString()),
              recentInputStateRootIndices: proof.rootIndices,
              recentValidityProof: proof.compressedProof,
            })
          : CompressedTokenProgram.decompress({
              payer: owner,
              inputCompressedTokenAccounts: batch,
              toAddress: destinationAta,
              amount: bn(batchAmount.toString()),
              recentInputStateRootIndices: proof.rootIndices,
              recentValidityProof: proof.compressedProof,
              tokenPoolInfos: selectedTokenPoolInfos,
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
      throw new Error('NullTrace.transfer: mint, amount, and recipient are required');
    }
    const owner = this.wallet.publicKey;
    const recipientPk = new PublicKey(recipient);
    const isSOL = mint === NATIVE_MINT.toBase58();
    const { decimals, tokenProgram } = await _getMintInfo(this.connection, mint);
    const amountLamports = Math.floor(parseFloat(amount) * 10 ** decimals);

    const sorted = await _getCompressedAccounts(this.connection, owner, mint, isSOL);
    const { selected, total } = _selectInputs(sorted, amountLamports, isSOL);

    const { blockhash } = await this.connection.getLatestBlockhash();
    const adl = await this._getAlt();
    const preTransactions = [];

    // If compressed balance is insufficient, compress public tokens first
    if (total < amountLamports) {
      const deficit = amountLamports - total;
      const fee = bn(Math.floor(deficit * FEE_BPS).toString());
      const trees = await this.connection.getStateTreeInfos();
      const tree = selectStateTreeInfo(trees);

      if (isSOL) {
        const solBal = await this.connection.getBalance(owner);
        if (solBal < deficit + 100_000) throw new Error('Insufficient balance');
        const compressIx = await LightSystemProgram.compress({
          payer: owner,
          toAddress: recipientPk,
          lamports: bn(deficit.toString()).sub(fee),
          outputStateTreeInfo: tree,
        });
        const feeIx = await LightSystemProgram.compress({
          payer: owner,
          toAddress: OPERATOR_PUBLIC_KEY,
          lamports: fee,
          outputStateTreeInfo: tree,
        });
        const msg = new TransactionMessage({
          payerKey: owner,
          recentBlockhash: blockhash,
          instructions: [
            ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_PRICE }),
            compressIx,
            feeIx,
          ],
        }).compileToV0Message([adl]);
        preTransactions.push(new VersionedTransaction(msg));
      } else {
        let instructions = [
          ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_PRICE }),
        ];

        const sourceAta = await getAssociatedTokenAddress(
          new PublicKey(mint),
          owner,
          false,
          tokenProgram
        );
        const tokenAccountInfos = await this.connection.getParsedTokenAccountsByOwner(
          owner,
          { programId: tokenProgram, mint: new PublicKey(mint) },
          'processed'
        );
        const publicBalance = tokenAccountInfos.value?.[0].account.data.parsed.info.tokenAmount.amount ?? 0;
        if (publicBalance < deficit) throw new Error('Insufficient balance');

        const [tokenPoolPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("pool"), new PublicKey(mint).toBuffer()],
          COMPRESSED_TOKEN_PROGRAM_ID
        );

        const tokenPoolInfo = await this.connection.getAccountInfo(tokenPoolPda, 'processed');

        if (!tokenPoolInfo) {

          const createTokenPoolIx = await CompressedTokenProgram.createTokenPool({
            feePayer: owner,
            mint: new PublicKey(mint),
            tokenProgramId: tokenProgram
          });

          instructions.push(createTokenPoolIx);
        }

        const compressInstruction = await CompressedTokenProgram.compress({
          payer: owner,
          owner: owner,
          source: sourceAta,
          toAddress: [recipientPk, OPERATOR_PUBLIC_KEY],
          amount: [bn(deficit.toString()).sub(fee), fee],
          mint: new PublicKey(mint),
          outputStateTreeInfo: tree,
          tokenPoolInfo: {
            tokenPoolPda: tokenPoolPda,
            tokenProgram: tokenProgram,
            isInitialized: true,
            balance: bn('0'),
            poolIndex: 0,
            mint: new PublicKey(mint)
          }
        });

        instructions.push(compressInstruction);

        // const operatorTokenAccount = await getAssociatedTokenAddress(new PublicKey(mint), OPERATOR_PUBLIC_KEY, false, tokenProgram);
        // const operatorPoolInfo = await this.connection.getAccountInfo(operatorTokenAccount);

        // if (!operatorPoolInfo) {
        //   instructions.push(createAssociatedTokenAccountInstruction(owner, operatorTokenAccount, OPERATOR_PUBLIC_KEY, new PublicKey(mint), tokenProgram));
        // }

        // instructions.push(createTransferCheckedInstruction(
        //   new PublicKey(sourceAta),
        //   new PublicKey(mint),
        //   new PublicKey(operatorTokenAccount),
        //   owner,
        //   fee,
        //   decimals,
        //   [],
        //   tokenProgram
        // ))

        let tx = new VersionedTransaction(new TransactionMessage({
          payerKey: owner,
          recentBlockhash: blockhash,
          instructions
        }).compileToV0Message([adl]));

        preTransactions.push(tx);
        
      }
    }

    if (total < amountLamports && preTransactions.length === 0) {
      throw new Error('Insufficient balance');
    }

    const batches = _batchAccounts(selected);
    let remaining = amountLamports;

    const ixs = [];
    for (const batch of batches) {
      const proof = await this.connection.getValidityProofV0(
        batch.map((a) => ({
          hash: a.hash ?? a.compressedAccount?.hash,
          tree: a.treeInfo?.tree ?? a.compressedAccount?.treeInfo?.tree,
          queue: a.treeInfo?.queue ?? a.compressedAccount?.treeInfo?.queue,
        }))
      );
      const batchAmount =
        decimals === 0
          ? 1
          : Math.min(remaining, batch.reduce((s, a) => s + Number(isSOL ? a.lamports : a.parsed.amount), 0));

      ixs.push(
        await (isSOL
          ? LightSystemProgram.transfer({
              payer: owner,
              inputCompressedAccounts: batch,
              toAddress: recipientPk,
              lamports: bn(batchAmount.toString()),
              recentInputStateRootIndices: proof.rootIndices,
              recentValidityProof: proof.compressedProof,
            })
          : CompressedTokenProgram.transfer({
              payer: owner,
              inputCompressedTokenAccounts: batch,
              toAddress: recipientPk,
              amount: bn(batchAmount.toString()),
              recentInputStateRootIndices: proof.rootIndices,
              recentValidityProof: proof.compressedProof,
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
      throw new Error('NullTrace.quoteSwap: inputMint, outputMint, and amount are required');
    }
    const { decimals } = await _getMintInfo(this.connection, inputMint);
    const amountLamports = Math.floor(parseFloat(amount) * 10 ** decimals);

    const res = await fetch(`${REMOTE_OPERATOR_URL}/operator/quote-swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-null-client-secret': _getAuthToken(),
      },
      body: JSON.stringify({ inputMint, outputMint, amount: amountLamports }),
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
      throw new Error('NullTrace.swap: fromMint, toMint, and amount are required');
    }
    const { onStatusChange, timeout = 120000 } = options;
    const owner = this.wallet.publicKey;
    const isSOL = fromMint === NATIVE_MINT.toBase58();
    const { decimals, tokenProgram } = await _getMintInfo(this.connection, fromMint);
    const amountLamports = Math.floor(parseFloat(amount) * 10 ** decimals);

    const sorted = await _getCompressedAccounts(this.connection, owner, fromMint, isSOL);
    const { selected, total } = _selectInputs(sorted, amountLamports, isSOL);

    const { blockhash } = await this.connection.getLatestBlockhash();
    const adl = await this._getAlt();
    const preTransactions = [];

    // If compressed balance is insufficient, compress public tokens first
    if (total < amountLamports) {
      const deficit = amountLamports - total;
      const fee = bn(Math.floor(deficit * FEE_BPS).toString());
      const trees = await this.connection.getStateTreeInfos();
      const tree = selectStateTreeInfo(trees);

      if (isSOL) {
        const solBal = await this.connection.getBalance(owner);
        if (solBal < deficit + 100_000) throw new Error('Insufficient balance');
        const compressIx = await LightSystemProgram.compress({
          payer: owner,
          toAddress: OPERATOR_PUBLIC_KEY,
          lamports: bn(deficit.toString()),
          outputStateTreeInfo: tree,
        });
        const msg = new TransactionMessage({
          payerKey: owner,
          recentBlockhash: blockhash,
          instructions: [
            ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_PRICE }),
            compressIx
          ],
        }).compileToV0Message([adl]);
        preTransactions.push(new VersionedTransaction(msg));
      } else {
        let instructions = [
          ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_PRICE }),
        ];
        
        const sourceAta = await getAssociatedTokenAddress(
          new PublicKey(fromMint),
          owner,
          false,
          tokenProgram
        );
        const tokenAccountInfos = await this.connection.getParsedTokenAccountsByOwner(
          owner,
          { programId: tokenProgram, mint: new PublicKey(fromMint) },
          'processed'
        );
        const publicBalance = tokenAccountInfos.value?.[0].account.data.parsed.info.tokenAmount.amount ?? 0;
        if (publicBalance < deficit) throw new Error('Insufficient balance');

        const [tokenPoolPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("pool"), new PublicKey(fromMint).toBuffer()],
          COMPRESSED_TOKEN_PROGRAM_ID
        );

        const tokenPoolInfo = await this.connection.getAccountInfo(tokenPoolPda, 'processed');

        if (!tokenPoolInfo) {

          const createTokenPoolIx = await CompressedTokenProgram.createTokenPool({
            feePayer: owner,
            mint: new PublicKey(fromMint),
            tokenProgramId: tokenProgram
          });

          instructions.push(createTokenPoolIx);
        }

        const compressInstruction = await CompressedTokenProgram.compress({
          payer: owner,
          owner: owner,
          source: sourceAta,
          toAddress: OPERATOR_PUBLIC_KEY,
          amount: bn(deficit.toString()),
          mint: new PublicKey(fromMint),
          outputStateTreeInfo: tree,
          tokenPoolInfo: {
            tokenPoolPda: tokenPoolPda,
            tokenProgram: tokenProgram,
            isInitialized: true,
            balance: bn('0'),
            poolIndex: 0,
            mint: new PublicKey(fromMint)
          }
        });

        instructions.push(compressInstruction);

        // const operatorTokenAccount = await getAssociatedTokenAddress(new PublicKey(fromMint), OPERATOR_PUBLIC_KEY, false, tokenProgram);
        // const operatorPoolInfo = await this.connection.getAccountInfo(operatorTokenAccount);

        // if (!operatorPoolInfo) {
        //   instructions.push(createAssociatedTokenAccountInstruction(owner, operatorTokenAccount, OPERATOR_PUBLIC_KEY, new PublicKey(fromMint), tokenProgram));
        // }

        // instructions.push(createTransferCheckedInstruction(
        //   new PublicKey(sourceAta),
        //   new PublicKey(fromMint),
        //   new PublicKey(operatorTokenAccount),
        //   owner,
        //   fee,
        //   decimals,
        //   [],
        //   tokenProgram
        // ))

        let tx = new VersionedTransaction(new TransactionMessage({
          payerKey: owner,
          recentBlockhash: blockhash,
          instructions
        }).compileToV0Message([adl]));

        preTransactions.push(tx);
        
      }
    }

    if (total < amountLamports && preTransactions.length === 0) {
      throw new Error('Insufficient balance');
    }

    // Build compressed transfer-to-operator transactions
    const batches = _batchAccounts(selected);
    const ixs = [];
    let remaining = amountLamports;

    for (const batch of batches) {
      const proof = await this.connection.getValidityProofV0(
        batch.map((a) => ({
          hash: a.hash ?? a.compressedAccount?.hash,
          tree: a.treeInfo?.tree ?? a.compressedAccount?.treeInfo?.tree,
          queue: a.treeInfo?.queue ?? a.compressedAccount?.treeInfo?.queue,
        }))
      );
      const batchAmount =
        decimals === 0
          ? 1
          : Math.min(remaining, batch.reduce((s, a) => s + Number(isSOL ? a.lamports : a.parsed.amount), 0));

      ixs.push(
        await (isSOL
          ? LightSystemProgram.transfer({
              payer: owner,
              inputCompressedAccounts: batch,
              toAddress: OPERATOR_PUBLIC_KEY,
              lamports: bn(batchAmount.toString()),
              recentInputStateRootIndices: proof.rootIndices,
              recentValidityProof: proof.compressedProof,
            })
          : CompressedTokenProgram.transfer({
              payer: owner,
              inputCompressedTokenAccounts: batch,
              toAddress: OPERATOR_PUBLIC_KEY,
              amount: bn(batchAmount.toString()),
              recentInputStateRootIndices: proof.rootIndices,
              recentValidityProof: proof.compressedProof,
            }))
      );
      remaining -= batchAmount;
    }

    const transferTxs = await _packTransactions(this.connection, owner, ixs, adl);
    const allTxs = [...preTransactions, ...transferTxs];

    // Sign all transactions
    if (onStatusChange) onStatusChange('signing');
    const signed = await this.wallet.signAllTransactions(allTxs);
    const signedBase64 = signed.map((tx) => {
      const bytes = tx.serialize();
      return typeof Buffer !== 'undefined'
        ? Buffer.from(bytes).toString('base64')
        : btoa(String.fromCharCode(...bytes));
    });

    // Send pre-transactions (public → compressed) directly
    const preSigs = [];
    for (let i = 0; i < preTransactions.length; i++) {
      const sig = await this.connection.sendRawTransaction(signed[i].serialize());
      await this.connection.confirmTransaction(sig);
      preSigs.push(sig);
    }

    // Build swap data
    const swapId = Keypair.generate().publicKey.toString();
    const swapData = {
      id: swapId,
      fromToken: fromMint,
      toToken: toMint,
      amount,
      amountValue: amountLamports,
      fromTokenDecimals: decimals,
      userPublicKey: owner.toString(),
      recipient: OPERATOR_PUBLIC_KEY.toString(),
      status: 'initialized',
      created: Date.now(),
    };

    // Submit to operator
    if (onStatusChange) onStatusChange('processing');
    const transferBase64 = signedBase64.slice(preTransactions.length);

    const execRes = await fetch(`${REMOTE_OPERATOR_URL}/operator/process-swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-null-client-secret': _getAuthToken(),
      },
      body: JSON.stringify({ swapData, signedTransferData: transferBase64 }),
    });

    if (!execRes.ok) {
      const err = await execRes.json().catch(() => ({}));
      throw new Error(err.error || `Swap submission failed: ${execRes.status}`);
    }

    const execData = await execRes.json();

    if (execData.status === 'completed') {
      if (onStatusChange) onStatusChange('completed');
      return { status: 'completed', result: execData };
    }

    // Poll for completion
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await _sleep(2000);
      // The operator response itself indicates completion — if we reach here,
      // the swap is still processing. Return what we have.
      if (onStatusChange) onStatusChange('pending');
    }

    return { status: 'pending', swapId, result: execData };
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
        symbol: 'SOL', name: 'Solana',
        amount: ((solBal / 1e9) - 0.01).toString(),
        lamports: solBal - 0.01 * 1e9,
        decimals: 9, logo: '', address: NATIVE_MINT.toString(),
      });
    }

    const [spl, spl22] = await Promise.all([
      this.connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, 'processed'),
      this.connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, 'processed'),
    ]);

    for (const ta of [...spl.value, ...spl22.value]) {
      const p = ta.account.data.parsed;
      if (p.info.tokenAmount.amount === '0') continue;
      tokenBalances.push({
        symbol: '', name: '',
        amount: (parseInt(p.info.tokenAmount.amount) / 10 ** p.info.tokenAmount.decimals).toString(),
        lamports: parseInt(p.info.tokenAmount.amount),
        decimals: p.info.tokenAmount.decimals,
        logo: '', address: p.info.mint, dexscreener: '',
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
      throw new Error('NullTrace: wallet.signMessage is required for getPrivateBalances');
    }
    const owner = this.wallet.publicKey;

    // Sign ownership proof (cached)
    if (!this._sigCache) {
      const msg = new TextEncoder().encode('Reveal Private Balances');
      this._sigCache = await this.wallet.signMessage(msg);
    }

    const tokenBalances = [];
    const compressedSol = await this.connection.getCompressedBalanceByOwner(owner);
    if (parseInt(compressedSol.toString()) > 0) {
      tokenBalances.push({
        symbol: 'SOL', name: 'Solana',
        amount: (parseInt(compressedSol.toString()) / 1e9).toString(),
        lamports: parseInt(compressedSol.toString()),
        decimals: 9, logo: '', address: NATIVE_MINT.toString(),
      });
    }

    const compressedTokens = await this.connection.getCompressedTokenAccountsByOwner(owner);
    for (const item of compressedTokens.items) {
      const mintAddr = item.parsed.mint.toString();
      const amt = bn(item.parsed.amount.toString());
      let entry = tokenBalances.find((t) => t.address === mintAddr);
      if (!entry) {
        entry = { symbol: '', name: '', amount: '0', lamports: 0, decimals: 0, logo: '', address: mintAddr };
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
      amount: parseFloat(t.amount),
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
    if (!mint) throw new Error('NullTrace.getTokenMetadata: mint is required');
    if (mint === NATIVE_MINT.toBase58()) {
      return { symbol: 'SOL', name: 'Solana', logo: '', decimals: 9 };
    }
    const result = [{ address: mint, symbol: '', name: '', logo: '', decimals: 0, lamports: 0 }];
    await _enrichMetadata(result);
    return result[0];
  }

  /** Clear cached message signature. Next getPrivateBalances will re-prompt. */
  clearSignatureCache() {
    this._sigCache = null;
  }
}

export { NullTrace };
export default NullTrace;
