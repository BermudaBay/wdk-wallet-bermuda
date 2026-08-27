# Agent Guide

This repository is part of the Tether WDK (Wallet Development Kit) ecosystem. It follows strict coding conventions and tooling standards to ensure consistency, reliability, and cross-platform compatibility (Node.js and Bare runtime).

## Project Overview
- **Architecture:** Modular architecture with clear separation between Core, Wallet managers, and Protocols.
- **Runtime:** Supports both Node.js and Bare runtime.

## Tech Stack & Tooling
- **Language:** JavaScript (ES2015+).
- **Module System:** ES Modules (`"type": "module"` in package.json).
- **Type Checking:** TypeScript is used purely for generating type declarations (`.d.ts`). The source code remains JavaScript.
  - Command: `npm run build:types`
- **Linting:** `standard` (JavaScript Standard Style).
  - Command: `npm run lint` / `npm run lint:fix`
- **Testing:** `jest` (configured with `experimental-vm-modules` for ESM support).
  - Command: `npm test` (everything), `npm run test:integration` (integration only)
  - Two categories, both gated at 90% by the single global threshold in `jest.config.js`:
    **unit** (directly under `tests/`, fully mocked) and **integration** (under
    `tests/integration/`, real nodes and the real SDK).
  - The integration suites **fork plasma-testnet and need network access**. That chain is
    used because it is the only one whose SDK config carries a wrapped-native token
    (`WXPL`); the deposit path branches on it and the branch is unreachable on `testenv`.
    The RPC endpoint defaults to the one the installed `@bermuda/sdk` is built against and
    is overridable with `PLASMA_TESTNET_RPC_URL`. Proving makes them slow — roughly ten
    seconds per shielded operation.
  - **Requires Node.js >= 22** (see `.nvmrc` / `devEngines` in package.json). The floor comes
    from Hardhat: `@nomicfoundation/edr` declares `engines: { node: ">= 22" }`. This is a
    test-toolchain floor only — the published library itself supports older Node.
- **Dependencies:** `cross-env` is consistently used for environment variable management in scripts.

## Coding Conventions
- **File Naming:** Kebab-case (e.g., `wallet-manager.js`).
- **Class Naming:** PascalCase (e.g., `WdkManager`).
- **Private Members:** Prefixed with `_` (underscore) and explicitly documented with `@private`.
- **Imports:** Explicit file extensions are mandatory (e.g., `import ... from './file.js'`).
- **Copyright:** All source files must include the standard Tether copyright header.

## Documentation (JSDoc)
Source code must be strictly typed using JSDoc comments to support the `build:types` process.
- **Types:** Use `@typedef` to define or import types.
- **Methods:** Use `@param`, `@returns`, `@throws`.
- **Generics:** Use `@template`.

## Development Workflow
0.  **Use the pinned Node:** `nvm use` (reads `.nvmrc`; requires Node >= 22)
1.  **Install:** `npm ci` (prefer `ci` over `install` so the lockfile is honoured exactly)
2.  **Lint:** `npm run lint`
3.  **Test:** `npm test`
4.  **Build Types:** `npm run build:types`

### Troubleshooting

#### `HHE200: Plugin "builtin:coverage" is not installed` — **fixed**
This error is **misleading — it is not a missing dependency.** On Node < 24.9.0, Jest's
`--experimental-vm-modules` ESM loader fails to link `zod`'s `./v3/external.js` while Hardhat
dynamically imports its builtin plugin hook handlers. Hardhat catches the failure, runs
`detectPluginNpmDependencyProblems()` to diagnose it, that diagnostic fails too, and the real
cause gets buried. It is visible in the `Cause:` section of the stack trace:
`request for './v3/external.js' is from a module not been linked`.

**This is fixed** by the `moduleNameMapper` entry in `jest.config.js`, which routes `zod`
through its CommonJS build and so bypasses the ESM linker entirely. Every package in the tree
imports bare `zod` (no deep subpaths), so all consumers share one copy. Node 22.0.0 through
24.8.x now run the full suite; do not remove that mapping without re-testing on Node < 24.9.

#### `Cannot find native binding. npm has a bug related to optional dependencies...`
Also misleading — **it is not an npm bug and deleting `package-lock.json` will not help.** It
means Node < 22. `@nomicfoundation/edr` and its platform binding packages declare
`engines: { node: ">= 22" }`, so npm correctly *skips* the native binding as an unmet optional
dependency. This is Hardhat's own floor and cannot be worked around here.

**Fix for both:** `nvm use && npm ci`. `tests/setup/check-node-version.js` (wired via Jest
`globalSetup`) fails fast with a clear message below Node 22.

Only the suites that `import { network } from 'hardhat'` are affected by either issue
(`tests/wallet-account-evm.test.js` and everything under `tests/integration/`), which is why
it looks like "only a few tests" fail.

#### Integration test helpers
`tests/integration/helpers/` holds the fork harness. Three things there are load-bearing and
easy to break:
- **`fork.js` sets `chainId: 9746` explicitly.** EDR keeps the *configured* chain id when
  forking, so without it the node reports 31337 and `chainIdToName` resolves to `testenv`.
- **`startFork()` mines a block immediately.** EDR has no hardfork activation history for
  chain 9746 and refuses to execute calls while `latest` is still the fork block.
- **All funding goes through a faucet account, never the account under test.** ethers caches
  `eth_getTransactionCount` briefly, so a setup transaction sent by the wallet under test
  leaves its next signed transaction reusing a spent nonce. The faucet key is repo-specific
  for the same reason: the well-known Hardhat dev keys have real transaction histories on
  public testnets, and a fork inherits their nonces.
