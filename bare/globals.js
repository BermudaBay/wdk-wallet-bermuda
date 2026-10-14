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

// Globals that the Bermuda SDK and its prover, @aztec/bb.js, rely on and that
// Bare only provides in part. Every patch widens behaviour that used to throw,
// to fail early or to end the process early; everything else is passed through
// untouched.

import http from 'bare-http1'
import https from 'bare-https'

// @aztec/bb.js decodes every string its WASM module hands back - log lines and
// abort messages alike - with `new TextDecoder('ascii')`. bare-encoding only
// knows UTF-8 and throws on any other label, so the prover dies on its first
// log line. The WHATWG Encoding Standard defines 'ascii' and its siblings as
// labels of windows-1252: decode those here, and leave every other label to
// Bare's own TextDecoder.
const WINDOWS_1252_LABELS = new Set([
  'ansi_x3.4-1968', 'ascii', 'cp1252', 'cp819', 'csisolatin1', 'ibm819',
  'iso-8859-1', 'iso-ir-100', 'iso8859-1', 'iso88591', 'iso_8859-1',
  'iso_8859-1:1987', 'l1', 'latin1', 'us-ascii', 'windows-1252', 'x-cp1252'
])

// windows-1252 matches Latin-1 except for the bytes 0x80 to 0x9F.
const WINDOWS_1252_0X80_TO_0X9F = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178
]

// Code units per String.fromCharCode call, well below any argument limit.
const DECODE_CHUNK_SIZE = 8192

// Bare exits as soon as its event loop runs out of work. V8 compiles
// WebAssembly on background threads that the loop does not wait for, so Bare
// quits - with exit code 0 - while @aztec/bb.js is still compiling its prover.
// A timer keeps the loop alive while a compilation is in flight; it never
// fires, since it is cleared as soon as the compilation settles.
const KEEP_ALIVE_INTERVAL = 2 ** 30

// bare-http1 and bare-https give their global agents, which every request
// without an agent of its own goes through (ethers' and fetch's among them), a
// socket timeout of 5 seconds that also cuts off a request in flight, where
// Node.js's global agent only times out idle sockets. An RPC node taking longer
// to answer - scanning a wide range of logs, say - fails the request, and when
// that request is ethers' first, ethers retries detecting the network for ever.
// The global agents are replaced with ones that keep sockets alive as long,
// without that timeout.
const HTTP_KEEP_ALIVE_MSECS = 1000

patchTextDecoder()

patchWebAssembly()

patchHttpAgents()

function patchTextDecoder () {
  const BareTextDecoder = globalThis.TextDecoder

  globalThis.TextDecoder = class TextDecoder extends BareTextDecoder {
    constructor (label = 'utf-8', options) {
      const windows1252 = WINDOWS_1252_LABELS.has(String(label).trim().toLowerCase())

      super(windows1252 ? 'utf-8' : label, options)

      if (windows1252) {
        // Defined rather than assigned: bare-encoding stores `encoding` as a
        // plain property today, and an assignment would throw if it ever
        // turned into a getter.
        Object.defineProperty(this, 'encoding', {
          value: 'windows-1252',
          enumerable: true,
          configurable: true
        })
      }

      /** @private */
      this._windows1252 = windows1252
    }

    decode (input, options) {
      if (!this._windows1252) {
        return super.decode(input, options)
      }

      return decodeWindows1252(input)
    }
  }
}

function decodeWindows1252 (input) {
  if (input === undefined) {
    return ''
  }

  const bytes = ArrayBuffer.isView(input)
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : new Uint8Array(input)

  const codeUnits = new Uint16Array(bytes.length)

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]

    codeUnits[i] = byte >= 0x80 && byte <= 0x9f ? WINDOWS_1252_0X80_TO_0X9F[byte - 0x80] : byte
  }

  let text = ''

  for (let i = 0; i < codeUnits.length; i += DECODE_CHUNK_SIZE) {
    text += String.fromCharCode(...codeUnits.subarray(i, i + DECODE_CHUNK_SIZE))
  }

  return text
}

function patchHttpAgents () {
  for (const protocol of [http, https]) {
    const agent = new protocol.Agent({ keepAlive: HTTP_KEEP_ALIVE_MSECS })

    // A request falls back to `Agent.global`, and fetch to `globalAgent`.
    protocol.Agent.global = agent
    protocol.globalAgent = agent
  }
}

function patchWebAssembly () {
  for (const name of ['compile', 'instantiate']) {
    const original = WebAssembly[name]

    WebAssembly[name] = function (...args) {
      const keepAlive = setInterval(() => {}, KEEP_ALIVE_INTERVAL)

      try {
        return Reflect.apply(original, WebAssembly, args)
          .finally(() => clearInterval(keepAlive))
      } catch (error) {
        clearInterval(keepAlive)

        throw error
      }
    }
  }
}
