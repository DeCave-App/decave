# Local `sprintf-js` patch

This private package is a small fork of upstream `sprintf-js` 1.1.3. The runtime
entry point was copied from the npm package's `src/sprintf.js`; the upstream BSD
3-Clause license is included alongside it. The local version `1.1.4-decave.1`
identifies this repository's fork and is not an upstream release.

The local change bounds precision for `%e`, `%f`, and `%g` to the range supported
by JavaScript's numeric formatting methods. A `%g` precision of zero is treated
as one significant digit. This avoids an attacker-controlled format string
causing an uncaught `RangeError` while preserving every in-range precision and
non-numeric format precision.

Upstream has no patched release for GHSA-hp3w-g68c-fv3c as of this patch. The
advisory reports affected versions through 1.1.3. The first upstream pull request
for the issue was closed because it still threw on out-of-range precisions; this
fork clamps the values instead. See:

- https://github.com/advisories/GHSA-hp3w-g68c-fv3c
- https://github.com/alexei/sprintf.js/issues/237
- https://github.com/alexei/sprintf.js/pull/238

Only the CommonJS Node entry point required by the transitive consumer is
vendored. Browser distribution bundles and the Angular adapter are not imported
by this dependency path and are not included.
