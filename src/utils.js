// Copyright 2024 Tether Operations Limited
// Copyright 2026 Hyperpool AG
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

import { ValueError } from '@tetherto/wdk-wallet'

/**
 * Returns the name the Bermuda SDK knows a chain by.
 *
 * @param {number | bigint} chainId - The chain id.
 * @returns {string} The chain's name.
 * @throws {ValueError} If the chain id is not supported.
 */
export function chainIdToName (chainId) {
  switch (Number(chainId)) {
    case 31337:
      return 'testenv'
    case 100:
      return 'gnosis'
    case 8453:
      return 'base'
    case 84532:
      return 'base-sepolia'
    case 9745:
      return 'plasma-mainnet'
    case 9746:
      return 'plasma-testnet'
    case 59144:
      return 'linea'
    default:
      throw new ValueError(`Unknown chain id: ${chainId}`)
  }
}

/**
 * The calls of {@link withoutWarnings} in progress: whether each drops a warning.
 *
 * @type {Set<{ isDropped: (args: unknown[]) => boolean }>}
 */
const droppers = new Set()

/**
 * The console's `warn` while {@link withoutWarnings} is in progress, and what it replaced.
 *
 * @type {{ wrapper: Function, warn: Function } | undefined}
 */
let replaced

/**
 * Runs a function while the console drops the warnings matching a predicate.
 *
 * Calls may overlap: the console's `warn` is replaced while any of them is in progress, and put back once the last one
 * has finished, unless it has been replaced again in the meantime.
 *
 * @template T
 * @param {(args: unknown[]) => boolean} isDropped - Whether to drop a warning, given the arguments it is logged with.
 * @param {() => Promise<T>} fn - The function.
 * @returns {Promise<T>} What the function resolves to.
 */
export async function withoutWarnings (isDropped, fn) {
  const dropper = { isDropped }

  if (droppers.size === 0) {
    const warn = console.warn

    const wrapper = function (...args) {
      for (const { isDropped } of droppers) {
        if (isDropped(args)) return
      }

      return warn.apply(this ?? console, args)
    }

    console.warn = wrapper

    replaced = { wrapper, warn }
  }

  droppers.add(dropper)

  try {
    return await fn()
  } finally {
    droppers.delete(dropper)

    if (droppers.size === 0) {
      if (console.warn === replaced.wrapper) {
        console.warn = replaced.warn
      }

      replaced = undefined
    }
  }
}
