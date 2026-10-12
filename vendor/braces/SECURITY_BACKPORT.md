# Local security backport for braces 3.0.3

This directory is based on the published `braces@3.0.3` npm package, whose
registry integrity is:

`sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==`

The upstream package is MIT licensed; its original `LICENSE` is retained.
This local backport adds a default maximum nesting depth of 100 for brace and
parenthesis patterns, and checks AST depth in compile, expand, and stringify so
direct AST callers cannot bypass the parser guard. Expansion also rejects
cyclic AST parent chains rather than looping indefinitely.

The mitigation follows the reviewed design in
[micromatch/braces pull request #72](https://github.com/micromatch/braces/pull/72),
which is closed and has not been released as a patched npm version. GitHub's
advisory lists no patched version for
[GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
This is a project-maintained backport, not an upstream braces release. The
local package uses the private version `3.0.4-decave.1` to distinguish it from
the upstream `3.0.3` release. This version label is not itself the fix; the
source changes and their adversarial regression tests establish the backport.

When an upstream release includes an equivalent depth guard, remove the local
override and vendor copy only after verifying the release and rerunning the
adversarial dependency regression test.
