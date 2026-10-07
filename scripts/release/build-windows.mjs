// Builds the signed Windows NSIS installer.
//
// electron-builder only expands ${env.*} macros inside `publish` entries, and
// its schema rejects `win.publisherName`, so the trusted publisher DN is
// injected here as `win.signtoolOptions.publisherName`. electron-builder then
// writes it into app-update.yml, where electron/windows-update-trust.cjs
// requires the full DN before it lets the installed app auto-update.
import process from "node:process";
import { createRequire } from "node:module";
import { assertWindowsSigningReady } from "./windows-signing-readiness.mjs";

const require = createRequire(import.meta.url);

const signed = assertWindowsSigningReady();
const { build, Platform, Arch } = require("electron-builder");
// Unsigned builds ship no publisher in app-update.yml plus the package opt-in, so
// installed copies keep auto-updating (feed-hash checked) until signing is set up.
const config = signed
  ? { win: { signtoolOptions: { publisherName: [process.env.DECAVE_WINDOWS_PUBLISHER.trim()] } } }
  : { extraMetadata: { decaveAllowUnsignedWindowsUpdates: true } };
await build({ targets: Platform.WINDOWS.createTarget(["nsis"], Arch.x64), config });
