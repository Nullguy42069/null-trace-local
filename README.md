# NullTrace Local

**NullTrace Local** is a privacy-focused Solana transaction interface powered by [Light Protocol](https://www.lightprotocol.com/) ZK compression technology. It allows users to nullify (compress), reveal (decompress), swap, and transfer tokens privately -- all from a local-first application.

## Features

- **Nullify** -- Convert public tokens into private, ZK-compressed state
- **Reveal** -- Decompress private tokens back to public state
- **Private Swap** -- Swap tokens without exposing your main wallet's transaction history
- **Private Transfer** -- Send compressed tokens to any Solana address
- **Local Privacy** -- Transaction history is stored locally on your machine only

## Architecture

```
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│   Client (React) │  <--->  │  Local Server     │  <--->  │  Remote Operator  │
│   localhost:5173  │         │  localhost:3003   │         │  (NullTrace Infra)│
└──────────────────┘         └──────────────────┘         └──────────────────┘
        │                            │
   Wallet Adapter            Light Protocol SDK
   (Phantom, etc.)           Solana RPC
```

- **Client**: React + Vite frontend with Solana Wallet Adapter
- **Local Server**: Pre-built Node.js backend that constructs transactions and interfaces with Light Protocol
- **Remote Operator**: NullTrace infrastructure that handles privileged swap operations (no private keys stored locally)

## Prerequisites

- **Node.js** v18 or higher
- **npm** v9 or higher
- A Solana wallet (Phantom, Solflare, etc.)

## Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/NullTraceBot/null-trace-local.git
   cd null-trace-local
   ```

2. **Launch the app for your OS**

   | OS | How to start |
   |----|-------------|
   | **Windows** | Double-click **`start.bat`** |
   | **macOS** | Double-click **`start.command`** |
   | **Linux** | Run `chmod +x start.sh && ./start.sh` in a terminal |

   The start script will automatically:
   - Install dependencies for both server and client
   - Create a default `.env` config if one doesn't exist
   - Start the local API server on port 3003
   - Start the web interface on port 5173

3. **Open the app**
   - Navigate to **http://localhost:5173**
   - Connect your Solana wallet
   - Click **Unlock** to reveal your balances

## Manual Setup

If you prefer to run components individually:

### Server
```bash
cd server
npm install --omit=dev
cp .env.example .env   # Edit .env to customize RPC, port, etc.
npm start
```

### Client
```bash
cd client
npm install
npm run dev
```

## Configuration

### Server Environment (`server/.env`)

| Variable  | Default                                | Description                    |
|-----------|----------------------------------------|--------------------------------|
| `PORT`    | `3003`                                 | Port for the local API server  |
| `RPC_URL` | `https://api.mainnet-beta.solana.com`  | Solana RPC endpoint            |

> **Tip**: The default public RPC endpoint has rate limits. For better performance, use a dedicated RPC provider like [Helius](https://helius.dev), [QuickNode](https://quicknode.com), or [Triton](https://triton.one).

## Usage Guide

### Nullify (Public -> Private)
Converts public tokens into ZK-compressed private state. Your tokens become invisible on block explorers.

### Reveal (Private -> Public)
Decompresses private tokens back to your public wallet. Useful when you need to interact with DeFi protocols.

### Swap
Swap tokens privately through the NullTrace operator. Your swap history is not linked to your main wallet.

### Transfer
Send compressed tokens directly to another Solana address in private form.

### Balances
View both your public and private token balances side-by-side.

## Project Structure

```
null-trace-local/
├── client/               # React frontend
│   ├── src/
│   │   ├── App.jsx       # Main application component
│   │   └── main.jsx      # Entry point with wallet providers
│   ├── public/
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── server/               # Node.js backend
│   ├── dist/
│   │   └── server.js     # Pre-built server bundle
│   ├── .env.example
│   └── package.json
├── sdk/                  # JavaScript SDK (npm package)
│   ├── src/
│   │   └── index.js      # SDK source
│   ├── package.json
│   └── README.md
├── start.bat             # Windows  - double-click to launch
├── start.command          # macOS    - double-click to launch
├── start.sh              # Linux    - run in terminal
├── LICENSE
└── README.md
```

## Security Notes

- **No private keys are stored locally.** The local server never holds or generates wallet private keys.
- **Transaction history** is stored in a local `db/swaps.json` file on your machine only.
- **Wallet signing** is always done client-side through your browser wallet extension.
- **The server bundle** is a pre-built binary that communicates with NullTrace operator infrastructure for swap execution.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `Server bundle not found` | Ensure you cloned the full repository including `server/dist/server.js` |
| `ECONNREFUSED on port 3003` | Make sure the server is running before using the client |
| `Rate limit errors` | Configure a dedicated RPC provider in `server/.env` |
| `Wallet not connecting` | Ensure you have a Solana wallet extension installed (Phantom, Solflare, etc.) |
| `Insufficient balance` | Check that you have enough tokens in the correct state (public vs private) |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

> **Note**: The server source code (`server/src/`) is not included in this repository. Contributions to the server should be discussed in an issue first.

## SDK

NullTrace ships a standalone JavaScript SDK for integrating privacy features into your own apps — no local server needed:

```bash
npm install nulltrace-sdk @solana/web3.js @solana/spl-token @lightprotocol/stateless.js @lightprotocol/compressed-token
```

```js
import { NullTrace } from 'nulltrace-sdk';

const nt = new NullTrace('https://mainnet.helius-rpc.com/?api-key=YOUR_KEY', wallet);

await nt.nullify('So11...', '0.5');
await nt.reveal('So11...', '0.5');
await nt.transfer('So11...', '1.0', 'Recipient...');
await nt.swap('So11...', 'Es9v...', '1.0');
const balances = await nt.getBalances();
```

> Requires a [Helius](https://helius.dev) RPC endpoint (ZK compression depends on Helius's photon indexer).

Full documentation: [**sdk/README.md**](sdk/README.md)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Links

- [NullTrace](https://nulltrace.app) -- Official website
- [Light Protocol](https://www.lightprotocol.com/) -- ZK compression for Solana
- [Solana Wallet Adapter](https://github.com/solana-labs/wallet-adapter) -- Wallet integration
