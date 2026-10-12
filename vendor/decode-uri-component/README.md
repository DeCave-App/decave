# decode-uri-component CommonJS compatibility fork

This local package adapts the security fix from upstream `decode-uri-component` 0.5.0 for the CommonJS `query-string@7.1.3` dependency used by Expo Router. The decoder implementation is based on upstream commit [`fa479da`](https://github.com/SamVerschueren/decode-uri-component/commit/fa479da), which replaces recursive malformed-input decoding with a linear UTF-8 scanner and fixes [CVE-2026-45822 / GHSA-vcc3-ghjq-m6fr](https://github.com/SamVerschueren/decode-uri-component/security/advisories/GHSA-vcc3-ghjq-m6fr).

The source is adapted to export through `module.exports` from a standard `index.js` entry point so CommonJS callers and Metro receive a function. It also keeps the previous package's literal-plus normalization (`+` becomes a space); `query-string` already performs that normalization before calling the decoder, so its parsing behavior remains unchanged. Version `0.5.0-gamerchat.1` identifies this repository's compatibility build; it is not an upstream npm release.

Malformed percent-encoded runs are transformed in one pass, rather than collected into a replacement map that rescans the full input for every distinct run. This keeps recovery linear even when attacker-controlled input contains many different malformed runs while preserving the upstream byte-order-mark and lone-`%C2` replacement order.

The upstream package is MIT licensed. See `LICENSE` for the required notice.
