// Guards against two confusing, misdirecting failure modes on old Node.
//
// The floor is 22.0.0, imposed by Hardhat itself: `@nomicfoundation/edr` (and its
// platform binding packages) declare `engines: { node: ">= 22" }`. On Node 20, npm
// silently skips those *optional* platform dependencies, and Hardhat then fails
// with "Cannot find native binding. npm has a bug related to optional
// dependencies..." — which blames npm for what is really an unsupported Node.
//
// Separately, on Node < 24.9.0 Jest's ESM loader could not link zod's
// './v3/external.js', surfacing as `HHE200: Plugin "builtin:coverage" is not
// installed`. That one IS fixed, by the zod -> CJS `moduleNameMapper` in
// jest.config.js, so 22.x–24.8.x now run the full suite.
//
// This floor applies to the test toolchain only. The published library itself
// supports older Node.

const MINIMUM = '22.0.0'

export default function checkNodeVersion () {
  const current = process.versions.node
  const [major] = current.split('.').map(Number)
  const [minMajor] = MINIMUM.split('.').map(Number)

  if (major >= minMajor) return

  throw new Error(
    '\n\nUnsupported Node.js version for running the test suite.\n\n' +
    `  running:  v${current}\n` +
    `  required: >=${MINIMUM}\n\n` +
    'Hardhat 3 requires Node >=22: @nomicfoundation/edr and its native platform\n' +
    'bindings declare `engines: { node: ">= 22" }`, so npm silently skips the\n' +
    'binding as an unmet optional dependency. The resulting error ("Cannot find\n' +
    'native binding. npm has a bug related to optional dependencies...") blames npm,\n' +
    'but removing package-lock.json will NOT help — the Node version is the problem.\n\n' +
    'Run `nvm use` (see .nvmrc), then `npm ci`.\n\n' +
    'Note: this floor applies to the test toolchain only. The published library\n' +
    'itself supports older Node.\n'
  )
}
