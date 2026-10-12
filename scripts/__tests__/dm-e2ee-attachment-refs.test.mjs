// Orphaned-upload cleanup (worker/retention.ts) keeps a DM upload while a DM
// names it in `text` or `attachment_refs`. An encrypted DM's text is '' and its
// content ciphertext, so attachment_refs is the only reference the server sees.
// These checks pin every client send and edit path to the helper that fills it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const { attachmentKeysIn } = await import("../../shared/dm-e2ee-sending.ts");

function walk(dir) {
  return fs
    .readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? entry.name === "node_modules"
          ? []
          : walk(path.join(dir, entry.name))
        : /\.(ts|tsx|cjs|js)$/.test(entry.name)
          ? [path.join(dir, entry.name)]
          : [],
    );
}

test("an encrypted attachment message's plaintext names its upload key", () => {
  const key = "attachments/private/0f8fad5b-d9cb-469f-a165-70867728950e";
  const text = `__DECAVE_DM_ATTACHMENT__${JSON.stringify({ id: "x", name: "a.png", url: `/uploads/${key}`, fileKey: "k" })}`;
  assert.deepEqual(attachmentKeysIn(text), [key]);
});

test("the shared DM body adds attachmentKeys next to every envelope", () => {
  for (const file of ["shared/dm-e2ee-sending.ts", "mobile/src/lib/e2ee/dm-e2ee-sending.ts"]) {
    const source = read(file);
    assert.match(source, /"envelope" in sealed \? \{ \.\.\.sealed, attachmentKeys: attachmentKeysIn\(text\) \}/, file);
    assert.match(source, /const sealed = await dmSealedBody\(/, `${file}: socket frames go through dmSealedBody`);
  }
});

test("no web, desktop or mobile code seals a DM outside the shared helper", () => {
  const offenders = [];
  for (const dir of ["src", "electron", "mobile/app", "mobile/src"]) {
    for (const file of walk(dir)) {
      const normalized = file.replace(/\\/g, "/");
      if (normalized.endsWith("dm-e2ee-sending.ts")) continue;
      if (/\.seal\(/.test(fs.readFileSync(path.join(root, file), "utf8"))) offenders.push(normalized);
    }
  }
  assert.deepEqual(offenders, [], "DMs must be sealed through dmSealedBody/dmSocketFrame so attachmentKeys is sent");
});

test("send and edit paths on the server store the client's attachmentKeys", () => {
  const rest = read("worker/routes/direct-messages.ts");
  assert.equal((rest.match(/attachmentKeys: body\.attachmentKeys/g) ?? []).length, 2, "REST send and edit");
  assert.match(read("worker/HubRoom.ts"), /attachmentKeys: data\.attachmentKeys/, "socket send");
  // An edit without refs keeps the message's earlier refs rather than orphaning its upload.
  assert.match(rest, /outgoing\.attachmentRefs \|\| row\.attachment_refs/);
  // Group chats have no upload route, so group messages never own uploads.
  assert.doesNotMatch(read("worker/routes/group-chats.ts"), /\/attachments/);
});
