"use strict";

const { MAX_DEPTH } = require("./constants");

const getMaxDepth = (options) => {
  const value = options && options.maxDepth;
  return Number.isFinite(value) ? Math.min(MAX_DEPTH, value) : MAX_DEPTH;
};

const assertAstDepth = (node, depth, options) => {
  const maxDepth = getMaxDepth(options);

  if (node.nodes && depth > maxDepth) {
    throw new RangeError(`AST depth (${depth}), exceeds max depth (${maxDepth})`);
  }
};

module.exports = { assertAstDepth, getMaxDepth };
