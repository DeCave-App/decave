# Vendored dependency patches

These packages are small, project-maintained fixes for transitive dependency
advisories where a compatible upstream release was unavailable or could not be
used by the current consumers. Each package keeps its upstream license and has
its own source and provenance notes:

| Advisory | Local package and change | Details and regression test |
| --- | --- | --- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | [`braces@3.0.4-decave.1`](./braces): private local fork that bounds nested brace/parenthesis patterns and AST walks. Used by the mobile Metro/micromatch graph. | [Backport notes](./braces/SECURITY_BACKPORT.md); [`dependency-braces.test.mjs`](../scripts/__tests__/dependency-braces.test.mjs) |
| [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | [`decode-uri-component`](./decode-uri-component): recover malformed UTF-8 in one pass while preserving the CommonJS function contract used by mobile `query-string`. | [Compatibility notes](./decode-uri-component/README.md); [`dependency-decode-uri.test.mjs`](../scripts/__tests__/dependency-decode-uri.test.mjs) |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | [`node-forge`](./node-forge): compare RSA signature DigestInfo against its canonical encoding. | [Patch notes](./node-forge/VENDOR_PATCH.md); [`dependency-node-forge.test.mjs`](../scripts/__tests__/dependency-node-forge.test.mjs) |
| [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) | [`sprintf-js`](./sprintf-js): clamp numeric formatting precision to supported bounds. Used by the root Electron Builder dependency graph. | [Patch notes](./sprintf-js/README.md); [`dependency-sprintf.test.mjs`](../scripts/__tests__/dependency-sprintf.test.mjs) |

Root and mobile declare local `file:` dependencies and npm overrides in their
respective `package.json` files. Their lockfiles pin the local packages. Keep
`install-links=true` in both `.npmrc` files: it makes npm materialize these
local packages so consumers and CI use the patched package contents. The
open-source export must retain the root `.npmrc` as well.

The braces fork is identified as private version `3.0.4-decave.1` so its
metadata does not impersonate upstream `3.0.3`. The version label is not a
substitute for the source patch or its regression tests.

When an upstream fix becomes available, verify its source and compatibility
with the affected consumer, then replace or remove the local dependency and
override and regenerate that workspace's lockfile. Run the package's adversarial
regression test and the workspace checks before deleting its vendor copy and
notes. Do not resolve an advisory by changing only a version string or by
removing an audit entry.

`npm audit` evaluates package metadata and the advisory database; it does not
inspect these local source patches or prove which code a runtime resolved. It
may continue to report a backported package whose version remains in an
affected upstream range. Treat audit output as dependency-graph information,
not as validation of a local patch; use the linked source tests and runtime
resolution checks for that.
