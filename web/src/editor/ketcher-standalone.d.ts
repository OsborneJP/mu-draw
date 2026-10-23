// ketcher-standalone's exports map gives ./dist/binaryWasm no `types` condition.
// That entry exports the same API as the package root.
declare module 'ketcher-standalone/dist/binaryWasm' {
  export * from 'ketcher-standalone';
}
