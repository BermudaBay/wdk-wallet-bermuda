/**
 * Returns the name the Bermuda SDK knows a chain by.
 *
 * @param {number | bigint} chainId - The chain id.
 * @returns {string} The chain's name.
 * @throws {ValueError} If the chain id is not supported.
 */
export function chainIdToName(chainId: number | bigint): string;
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
export function withoutWarnings<T>(isDropped: (args: unknown[]) => boolean, fn: () => Promise<T>): Promise<T>;
