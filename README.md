# Zapp — Conversational Payments on Celo

> Send money as easy as sending a message.

Zapp is a Telegram payment bot built on the Celo blockchain.
Send CELO and USDC, split bills, manage esusu savings circles,
and soon — top up and cash out in your local African currency,
all by simply chatting. No app install, no seed phrases, no
technical knowledge required.

[![Live Bot](https://img.shields.io/badge/Telegram-@ZappAgent__bot-blue?logo=telegram)](https://t.me/ZappAgent_bot)
[![Website](https://img.shields.io/badge/Website-zapp.africinnovate.com-green)](https://zapp.africinnovate.com)
[![Network](https://img.shields.io/badge/Network-Celo%20Sepolia-yellow)](https://celo-sepolia.blockscout.com)
[![Agent](https://img.shields.io/badge/ERC--8004-AgentScan-purple)](https://agentscan.info/agents/74c68262-a2ec-425c-9eb1-d214b450b5b1)

---

## Features

### Available Now
- **Send payments** — Send CELO or USDC to any Telegram 
  user or wallet address
- **Split bills** — Split expenses equally or with custom amounts
- **Esusu circles** — Create and manage group savings circles 
  on-chain
- **Auto wallet creation** — New users get a Celo wallet 
  instantly on /start
- **Identity verification** — Fraud-proof KYC via Self Protocol 
  passport verification
- **Receipts** — PNG and PDF receipts after every transaction
- **Faucet** — Built-in USDC testnet faucet for new users

### Coming Soon
- **Multi-token support** — cKES, cNGN, cGHS, cUSD, USDT and more
- **On-ramp** — Fund your wallet with Naira, Cedis, Shillings, 
  or mobile money (M-Pesa, MTN MoMo) directly in Telegram
- **Off-ramp** — Cash out to local bank account or mobile money 
  wallet from the chat
- **Multi-chain** — Expand beyond Celo to other EVM chains
- **B2B API** — Let other apps embed Zapp's payment rails

---

## How It Works

### Sending Money
1. User sends `/start` to [@ZappAgent_bot](https://t.me/ZappAgent_bot)
2. Zapp creates a Celo wallet automatically
3. User completes Self Protocol identity verification once
4. User sends money by chatting naturally
```
"send 1 CELO to @john"
"split 20 USDC with @mary and @james"
"what's my balance"
"create a savings circle called Lagos Squad"
```

### On-Ramp / Off-Ramp (Roadmap)
```
"top up 5000 Naira"          → receive USDC in wallet
"cash out 10 USDC to M-Pesa" → receive local currency
"send 500 Cedis to @kofi"    → auto-converts and sends
```

---

## Vision

Zapp's mission is to make decentralized payments as natural
as texting, starting with Africa. The roadmap goes beyond
crypto-to-crypto — we're building the rails for anyone to
move seamlessly between local currencies and on-chain assets,
without ever leaving Telegram.

Target currencies: NGN, GHS, KES, TZS, UGX, ZAR, XOF, XAF
Target integrations: Yellow Card, Kotani Pay, Transak, M-Pesa

---

## Tech Stack

| Layer | Technology |
|---|---|
| Bot framework | OpenClaw agent framework |
| Blockchain | Celo (CELO + USDC, expanding) |
| Identity | Self Protocol |
| Backend | Node.js + Express |
| Database | better-sqlite3 |
| Smart contracts | Solidity (EsusuCircle, SplitPayment) |
| Agent registry | ERC-8004 |
| On/Off-ramp (roadmap) | Yellow Card / Kotani Pay / Transak |

---

## Project Structure
```
zapp/
├── backend/
│   ├── routes/         # API endpoints
│   ├── services/       # Celo, Self Protocol, receipts
│   ├── db/             # SQLite schema and queries
│   └── server.js       # Express server
├── contracts/
│   ├── contracts/      # Solidity smart contracts
│   ├── scripts/        # Deployment scripts
│   └── test/           # Contract tests
└── openclaw/
    └── workspace-zapp-payment/
        ├── SOUL.md     # Agent personality and rules
        ├── TOOLS.md    # Backend API reference
        └── skills/     # Agent skill functions
```

---

## Getting Started

### Prerequisites
- Node.js v20+
- Telegram bot token from [@BotFather](https://t.me/BotFather)
- OpenClaw CLI installed
- Celo Sepolia RPC access

### Installation
```bash
# Clone the repo
git clone https://github.com/yourusername/zapp.git
cd zapp

# Install backend dependencies
cd backend && npm install

# Copy environment variables
cp .env.example .env
# Fill in your values

# Initialize the database
node -e "import('./db/index.js').then(m => m.initDB())"

# Start the backend
pm2 start server.js --name zapp-backend

# Start the OpenClaw gateway
openclaw gateway --force
```

### Environment Variables
```env
BACKEND_URL=https://your-domain.com
DB_PATH=./db/zapp.sqlite
SELF_WEBHOOK_SECRET=your-webhook-secret
PRIVATE_KEY=your-celo-wallet-private-key
```

---

## Smart Contracts

| Contract | Address (Celo Sepolia) |
|---|---|
| SplitPayment | `0xa08C0955FE916aF5837dE7f7d9F5306C3892543a` |
| EsusuCircle | `0xaA88693dA1437450E62844697FB4fEBFd0a73F27` |
| USDC (mock) | `0x7eE404CC53c1cdAd82dB9627d18e96fe16C3C823` |
---

## Network

- **Network:** Celo Sepolia Testnet
- **Chain ID:** 11142220
- **Explorer:** https://celo-sepolia.blockscout.com
- **Faucet:** https://faucet.celo.org/celo-sepolia

---

## Roadmap

- [x] Wallet creation on onboarding
- [x] Self Protocol identity verification
- [x] CELO and USDC transfers
- [x] Equal bill splitting
- [x] Esusu savings circles
- [x] PNG and PDF receipts
- [x] Testnet faucet
- [x] ERC-8004 agent registration
- [x] Custom split amounts
- [ ] Mainnet launch + security audit
- [ ] Multi-token: cKES, cNGN, cGHS, cUSD, USDT
- [ ] On-ramp: Naira, Cedis, Shillings, M-Pesa, MTN MoMo
- [ ] Off-ramp: local bank + mobile money cashout
- [ ] Multi-chain expansion
- [ ] B2B API and developer SDK
- [ ] Multi-language support (Swahili, Hausa, Yoruba, French)

---

## Contributing

PRs welcome. Please open an issue first to discuss what
you'd like to change.

---

## Built With

- [Celo](https://celo.org) — Mobile-first blockchain
- [Self Protocol](https://self.xyz) — Decentralized identity
- [OpenClaw](https://openclaw.ai) — AI agent framework
- [Telegram Bot API](https://core.telegram.org/bots/api)

---

## License

[MIT](https://github.com/gconnect/zapp/blob/main/LICENSE)

---

<p align="center">
  Built with love for Africa 🌍
  <br/>
  <a href="https://t.me/ZappAgent_bot">Try Zapp on Telegram</a>
  ·
  <a href="https://zapp.africinnovate.com">Website</a>
  ·
  <a href="https://agentscan.info/agents/74c68262-a2ec-425c-9eb1-d214b450b5b1">Agent Registry</a>
</p>
