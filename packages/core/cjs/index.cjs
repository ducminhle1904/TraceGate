"use strict";

async function loadTraceGateCore() {
  return import("../dist/index.js");
}

module.exports = {
  loadTraceGateCore,
};
