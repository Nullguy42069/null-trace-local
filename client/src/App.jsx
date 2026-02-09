import { useState, useEffect, useMemo, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { VersionedTransaction } from '@solana/web3.js';
import axios from 'axios';
import Buffer from 'buffer';
import bs58 from 'bs58';
import { NATIVE_MINT } from '@solana/spl-token';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
const NULL_MINT = '48eKhwwadm7LJ57msuDYdq36CXx23Ratdbu74Pa1NULL'

const API_URL = 'http://localhost:3003';

// Placeholder for Swap Quote and Metadata
const fetchSwapQuote = async (inputMint, outputMint, amount) => {
  const res = await axios.post(`${API_URL}/tx/quoteSwap`, {
    inputMint,
    outputMint,
    amount
  });
  return res.data;
};

const fetchTokenMetadata = async (mint) => {
  if (!mint) return null;
  const res = await axios.get(`${API_URL}/tx/getTokenMetadata?mint=${mint}`);
  return res.data;
};

const TokenDropdown = ({ balances, selectedMint, onSelect, emptyMessage }) => {
  const hasBalances = balances && balances.length > 0;

  if (!hasBalances) {
    return (
      <div style={{ marginBottom: 10 }}>
        <label style={{ display: 'block', marginBottom: 5 }}>Select Token</label>
        <select
          disabled
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: 5,
            border: '1px solid #ccc',
            background: '#eee',
            fontSize: 16,
            appearance: 'none'
          }}
        >
          <option>{emptyMessage || "No Balances Available"}</option>
        </select>
      </div>
    );
  }

  const selectedToken = balances.find(b => b.address === selectedMint);

  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', marginBottom: 5 }}>Select Token</label>
      <div style={{ position: 'relative' }}>
        <select
          value={selectedMint}
          onChange={(e) => onSelect(e.target.value)}
          style={{
            width: '100%',
            padding: '10px',
            paddingRight: '30px',
            borderRadius: 5,
            border: '1px solid #ccc',
            appearance: 'none',
            background: '#fff',
            fontSize: 16
          }}
        >
          <option value={selectedMint?.address || ''} disabled>Select a token</option>
          {balances.map((b, i) => (
            <option key={i} value={b.address}>
              ${b.symbol} - {b.name}
            </option>
          ))}
          {/* <option value="manual">Enter Custom Mint...</option> */}
        </select>
        {/* Simple Arrow */}
        <div style={{ position: 'absolute', right: 10, top: 15, pointerEvents: 'none' }}>▼</div>
      </div>
      {selectedToken && (
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 5, gap: 10 }}>
          {selectedToken.logo && <img src={selectedToken.logo} alt="" style={{ width: 24, height: 24, borderRadius: '50%' }} />}
          <span style={{ fontSize: 14, fontWeight: 'bold' }}>{selectedToken.name}</span>
        </div>
      )}
    </div>
  );
};

function App() {
  const { publicKey, signAllTransactions, connected } = useWallet();
  const [activeTab, setActiveTab] = useState('nullify');
  const { signMessage } = useWallet();

  // State
  const [mint, setMint] = useState(''); // Default SOL
  const [amount, setAmount] = useState('');
  const [toMint, setToMint] = useState('');
  const [recipient, setRecipient] = useState('');

  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [balances, setBalances] = useState(null);
  const publicBalances = useMemo(() => balances?.filter(b => b.publicAmount > 0).map(b => ({ ...b, amount: b.publicAmount })), [balances]);
  const privateBalances = useMemo(() => balances?.filter(b => b.privateAmount > 0).map(b => ({ ...b, amount: b.privateAmount })), [balances]);
  const [toTokenMetadata, setToTokenMetadata] = useState(null);
  const [fromTokenMetadata, setFromTokenMetadata] = useState(null);
  const [swapQuote, setSwapQuote] = useState(null);

  // Toast State
  const [showToast, setShowToast] = useState(false);

  const signatureRef = useRef(null);


  const formatAmount = (value, decimals) => {
    if (!value) return '';
    // Remove everything except digits and dots
    let val = value.toString().replace(/[^0-9.]/g, '');
    // Ensure only one decimal point (keep first, discard rest)
    const dotIndex = val.indexOf('.');
    if (dotIndex !== -1) {
      val = val.slice(0, dotIndex + 1) + val.slice(dotIndex + 1).replace(/\./g, '');
    }
    // Trim decimal places to allowed precision
    const parts = val.split('.');
    const intRaw = parts[0] || '0';
    // Add thousand separators to integer part
    const intFormatted = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    // Preserve decimal part exactly as typed (don't round or strip trailing zeros)
    if (parts.length > 1) {
      const decPart = decimals != null ? parts[1].slice(0, decimals) : parts[1];
      return `${intFormatted}.${decPart}`;
    }
    return intFormatted;
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  };

  useEffect(() => {
    if (!connected) {
      setMint('');
      setAmount('');
      setToMint('');
      setRecipient('');
      setBalances(null);
      setToTokenMetadata(null);
      setFromTokenMetadata(null);
      setSwapQuote(null);
    }
    setStatus('');
  }, [connected]);

  useEffect(() => {
    if (toMint && toMint.length > 30 && activeTab === 'swap' && toTokenMetadata?.address !== toMint) {
      // Clear previous data when mint changes
      setToTokenMetadata(null);
      setSwapQuote(null);

      const fetchData = async () => {
        try {
          const metadata = await fetchTokenMetadata(toMint);
          setToTokenMetadata(metadata);

          if (mint && amount) {
            const quote = await fetchSwapQuote(mint, toMint, amount.replace(/,/g, ''));
            setSwapQuote(quote);
          }
        } catch (err) {
          console.error("Error fetching swap data:", err);
        }
      }
      fetchData();
    }
  }, [toMint, activeTab, mint, amount, toTokenMetadata?.address]); // Added dependencies for completeness

  useEffect(() => {
    if (mint && mint.length > 30 && activeTab === 'swap' && fromTokenMetadata?.address !== mint) {
      // Clear previous data when mint changes
      setFromTokenMetadata(null);
      setSwapQuote(null);

      const fetchData = async () => {
        try {
          const metadata = await fetchTokenMetadata(mint); // Corrected to fetch metadata for 'mint'
          setFromTokenMetadata(metadata); // Set fromTokenMetadata

          if (toMint && amount) { // Check toMint as well
            const quote = await fetchSwapQuote(mint, toMint, amount.replace(/,/g, ''));
            setSwapQuote(quote);
          }
        } catch (err) {
          console.error("Error fetching swap data:", err);
        }
      }
      fetchData();
    }
  }, [mint, activeTab, amount, toMint, fromTokenMetadata?.address]); // Added dependencies for completeness

  useEffect(() => {
    // This effect seems to duplicate logic from the two above,
    // but it's kept for now as it was in the original code.
    // It might be redundant if the above two effects cover all cases.
    const fetchData = async () => {
      try {
        if (activeTab === 'swap' && mint && toMint && amount) { // Only fetch if all are present for swap
          const metadataTo = await fetchTokenMetadata(toMint);
          setToTokenMetadata(metadataTo);
          const metadataFrom = await fetchTokenMetadata(mint); // Fetch from token metadata
          setFromTokenMetadata(metadataFrom);

          const quote = await fetchSwapQuote(mint, toMint, amount.replace(/,/g, ''));
          setSwapQuote(quote);
        } else {
          setSwapQuote(null); // Clear quote if conditions not met
        }
      } catch (err) {
        console.error("Error fetching swap data:", err);
        setSwapQuote(null); // Clear quote on error
      }
    }
    fetchData();
  }, [toMint, mint, amount, activeTab]);

  const getPublicBalances = async () => {
    try {
      const pubRes = await axios.post(`${API_URL}/tx/getPublicBalances`, {
        owner: publicKey.toString(),
      });
      return pubRes.data;
    } catch (e) {
      console.log("Error fetching public balances", e);
    }
  }

  // Get Private Balances
  const handleGetBalances = async (silent = false) => {
    if (!publicKey) return setStatus('Connect wallet');
    if (!signMessage) return setStatus('Wallet does not support message signing');

    if (!silent) {
      setIsLoading(true);
      setStatus('Signing message...');
      setBalances(null);
    }

    try {
      const message = new TextEncoder().encode("Reveal Private Balances");
      const signature = signatureRef.current ?? await signMessage(message);
      signatureRef.current = signature;
      const signatureBase58 = bs58.encode(signature);

      if (!silent) setStatus('Fetching balances...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      const res = await axios.post(`${API_URL}/tx/getPrivateBalances`, {
        owner: publicKey.toString(),
        signature: signatureBase58
      });

      let pub = await getPublicBalances();
      let priv = res.data;
      let merged = pub.map(t => ({ ...t, publicAmount: parseFloat(t.amount), privateAmount: 0, amount: parseFloat(t.amount) }));

      for (const token of priv) {
        const existing = merged.find(t => t.address === token.address);
        if (existing) {
          existing.privateAmount = parseFloat(existing.privateAmount ?? 0) + parseFloat(token.amount);
          existing.amount = parseFloat(existing.amount) + parseFloat(token.amount);
        } else {
          merged.push({ ...token, publicAmount: 0, privateAmount: parseFloat(token.amount), amount: parseFloat(token.amount) });
        }
      }

      setBalances(merged);
      setTimeout(() => {
        setMint(activeTab === 'nullify' ? publicBalances?.[0]?.address : activeTab === 'reveal' ? privateBalances?.[0]?.address : merged?.[0]?.address)
      }, 100);

      if (activeTab === 'swap') {
        fetchTokenMetadata(mint).then(setFromTokenMetadata);
      }
      if (!silent) setStatus('Balances fetched successfully');
      setTimeout(() => setStatus(''), 3000);
    } catch (e) {
      console.log(e);
      setStatus(`Error: ${e.response?.data?.error || e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Nullify
  const handleNullify = async () => {
    if (!publicKey) return setStatus('Connect wallet');
    setIsLoading(true);
    setStatus('Requesting transaction...');
    try {
      const res = await axios.get(`${API_URL}/tx/nullify`, {
        params: { owner: publicKey.toString(), mint, amount: amount.replace(/,/g, '') }
      });

      const txs = res.data.transactions.map(tx => VersionedTransaction.deserialize(Buffer.from(tx, 'base64')));
      setStatus('Signing transactions...');
      const signedTxs = await signAllTransactions(txs);

      setStatus('Sending transactions...');
      for (const tx of signedTxs) {
        const sig = await axios.post(`${API_URL}/tx/send`, {
          tx: Buffer.from(tx.serialize()).toString('base64')
        });
        setStatus(`Confirmed: ${sig.data.slice(0, 8)}...`);
      }
      setStatus('Nullify Complete!');

      handleGetBalances(true);
    } catch (e) {
      setStatus(`Error: ${e.response?.data?.error || e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Reveal
  const handleReveal = async () => {
    if (!publicKey) return setStatus('Connect wallet');
    setIsLoading(true);
    setStatus('Requesting transaction...');
    try {
      const res = await axios.get(`${API_URL}/tx/reveal`, {
        params: { owner: publicKey.toString(), mint, amount: amount.replace(/,/g, '') }
      });

      const txs = res.data.transactions.map(tx => VersionedTransaction.deserialize(Buffer.from(tx, 'base64')));
      setStatus('Signing transactions...');
      const signedTxs = await signAllTransactions(txs);

      setStatus('Sending transactions...');
      for (const tx of signedTxs) {
        const sig = await axios.post(`${API_URL}/tx/send`, { tx: Buffer.from(tx.serialize()).toString('base64') });
        setStatus(`Confirmed: ${sig.data.slice(0, 8)}...`);
      }
      setStatus('Reveal Complete!');
      handleGetBalances(true);
    } catch (e) {
      setStatus(`Error: ${e.response?.data?.error || e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Swap
  const handleSwap = async () => {
    if (!publicKey) return setStatus('Connect wallet');
    setIsLoading(true);
    setStatus('Initializing swap...');
    try {
      const res = await axios.get(`${API_URL}/tx/swap`, {
        params: { owner: publicKey.toString(), fromMint: mint, toMint, amount: amount.replace(/,/g, '') }
      });

      const { swapId, transactions } = res.data;
      const txs = transactions.map(tx => VersionedTransaction.deserialize(Buffer.from(tx, 'base64')));

      setStatus('Signing transfer...');
      const signedTxs = await signAllTransactions(txs);
      const signedBase64s = signedTxs.map(tx => Buffer.from(tx.serialize()).toString('base64'));

      setStatus('Executing swap...');
      await axios.post(`${API_URL}/tx/executeSwap`, {
        swapId,
        transactions: signedBase64s
      });

      // Poll status
      const poll = setInterval(async () => {
        const statusRes = await axios.get(`${API_URL}/tx/swapStatus`, { params: { swapId } });
        const s = statusRes.data.status;
        setStatus(`Swap Status: ${s}`);
        if (s === 'completed' || s === 'failed') {
          clearInterval(poll);
          setIsLoading(false);
          handleGetBalances(true);
        }
      }, 2000);

    } catch (e) {
      console.log(e);
      setStatus(`Error: ${e.response?.data?.error || e.message}`);
      setIsLoading(false);
    }
  };

  // Transfer
  const handleTransfer = async () => {
    if (!publicKey) return setStatus('Connect wallet');
    setIsLoading(true);
    setStatus('Requesting transfer...');
    try {
      const res = await axios.get(`${API_URL}/tx/transfer`, {
        params: { owner: publicKey.toString(), mint, amount: amount.replace(/,/g, ''), recipient }
      });

      const txs = res.data.transactions.map(tx => VersionedTransaction.deserialize(Buffer.from(tx, 'base64')));
      setStatus('Signing transfer...');
      const signedTxs = await signAllTransactions(txs);

      setStatus('Sending transaction...');
      for (const tx of signedTxs) {
        const sig = await axios.post(`${API_URL}/tx/send`, { tx: Buffer.from(tx.serialize()).toString('base64') });
        setStatus(`Confirmed: ${sig.data.slice(0, 8)}...`);
      }
      setStatus('Transfer Complete!');
      handleGetBalances(true);
    } catch (e) {
      setStatus(`Error: ${e.response?.data?.error || e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const balancesForTab = useMemo(() => {
    if (activeTab === 'nullify') return publicBalances;
    if (activeTab === 'reveal') return privateBalances;
    if (activeTab === 'swap') return balances;
    if (activeTab === 'transfer') return balances;
    if (activeTab === 'balances') return publicBalances?.concat(privateBalances ?? []);
    return [];
  },[activeTab, balances])

  return (
    <div style={{ padding: 20, maxWidth: 600, margin: '0 auto', fontFamily: 'sans-serif', position: 'relative' }}>

      {/* Toast Notification */}
      {showToast && (
        <div style={{
          position: 'fixed',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.8)',
          color: '#fff',
          padding: '10px 20px',
          borderRadius: 20,
          fontSize: 14,
          zIndex: 1000
        }}>
          Copied!
        </div>
      )}

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1>NullTrace Local</h1>
        <WalletMultiButton />
      </header>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        {['nullify', 'reveal', 'swap', 'transfer', 'balances'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 20px',
              background: activeTab === tab ? '#333' : '#eee',
              color: activeTab === tab ? '#fff' : '#333',
              border: 'none',
              borderRadius: 5,
              cursor: 'pointer'
            }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
        <button
          onClick={handleGetBalances}
          disabled={isLoading}
          style={{
            padding: '10px 20px',
            background: '#6e0181ff',
            color: '#fff',
            border: 'none',
            borderRadius: 5,
            cursor: isLoading ? 'not-allowed' : 'pointer',
            fontWeight: 'bold'
          }}
        >
          {isLoading ? '...' : signatureRef.current ? 'Refresh' : 'Unlock'}
        </button>
      </div>

      <div style={{ background: '#f5f5f5', padding: 20, borderRadius: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Replaced Mint Input with TokenDropdown */}
          {activeTab !== 'balances' && balances && <TokenDropdown
            balances={balancesForTab}
            selectedMint={mint}
            onSelect={setMint}
            emptyMessage={
              activeTab === 'nullify' ? 'NO PUBLIC BALANCES' :
                activeTab === 'reveal' ? 'NO PRIVATE BALANCES' :
                  'NO BALANCES'
            }
          />}

          {!balances ? (
            <p style={{ marginBottom: 15 }}>{!connected ? 'Connect Wallet' : `Click 'Unlock' to reveal your private balances.`}</p>
          ) : (
            <div>

              {activeTab === 'swap' && (
                <div style={{ marginBottom: 20, marginRight: 20 }}>
                  <span>
                    <label>To Mint</label>
                    {' '}
                    <text style={{ color: '#570a59', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => setToMint(NATIVE_MINT.toString())}>SOL</text>
                    {' '}
                    <text style={{ color: '#570a59', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => setToMint(USDT_MINT)}>USDT</text>
                    {' '}
                    <text style={{ color: '#570a59', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => setToMint(NULL_MINT)}>NULL</text>
                  </span>
                  <input
                    value={toMint}
                    onChange={e => setToMint(e.target.value)}
                    placeholder="Output Token Address"
                    style={{ width: '100%', padding: 8, marginTop: 5 }}
                  />

                  {toTokenMetadata && toTokenMetadata.symbol && (
                    <div style={{ marginTop: 10, padding: 10, background: '#fff', borderRadius: 5, border: '1px solid #ddd', display: 'flex', alignItems: 'center', gap: 10 }}>
                      {toTokenMetadata.logo && <img src={toTokenMetadata.logo} alt="" style={{ width: 32, height: 32, borderRadius: '50%' }} />}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 'bold' }}>{toTokenMetadata.name} {toTokenMetadata.symbol ? `(${toTokenMetadata.symbol})` : ''}</div>
                        {toTokenMetadata.dexscreener && (
                          <a href={toTokenMetadata.dexscreener} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#007bff' }}>View on DexScreener</a>
                        )}
                      </div>
                    </div>
                  )}

                  {swapQuote && (
                    <div style={{ marginTop: 10, padding: 10, background: '#e6fffa', borderRadius: 5, border: '1px solid #b2f5ea' }}>
                      <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 5 }}>Swap Quote</div>
                      <div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                        <span>In: {(parseFloat(swapQuote.inAmount) / (10 ** (balances?.find(b => b.address === mint)?.decimals ?? 9))).toLocaleString()} {balances?.find(b => b.address === mint)?.symbol || 'SOL'}</span>
                        <span>Out: {(parseFloat(swapQuote.outAmount) / 10 ** (toTokenMetadata?.decimals || 6)).toLocaleString()} {toTokenMetadata?.symbol}</span>
                      </div>
                      <div style={{ fontSize: 12, color: swapQuote.priceImpact < -5 ? 'red' : 'green', marginTop: 3 }}>
                        Price Impact: {parseFloat(swapQuote.priceImpact).toFixed(2)}%
                      </div>
                      <div style={{ fontSize: 11, color: '#666', marginTop: 3 }}>
                        Router: {swapQuote.swapContext?.router || 'Jupiter'} via {swapQuote.routePlan?.[0]?.swapInfo?.label || 'Direct'}
                      </div>
                    </div>
                  )}

                </div>
              )}
              {activeTab === 'transfer' && (
                <div style={{ marginBottom: 20, marginRight: 20 }}>
                  <label>Recipient Address</label>
                  <input
                    value={recipient}
                    onChange={e => setRecipient(e.target.value)}
                    placeholder="Receiver's Solana Address"
                    style={{ width: '100%', padding: 8, marginTop: 5 }}
                  />
                </div>
              )}
              {activeTab !== 'balances' && <div style={{ marginTop: 10, marginBottom: 10, paddingRight: 20 }}>
                <style>
                  {`
                    input[type=number]::-webkit-inner-spin-button, 
                    input[type=number]::-webkit-outer-spin-button { 
                      -webkit-appearance: none; 
                      margin: 0; 
                    }
                  `}
                </style>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>Amount</label>
                  {(() => {
                    const selected = balancesForTab?.find(b => b.address === mint);
                    if (selected) {
                      return (
                        <span
                          onClick={() => setAmount(formatAmount(selected.amount, selected.decimals))}
                          style={{ fontSize: 14, color: '#0ea5e9', cursor: 'pointer', fontWeight: 'bold' }}
                        >
                          Bal: {parseFloat(selected.amount).toLocaleString(undefined, { maximumFractionDigits: selected.decimals })}
                        </span>
                      );
                    }
                    return null;
                  })()}
                </div>
                <input
                  type="text"
                  value={amount}
                  onChange={e => setAmount(formatAmount(e.target.value, (activeTab === 'nullify' ? publicBalances : activeTab === 'reveal' ? balances : (publicBalances ?? []).concat(balances ?? [])).find(b => b.address === mint)?.decimals))}
                  style={{ width: '100%', padding: 8, marginTop: 5 }}
                />
              </div>}
              {activeTab !== 'balances' && <button
                onClick={
                  activeTab === 'nullify' ? handleNullify :
                    activeTab === 'reveal' ? handleReveal :
                      activeTab === 'swap' ? handleSwap :
                        handleTransfer
                }
                disabled={isLoading}
                style={{
                  padding: 15,
                  background: '#000',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 5,
                  marginTop: 10,
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  width: '100%'
                }}
              >
                {isLoading ? 'Processing...' : activeTab.toUpperCase()}
              </button>}

              {activeTab === 'balances' && (
                <div>

                  {publicBalances && (
                    <div style={{ marginTop: 20 }}>
                      <h3>Public Balances</h3>
                      <div style={{ background: '#fff', padding: 10, borderRadius: 5 }}>
                        {/* <p><strong>SOL:</strong> {balances.sol.toFixed(9)}</p> */}
                        {publicBalances.map((t, i) => (
                          <div key={i} style={{ borderBottom: i === publicBalances.length - 1 ? 'none' : '1px solid #eee', padding: '15px 0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                              {t.logo && <img src={t.logo} alt="" style={{ width: 36, height: 36, borderRadius: '50%' }} />}
                              <span style={{ fontSize: 18, fontWeight: 'bold' }}>${t.symbol} - {t.name}</span>
                            </div>
                            <div style={{ fontSize: 14, lineHeight: '1.6' }}>
                              <p><strong>Balance:</strong> {parseFloat(t.amount).toLocaleString()}</p>
                              <p
                                onClick={() => handleCopy(t.address)}
                                style={{ cursor: 'pointer', color: '#666', wordBreak: 'break-all' }}
                              >
                                <strong>CA:</strong> {t.address}
                              </p>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 15 }}>
                              {['nullify', 'swap', 'transfer'].map(action => (
                                <button
                                  key={action}
                                  onClick={() => {
                                    setMint(t.address);
                                    if (action === 'swap') {
                                      fetchTokenMetadata(mint).then(setFromTokenMetadata);
                                    }
                                    setActiveTab(action);
                                  }}
                                  style={{
                                    padding: '6px 16px',
                                    background: '#333',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: 4,
                                    cursor: 'pointer',
                                    fontSize: 12,
                                    fontWeight: '600'
                                  }}
                                >
                                  {action.charAt(0).toUpperCase() + action.slice(1)}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {privateBalances && (
                    <div style={{ marginTop: 20 }}>
                      <h3>Private Balances</h3>
                      <div style={{ background: '#fff', padding: 10, borderRadius: 5 }}>
                        {/* <p><strong>SOL:</strong> {balances.sol.toFixed(9)}</p> */}
                        {privateBalances.map((t, i) => (
                          <div key={i} style={{ borderBottom: i === balances.length - 1 ? 'none' : '1px solid #eee', padding: '15px 0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                              {t.logo && <img src={t.logo} alt="" style={{ width: 36, height: 36, borderRadius: '50%' }} />}
                              <span style={{ fontSize: 18, fontWeight: 'bold' }}>${t.symbol} - {t.name}</span>
                            </div>
                            <div style={{ fontSize: 14, lineHeight: '1.6' }}>
                              <p><strong>Balance:</strong> {parseFloat(t.amount).toLocaleString()}</p>
                              <p
                                onClick={() => handleCopy(t.address)}
                                style={{ cursor: 'pointer', color: '#666', wordBreak: 'break-all' }}
                              >
                                <strong>CA:</strong> {t.address}
                              </p>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 15 }}>
                              {['reveal', 'swap', 'transfer'].map(action => (
                                <button
                                  key={action}
                                  onClick={() => {
                                    setMint(t.address);
                                    if (action === 'swap') {
                                      fetchTokenMetadata(mint).then(setFromTokenMetadata);
                                    }
                                    setActiveTab(action);
                                  }}
                                  style={{
                                    padding: '6px 16px',
                                    background: '#333',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: 4,
                                    cursor: 'pointer',
                                    fontSize: 12,
                                    fontWeight: '600'
                                  }}
                                >
                                  {action.charAt(0).toUpperCase() + action.slice(1)}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>
          )}

          {status && (
            <div style={{ marginTop: 20, padding: 10, background: '#e0e0e0', borderRadius: 5 }}>
              <code>{status}</code>
            </div>
          )}
        </div>
      </div>

      <footer style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 16,
        marginTop: 30,
        paddingBottom: 24
      }}>
        {[
          { label: 'X', href: 'https://x.com/nulltracebot' },
          { label: 'Telegram', href: 'https://t.me/nulltracechat' },
          { label: 'Website', href: 'https://nulltrace.app' },
          { label: 'GitHub', href: 'https://github.com/nulltracebot' },
        ].map(link => (
          <a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '8px 20px',
              background: '#222',
              color: '#fff',
              borderRadius: 6,
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: '600',
              transition: 'background 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#6e0181'}
            onMouseLeave={e => e.currentTarget.style.background = '#222'}
          >
            {link.label}
          </a>
        ))}
      </footer>
    </div>
  );
}

export default App;