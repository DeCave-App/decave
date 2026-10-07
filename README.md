# DeCave

DeCave is a pre-release chat and voice application for gaming communities. This
repository contains a React web client, Electron desktop client, Expo mobile
client, and a Cloudflare Workers backend. It is alpha software: features,
interfaces, and deployment requirements may change, and the project does not
promise a stable release.

## Security and privacy

In this checkout, the Worker can read message text and attachments; they are
not end-to-end encrypted. HTTPS/WSS protects client traffic to Cloudflare, and
WebRTC media uses DTLS-SRTP in transit. These protections do not prevent the
service or its hosting provider from accessing stored message content. Do not
use this alpha software for sensitive conversations or files.

The [data-routing disclosure](docs/legal/PRIVACY-AND-DATA-ROUTING.md) describes
the implementation visible in this repository. It and the
[service privacy policy](docs/legal/PRIVACY-POLICY.md) and
[terms](docs/legal/TERMS-OF-SERVICE.md) are engineering/legal drafts, not
approved notices for a public hosted service. See the
[publication-readiness checklist](docs/release/PUBLICATION-READINESS.md) before
operating or publishing a service.

## Repository layout

- `src/` — React web application and shared client features.
- `electron/` — desktop application shell and native integrations.
- `mobile/` — Expo and React Native clients for iOS and Android.
- `worker/` — Cloudflare Worker API and realtime backend.
- `migrations/` — D1 database migrations.
- `website/` — DeCave website source.
- `scripts/` — development, release, operations, and test utilities.

## Code review and license

This is source-visible software under the custom [DeCave Source Review
License](LICENSE), not an open-source project or an OSI-approved license. You
may inspect the code, build and test a private copy, and publish independent
review findings with brief excerpts needed to explain them. The license does
not grant general permission to reuse the code in products or services, publish
modified copies, or redistribute it. It does not grant rights to third-party
software or assets; check their separate notices and terms. This custom license
has not been reviewed by legal counsel.

When this repository is public on GitHub, GitHub's Terms and platform features
may allow users to view, copy, or fork it on GitHub. Those platform permissions
do not grant broader reuse rights outside the permissions in the project
license and GitHub's terms. See [SECURITY.md](SECURITY.md) for review scope and
vulnerability reporting guidance.

## Development

The CI workflow uses Node.js 24 and npm. Install dependencies and run the same
checks as CI from the repository root:

```sh
npm ci
npm run check
npm run build:web
```

`npm run check` runs type checks, lint, formatting checks, and the test suite.
The web build creates the client in `dist/`. Mobile checks run separately:

```sh
cd mobile
npm ci
npm run typecheck
npm run test:reliability
```

### Cloudflare development setup

The exported `wrangler.jsonc` uses example hostnames and placeholder Cloudflare resource identifiers. It is not connected to the maintainer's services. Before deploying, configure your own isolated D1, R2, rate limit, email, and domain resources in a local Wrangler config. Keep development data separate from production data.

To run the Worker locally, create an untracked `wrangler.local.jsonc` with your own local resources, then apply migrations and start Wrangler:

```sh
npx wrangler d1 migrations apply YOUR_D1_DATABASE --local --config wrangler.local.jsonc
npx wrangler dev --config wrangler.local.jsonc --ip 127.0.0.1 --port 8787
```

In a second terminal, `npm run dev` starts Vite; its `/api` and `/ws` requests proxy to the local Worker at `127.0.0.1:8787`. The repository does not include a ready-made local Cloudflare resource configuration.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes. Security
reports are described in [SECURITY.md](SECURITY.md).
