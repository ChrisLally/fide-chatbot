/** Preload for CLI evals: Next's `server-only` package throws outside RSC. */
const Module = require("node:module");
const path = require("node:path");
const stub = path.join(__dirname, "empty-server-only.cjs");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "server-only") {
    return stub;
  }
  return original.call(this, request, parent, isMain, options);
};
