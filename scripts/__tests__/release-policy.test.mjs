import test from "node:test";
import assert from "node:assert/strict";
import { getPublicationReadinessIssues } from "../release/publication-readiness.mjs";
import { getWindowsSigningReadinessIssues } from "../release/windows-signing-readiness.mjs";
import {
  configureWindowsUpdateTrust,
  normalizePublisherDn,
  readUnsignedWindowsUpdatesOptIn,
  readTrustedPublisher,
  verifyAuthenticodePublisher,
} from "../../electron/windows-update-trust.cjs";

const publisher = "CN=DeCave Software, O=DeCave, C=PL";
const legalEnv = {
  DECAVE_LEGAL_ENTITY_NAME: "DeCave Software sp. z o.o.",
  DECAVE_CONTROLLER_ADDRESS: "1 Example Street, Warsaw, Poland",
  DECAVE_SERVICE_COUNTRIES: "Poland",
  DECAVE_PUBLICATION_APPROVED: "true",
};
const approvedDocuments = {
  "docs/legal/PRIVACY-POLICY.md": `Publication status: Approved for publication\n${legalEnv.DECAVE_LEGAL_ENTITY_NAME}\n${legalEnv.DECAVE_CONTROLLER_ADDRESS}\n${legalEnv.DECAVE_SERVICE_COUNTRIES}\n`,
  "docs/legal/TERMS-OF-SERVICE.md": `Publication status: Approved for publication\n`,
  "website/src/main.tsx": `// Publication status: Approved for publication\n// Publication status: Approved for publication\n`,
};

test("publication gate requires explicit approval and exact approved status in every policy", () => {
  assert.deepEqual(getPublicationReadinessIssues({ env: legalEnv, documents: approvedDocuments }), []);
  const drafts = {
    ...approvedDocuments,
    "website/src/main.tsx": "Publication status: Draft.\nNot approved for publication.\n",
  };
  assert.ok(
    getPublicationReadinessIssues({ env: legalEnv, documents: drafts }).some((issue) =>
      issue.includes("explicit Approved for publication status lines"),
    ),
  );
  const oneWebsiteApproval = {
    ...approvedDocuments,
    "website/src/main.tsx": "// Publication status: Approved for publication\n",
  };
  assert.ok(
    getPublicationReadinessIssues({ env: legalEnv, documents: oneWebsiteApproval }).some((issue) =>
      issue.includes("must have 2 explicit"),
    ),
  );
  assert.ok(
    getPublicationReadinessIssues({
      env: { ...legalEnv, DECAVE_PUBLICATION_APPROVED: "true; approved" },
      documents: approvedDocuments,
    }).some((issue) => issue.includes("explicit publication approval")),
  );
});

test("publication gate rejects unresolved legal placeholders without flagging ordinary bracketed links", () => {
  const withPlaceholder = {
    ...approvedDocuments,
    "docs/legal/TERMS-OF-SERVICE.md": `${approvedDocuments["docs/legal/TERMS-OF-SERVICE.md"]}[GOVERNING LAW AND COURTS]`,
  };
  assert.ok(
    getPublicationReadinessIssues({ env: legalEnv, documents: withPlaceholder }).some((issue) =>
      issue.includes("unresolved publication placeholder"),
    ),
  );
  const ordinaryReference = {
    ...approvedDocuments,
    "docs/legal/TERMS-OF-SERVICE.md": "Publication status: Approved for publication\nSee [FAQ].",
  };
  assert.deepEqual(getPublicationReadinessIssues({ env: legalEnv, documents: ordinaryReference }), []);
});

test("publisher trust requires a full organization-bearing DN and signer match", () => {
  assert.equal(normalizePublisherDn("CN=DeCave"), null);
  assert.equal(normalizePublisherDn("CN=DeCave, O=DeCave"), "cn=decave,o=decave");
  assert.equal(normalizePublisherDn("CN=, O=DeCave"), null);
  assert.throws(() => readTrustedPublisher("app-update.yml", () => "url: https://example.invalid\n"));
  const trust = readTrustedPublisher("app-update.yml", () => `publisherName: ${JSON.stringify(publisher)}\n`);
  assert.equal(trust.publisherName, publisher);
  assert.deepEqual(
    verifyAuthenticodePublisher("setup.exe", trust, () => ({ status: 0, stdout: publisher })),
    { ok: true, reason: null },
  );
  assert.equal(
    verifyAuthenticodePublisher("setup.exe", trust, () => ({ status: 0, stdout: "CN=Attacker, O=Attacker" })).ok,
    false,
  );
});

test("publisher verification fails closed for missing config and unavailable or failing tooling", () => {
  assert.equal(verifyAuthenticodePublisher("setup.exe", "", () => ({ status: 0, stdout: publisher })).ok, false);
  assert.equal(
    verifyAuthenticodePublisher("setup.exe", publisher, () => ({
      error: new Error("missing powershell"),
      status: null,
    })).ok,
    false,
  );
  assert.equal(verifyAuthenticodePublisher("setup.exe", publisher, () => ({ status: 2, stdout: "" })).ok, false);
  assert.equal(
    verifyAuthenticodePublisher("setup.exe", publisher, () => ({ status: 0, stdout: publisher, stderr: "warning" })).ok,
    false,
  );
});

test("unsigned Windows updates require explicit metadata and stay strict when a publisher is configured", async () => {
  assert.equal(
    readUnsignedWindowsUpdatesOptIn("package.json", () => '{"version":"1.0.0"}'),
    false,
  );
  assert.equal(
    readUnsignedWindowsUpdatesOptIn("package.json", () => '{"decaveAllowUnsignedWindowsUpdates":true}'),
    true,
  );
  assert.equal(
    readUnsignedWindowsUpdatesOptIn("package.json", () => '{"decaveAllowUnsignedWindowsUpdates":"true"}'),
    false,
  );

  const unsignedConfig = () => "provider: generic\nurl: https://updates.example.invalid/\n";
  assert.throws(() =>
    configureWindowsUpdateTrust({
      configPath: "app-update.yml",
      executablePath: "DeCave.exe",
      autoUpdater: {},
      readFile: unsignedConfig,
    }),
  );

  const unsignedUpdater = {};
  assert.equal(
    configureWindowsUpdateTrust({
      configPath: "app-update.yml",
      executablePath: "DeCave.exe",
      allowUnsignedUpdates: true,
      autoUpdater: unsignedUpdater,
      readFile: unsignedConfig,
    }),
    "unsigned",
  );
  assert.equal(await unsignedUpdater.verifyUpdateCodeSignature(["CN=Any Publisher, O=Any"], "update.exe"), null);

  let signatureChecks = 0;
  const configuredUpdater = {};
  assert.equal(
    configureWindowsUpdateTrust({
      configPath: "app-update.yml",
      executablePath: "DeCave.exe",
      allowUnsignedUpdates: true,
      autoUpdater: configuredUpdater,
      readFile: () =>
        `provider: generic\nurl: https://updates.example.invalid/\npublisherName: ${JSON.stringify(publisher)}\n`,
      verifyPublisher: () => {
        signatureChecks += 1;
        return { ok: true, reason: null };
      },
    }),
    "signed",
  );
  assert.equal(signatureChecks, 1);
  assert.match(
    await configuredUpdater.verifyUpdateCodeSignature(["CN=Attacker, O=Attacker"], "update.exe"),
    /does not match/,
  );
  assert.equal(await configuredUpdater.verifyUpdateCodeSignature([publisher], "update.exe"), null);
  assert.equal(signatureChecks, 2);

  assert.throws(
    () =>
      configureWindowsUpdateTrust({
        configPath: "app-update.yml",
        executablePath: "DeCave.exe",
        allowUnsignedUpdates: true,
        autoUpdater: {},
        readFile: () => `publisherName: ${JSON.stringify(publisher)}\n`,
        verifyPublisher: () => ({ ok: false, reason: "invalid current signature" }),
      }),
    /invalid current signature/,
  );
});

test("Windows signing gate refuses missing signing credentials or CN-only publisher trust", () => {
  assert.equal(getWindowsSigningReadinessIssues({}).length, 2);
  assert.equal(
    getWindowsSigningReadinessIssues({ DECAVE_WINDOWS_PUBLISHER: "CN=DeCave", CSC_LINK: "certificate.p12" }).length,
    1,
  );
  assert.deepEqual(
    getWindowsSigningReadinessIssues({ DECAVE_WINDOWS_PUBLISHER: publisher, CSC_LINK: "certificate.p12" }),
    [],
  );
});
