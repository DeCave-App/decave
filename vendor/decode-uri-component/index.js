"use strict";

/* global module */

// Adapted from decode-uri-component 0.5.0, upstream commit fa479da.
// The single-pass fallback prevents recursive work amplification on malformed UTF-8.
const token = "%[a-f0-9]{2}";
const multiMatcher = new RegExp(`(${token})+`, "gi");
const hexPair = /^[a-f\d]{2}$/i;

function parsePercentByte(input, position) {
  if (input.codePointAt(position) !== 37 || position + 3 > input.length) {
    return;
  }

  const digits = input.slice(position + 1, position + 3);
  if (!hexPair.test(digits)) {
    return;
  }

  return { byte: Number.parseInt(digits, 16), next: position + 3 };
}

function utf8SequenceLength(byte) {
  if (byte <= 0x7f) {
    return 1;
  }

  // Start at 0xc2 to exclude overlong two-byte encodings (0xc0/0xc1).
  if (byte >= 0xc2 && byte <= 0xdf) {
    return 2;
  }

  if (byte >= 0xe0 && byte <= 0xef) {
    return 3;
  }

  if (byte >= 0xf0 && byte <= 0xf4) {
    return 4;
  }

  return 0;
}

function isContinuationByte(byte) {
  return byte >= 0x80 && byte <= 0xbf;
}

/** Decode valid UTF-8 sequences without throwing, scanning malformed input in O(n). */
function decode(input) {
  try {
    return decodeURIComponent(input);
  } catch {
    let output = "";
    let position = 0;

    while (position < input.length) {
      if (input.codePointAt(position) !== 37) {
        output += input.charAt(position);
        position++;
        continue;
      }

      const firstByte = parsePercentByte(input, position);

      // A percent sign not followed by two hex digits stays literal.
      if (!firstByte) {
        output += input.charAt(position);
        position++;
        continue;
      }

      const sequenceLength = utf8SequenceLength(firstByte.byte);
      if (sequenceLength === 0) {
        output += input.slice(position, position + 3);
        position += 3;
        continue;
      }

      let end = firstByte.next;
      let validSequence = true;

      for (let index = 1; index < sequenceLength; index++) {
        const nextByte = parsePercentByte(input, end);
        if (!nextByte || !isContinuationByte(nextByte.byte)) {
          validSequence = false;
          break;
        }

        end = nextByte.next;
      }

      if (validSequence) {
        const encodedSequence = input.slice(position, end);
        try {
          output += decodeURIComponent(encodedSequence);
          position = end;
          continue;
        } catch {
          // Structurally valid but semantically invalid UTF-8: preserve the bytes.
        }
      }

      output += input.slice(position, position + 3);
      position += 3;
    }

    return output;
  }
}

function customDecodeURIComponent(input) {
  // Decode each contiguous run in the same pass. Building a replacement map and
  // applying one whole-input regex per distinct run makes hostile input quadratic.
  return input.replace(multiMatcher, (run) => {
    // The upstream replacement order handles these byte-order marks before it
    // decodes whole runs, so escapes elsewhere in the same run stay encoded.
    if (run.includes("%FE%FF") || run.includes("%FF%FE")) {
      return run
        .replace(/%FE%FF|%FF%FE/g, "\uFFFD\uFFFD")
        .replace(/%C2/g, "\uFFFD");
    }

    try {
      return decodeURIComponent(run);
    } catch {
      // Apply the upstream lone C2 replacement after malformed-run recovery.
      return decode(run).replace(/%C2/g, "\uFFFD");
    }
  });
}

module.exports = function decodeUriComponent(encodedURI) {
  if (typeof encodedURI !== "string") {
    throw new TypeError(`Expected \`encodedURI\` to be of type \`string\`, got \`${typeof encodedURI}\``);
  }

  // Preserve decode-uri-component 0.2.2 behavior for literal '+' input.
  encodedURI = encodedURI.replace(/\+/g, " ");

  try {
    return decodeURIComponent(encodedURI);
  } catch {
    return customDecodeURIComponent(encodedURI);
  }
};
