// The Node version the kit needs, from package.json `engines.node` (">=22"). Used by bin.js
// before anything else is loaded, so this file must parse and run on old Node lines too:
// nothing newer than what Node 18 has.

export const NODE_INSTALL = 'https://nodejs.org/en/download'

export function nodeFloor(engines) {
  return Number(engines.match(/^>=(\d+)/)?.[1] ?? 0)
}

export function meetsFloor(version, engines) {
  return Number(version.replace(/^v/, '').split('.')[0]) >= nodeFloor(engines)
}

// null when this Node is new enough, otherwise the one line to print.
export function nodeProblem(version, engines) {
  if (meetsFloor(version, engines)) return null
  return `solidity-ai-kit needs Node ${engines} (found ${version}). Install Node 22 or 24: ${NODE_INSTALL}`
}
