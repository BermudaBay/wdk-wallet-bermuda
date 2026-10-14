# Agent Guide

This repository is part of the Tether WDK (Wallet Development Kit) ecosystem. It follows strict coding conventions and tooling standards to ensure consistency, reliability, and cross-platform compatibility (Node.js and Bare runtime).

## Project Overview
- **Architecture:** Modular architecture with clear separation between Core, Wallet managers, and Protocols.
- **Runtime:** Node.js and Bare. Bare loads `bare.js` (the `bare` export condition), which
  adds what the Bermuda SDK's prover (`@aztec/bb.js`) needs beyond `bare-node-runtime`; see
  [Bare](#bare) below. `npm run test:bare` and `tests/integration/bare.test.js` are the evidence
  that it works: keep both passing. WDK worklet bundles are not supported yet (see README).

## Tech Stack & Tooling
- **Language:** JavaScript (ES2015+).
- **Module System:** ES Modules (`"type": "module"` in package.json).
- **Type Checking:** TypeScript is used purely for generating type declarations (`.d.ts`). The source code remains JavaScript.
  - Command: `npm run build:types`
- **Linting:** `standard` (JavaScript Standard Style).
  - Command: `npm run lint` / `npm run lint:fix`
- **Testing:** `jest` (configured with `experimental-vm-modules` for ESM support).
  - Command: `npm test` (everything), `npm run test:integration` (integration only),
    `npm run test:bare` (the package under Node.js and Bare, from the checkout and packed; a
    plain script, `tests/bare/run.js`, not a Jest suite; needs network access to install the
    packed package and, on first use, to download the prover's CRS)
  - Two categories, both gated at 90% by the single global threshold in `jest.config.js`:
    **unit** (directly under `tests/`, fully mocked) and **integration** (under
    `tests/integration/`, real nodes and the real SDK).
  - The integration suites **fork plasma-testnet and need network access**. That chain is
    used because it is the only one whose SDK config carries a wrapped-native token
    (`WXPL`); the deposit path branches on it and the branch is unreachable on `testenv`.
    The RPC endpoint defaults to the first public node the installed `@bermuda/sdk` knows for
    the chain (`rpcChainOf(9746)`) and is overridable with `PLASMA_TESTNET_RPC_URL`. Deposits
    are still vetted by the deployment's hosted compliance engine. Proving makes them slow —
    a few seconds per shielded operation, more for the first.
  - **Requires Node.js >= 22** (see `.nvmrc` / `devEngines` in package.json). The floor comes
    from Hardhat: `@nomicfoundation/edr` declares `engines: { node: ">= 22" }`. This is a
    test-toolchain floor only — the published library itself needs Node >= 20.19 (`engines`),
    the floor of the SDK's `@noble` dependencies.
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
4.  **Test under Bare:** `npm run test:bare`
5.  **Build Types:** `npm run build:types`

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
`tests/integration/helpers/` holds the fork harness. These things there and in the suites are
load-bearing and easy to break:
- **`fork.js` sets `chainId: 9746` explicitly.** EDR keeps the *configured* chain id when
  forking, so without it the node reports 31337 and `chainIdToName` resolves to `testenv`.
- **`FORK_BLOCK_NUMBER` follows the deployment the installed SDK targets.** A fork from
  before its pool's `startBlock` has no pool; after an SDK upgrade that moves the deployment,
  move the pin too.
- **`startFork()` mines a block immediately.** EDR has no hardfork activation history for
  chain 9746 and refuses to execute calls while `latest` is still the fork block.
- **`rpc-server.js` splits wide `eth_getLogs` queries.** EDR forwards a log query over
  forked history whole to the node it forks from, which caps its span (HTTP 413 for the
  SDK's first scan, from the pool's start block). The SDK only splits a range the node itself
  refuses, which it cannot tell from the error EDR relays.
- **The suites turn the deployment's indexer off** (`bermuda: { chainState: undefined }`). It
  serves the live chain, which the fork does not match after the fork block.
- **The suites wait out the SDK's read reuse** (`settle()`). The SDK reads through a pool of
  RPC nodes that reuses a read, the chain's head among them, for up to a block time (1 s on
  plasma-testnet), so a balance read right after a transaction can still predate it.
- **All funding goes through a faucet account, never the account under test.** ethers caches
  `eth_getTransactionCount` briefly, so a setup transaction sent by the wallet under test
  leaves its next signed transaction reusing a spent nonce. The faucet key is repo-specific
  for the same reason: the well-known Hardhat dev keys have real transaction histories on
  public testnets, and a fork inherits their nonces. (`WalletAccountBermuda#deposit` meets
  the same cache when it approves WXPL: it sends the deposit at the next nonce explicitly.)

#### Bare
`bare.js` and `bare/` make the package work under Bare; `tests/bare/` and
`tests/integration/bare.test.js` prove it. Load-bearing and easy to break:
- **Two import maps, two hops.** `bare.js` imports `bare/entry.js` with `bare-node-runtime`'s
  map, and `bare/entry.js` imports `index.js` with `bare/imports.json`. Bare merges a module's
  map into the one it inherited, so the whole graph sees `bare-node-runtime`'s mappings with
  ours on top. Folding them into one hop would mean copying and maintaining its map.
- **Map targets are package specifiers.** Bare resolves a mapped target from the module that
  imports it (deep inside `@aztec/bb.js`), not from the map file, so `bare/imports.json` points
  at `@bermuda/wdk-wallet-evm-bermuda/bare/*`, exported under a `bare` condition only. In this
  checkout the package is not in `node_modules`, so the Bare tests first link it there
  (`tests/bare/link.js`: `node_modules/@bermuda/wdk-wallet-evm-bermuda` → `../..`). Running
  `bare` here by hand needs that link too; `npm run test:bare` creates it.
- **Bare exits with code 0 once its event loop runs dry**, finished or not. Every Bare test
  prints a completion marker last and its runner checks for it: never trust the exit code alone.
- **The first loader wins.** Bare caches each module with the import map it was first loaded
  with, and preloads literal import specifiers. Scripts run under Bare import the package
  first and reach `@bermuda/sdk`, `@aztec/bb.js` or `ethers` only afterwards, through a
  specifier built at runtime; imported directly, those would be cached without the shims or
  `bare-node-runtime`'s mappings.
- **`bare/globals.js` replaces the global agents of `bare-http1` and `bare-https`.** Theirs
  cut off every request after 5 s, in flight or not, so ethers' and `fetch`'s requests to a
  slow RPC node failed. A request falls back to `Agent.global` and `bare-fetch` to
  `globalAgent`, so both are replaced. The patch only works on the very copies ethers (`http`
  → `bare-http1`) and `bare-fetch` load: both packages are dependencies pinned to the
  versions `bare-node-runtime` resolves, so npm keeps one copy of each. Move the pins with
  `bare-node-runtime`. `tests/bare/smoke.js` checks it against an RPC node answering in 5.5 s.
- **The prover's CRS stays out of `~/.bb-crs`.** The Bare tests set `CRS_PATH` to
  `node_modules/.cache/bb-crs`, which CI caches.
- **The packed check installs with `--allow-remote=all`.** To its scratch project,
  `@bermuda/sdk` is a transitive URL dependency, which npm 12 refuses by default.
  `tests/bare/run.js` uses the npm that runs it, not whichever comes first on the `PATH`.
