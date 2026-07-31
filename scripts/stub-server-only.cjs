/**
 * Stub `server-only` so CLI scripts can import server modules under tsx/node.
 * Register with: node --require ./scripts/stub-server-only.cjs ...
 * or: tsx --require ./scripts/stub-server-only.cjs ...
 */
const Module = require("module");
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "server-only") {
    return {};
  }
  return originalLoad(request, parent, isMain);
};
