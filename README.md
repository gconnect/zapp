# CeloPay

Conversational Celo payment app on Telegram. Users send USDC, split bills, and manage esusu savings circles by chatting with a bot — no app install required.

## Stack
- **Agent**: OpenClaw (3 agents: personal/Discord, payment/Telegram, admin/Telegram)
- **Blockchain**: Celo Alfajores testnet (USDC)
- **Identity**: Self Protocol (ZK verification)
- **Payments**: x402 protocol for API gating
- **Registry**: ERC-8004 agent identity
- **Backend**: Node.js + Express + SQLite

## Project Structure
```
celopay/
├── contracts/       # Hardhat — EsusuCircle, SplitPayment, CeloPayRegistry
├── backend/         # Express server — webhooks, receipts, blockchain services
└── openclaw/        # Agent workspaces — SOUL.md, skills, gateway config
```

## Quick Start

### 1. Contracts (deploy to Alfajores)
```bash
cd contracts
npm install
cp .env.example .env   # add DEPLOYER_PRIVATE_KEY
npx hardhat test       # run contract tests
npx hardhat run scripts/deploy.js --network alfajores
```

### 2. Backend
```bash
cd backend
npm install
cp .env.example .env   # fill in all values
node server.js
```

### 3. OpenClaw
```bash
# Copy workspace directories to ~/.openclaw/
cp -r openclaw/workspace-payment ~/.openclaw/
cp -r openclaw/workspace-admin ~/.openclaw/
cp openclaw/gateway/openclaw.json ~/.openclaw/

# Edit openclaw.json — add your real bot tokens and Telegram user ID
openclaw gateway restart
```

### 4. Telegram Setup
- Create @YourPayBot via @BotFather → set token in openclaw.json
- Create @YourAdminBot via @BotFather → set token + your Telegram ID in allowlist
- For group esusu circles: add @YourPayBot to group, disable privacy mode in BotFather

## User Commands (natural language)
| Say | Action |
|-----|--------|
| "what's my balance" | Check USDC balance |
| "send peter 5 cusd" | Send to @peter |
| "split 100 btw james and john" | Equal split |
| "my circles" | View esusu status |
| "join circle #3" | Join savings circle |
| "create circle" | Start new esusu |
| "pay esusu" | Contribute current round |

## Admin Commands (admin bot only)
- "show transactions today"
- "show failed transactions"
- "user info @username"
- "flag user @username"
- "list all circles"
- "who hasn't paid in [circle name]"
- "stats"

## Faucet (Alfajores testnet)
Get test CELO: https://faucet.celo.org/alfajores

## Moving to Antigravity
When ready, `git push` each workspace separately:
```bash
cd backend && git init && git remote add origin <backend-repo-url> && git push
cd contracts && git init && git remote add origin <contracts-repo-url> && git push
# Each openclaw workspace also gets its own repo
```
