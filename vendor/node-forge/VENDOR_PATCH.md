# node-forge local security patch

This directory vendors the `node-forge` 1.4.0 runtime source used by the mobile
dependency tree. Its package metadata identifies this patched copy as the
private local version `1.4.1-decave.1`; this is not an upstream release. The
upstream source package is identified by
`mobile/package-lock.json` as
`https://registry.npmjs.org/node-forge/-/node-forge-1.4.0.tgz` with integrity
`sha512-LarFH0+6VfriEhqMMcLX2F7SwSXeWwnEAJEsYm5QKWchiVYVvJyV9v7UDvUv+w5HO23ZpQTXDv/GxdDdMyOuoQ==`.
The upstream `LICENSE`, README, and source headers are retained. The files
under `lib/` are the package runtime.

`lib/rsa.js` has one local change: RSA PKCS#1 v1.5 signature verification
re-encodes the parsed DigestInfo canonically and compares the bytes, accepting
both the standard NULL-parameters and parameter-less AlgorithmIdentifier forms.
This closes GHSA-86w9-cpqp-85rv / CVE-2026-85393, for which no patched upstream
release was available on 2026-10-10. The approach follows the canonical
re-encoding fix proposed in the still-open upstream PR
[digitalbazaar/forge#1159](https://github.com/digitalbazaar/forge/pull/1159),
commit `db05494`; this local patch is not an upstream release and should be
revisited when maintainers publish a fixed version.

The regression vectors in `scripts/__tests__/dependency-node-forge.test.mjs`
are derived from that PR's public RSA tests. The original license terms are in
`LICENSE`.
