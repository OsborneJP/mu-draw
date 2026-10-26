// Types for the two modules the biochem tools import by path; neither package ships them.

// indigo-ketcher's build with a separate .wasm file (the one Ketcher's worker loads too).
declare module 'indigo-ketcher/binaryWasm' {
  /** Indigo's option map (an embind object: delete it when done). */
  export interface IndigoOptions {
    set(key: string, value: string): void;
    delete(): void;
  }
  /** The part of Indigo's API the biochem tools use. */
  export interface IndigoModule {
    MapStringString: new () => IndigoOptions;
    version(): string;
    convert(data: string, outputFormat: string, options: IndigoOptions): string;
    calculateMacroProperties(data: string, options: IndigoOptions): string;
  }
  /** Emscripten's factory; `wasmBinary` lets Node (Vitest, the generator) pass the file. */
  export default function Module(options?: { wasmBinary?: Uint8Array }): Promise<IndigoModule>;
}

// Ketcher's monomer library (a KET document as text), as ketcher-core 3.18 bundles it for its
// macromolecules editor. The ESM path is the one the app's ketcher-core import already pulls
// into the main bundle, so importing it adds nothing to the download.
declare module 'ketcher-core/dist/application/editor/data/monomers.modern.js' {
  const monomersDataRaw: string;
  export default monomersDataRaw;
}
