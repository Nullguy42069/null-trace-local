import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { CoinbaseWalletAdapter, LedgerWalletAdapter, PhantomWalletAdapter, SolflareWalletAdapter, TrustWalletAdapter, WalletConnectWalletAdapter, XDEFIWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';

import '@solana/wallet-adapter-react-ui/styles.css';

const endpoint = "https://api.mainnet-beta.solana.com"; // User can change this in code

const wallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
  new WalletConnectWalletAdapter(),
  new CoinbaseWalletAdapter(),
  new LedgerWalletAdapter(),
  new TrustWalletAdapter(),
  new XDEFIWalletAdapter()
];

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </React.StrictMode>,
)
