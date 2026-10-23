// No unit test may touch the network. Anything that needs PubChem or OPSIN data
// replays a recording from tests/fixtures/recorded/.
globalThis.fetch = () => {
  throw new Error('Network access is not allowed in unit tests; replay a recording instead.');
};
