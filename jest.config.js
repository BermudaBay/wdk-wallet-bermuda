import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export default {
  globalSetup: '<rootDir>/tests/setup/check-node-version.js',
  // Load zod's CommonJS build in tests.
  //
  // On Node < 24.9.0, Jest's `--experimental-vm-modules` ESM loader fails to link
  // zod's internal `./v3/external.js` re-export when Hardhat dynamically imports
  // its builtin plugin hook handlers. Hardhat catches that, runs its dependency
  // diagnostic, that diagnostic fails too, and the real cause ends up buried as a
  // misleading `HHE200: Plugin "builtin:coverage" is not installed`.
  //
  // Routing zod through `require` bypasses the ESM linker entirely. Every package
  // in the dependency tree imports bare 'zod' (no deep subpaths), so this maps all
  // of them to a single copy — no dual-package hazard.
  moduleNameMapper: {
    '^zod$': require.resolve('zod')
  },
  collectCoverageFrom: [
    'src/**/*.js',
    'index.js'
  ],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    }
  }
}
