# Contributing

DeCave is alpha software. Features and internal interfaces can change, and
issues may not have a complete reproduction or release schedule yet.

## License and contributions

The [DeCave Source Review License](LICENSE) permits private evaluation and
security review. It does not grant general rights to reuse, redistribute, or
publish project code or modifications. The project does not currently accept
code contributions for inclusion. Ask the maintainer before preparing a patch;
any accepted contribution needs separate written terms covering its inclusion
and use. Opening a report or publishing an independent review does not require
maintainer approval.

## Before proposing a change

- Search existing issues and discussions for related work.
- Keep changes focused and describe the user-visible effect.
- Include a regression test when a behavior change needs one.
- Never include credentials, private keys, personal information, real messages,
  or production data in code, tests, screenshots, or issue reports.
- For security issues, use the private reporting steps in [SECURITY.md](SECURITY.md)
  instead of opening a public issue.

## Development checks

The CI workflow uses Node.js 24. From the repository root, run:

```sh
npm ci
npm run check
npm run build:web
```

The mobile project has its own lockfile and checks:

```sh
cd mobile
npm ci
npm run typecheck
npm run test:reliability
```

The default `wrangler.jsonc` points to the maintainer's deployed resources and
includes a remote email binding. Do not use it to run or deploy a development
instance. Follow the isolated local setup in the README and never run
`cf:migrate:remote`, `cf:deploy`, or `release` without explicit maintainer
authorization and the correct environment.
