import assert from "node:assert/strict";
import test from "node:test";

import * as desktop from "../../src/features/media/attachment-download.ts";
import * as mobile from "../../mobile/src/lib/legacy-attachment-download.ts";

const BASE = "https://app.example.test";
const ATTACHMENT = `${BASE}/uploads/attachments/private/object-1`;

function responseWithUrl(body, url = ATTACHMENT, init = {}) {
  const response = new Response(body, { status: 200, ...init });
  Object.defineProperty(response, "url", { configurable: true, value: url });
  return response;
}

function fakeDocument(state) {
  const body = {
    appendChild(anchor) {
      state.appended = anchor;
    },
  };
  return {
    body,
    createElement() {
      return {
        style: {},
        click() {
          state.clicked = true;
        },
        remove() {
          state.removed = true;
        },
      };
    },
  };
}

for (const [name, implementation] of [
  ["desktop", desktop],
  ["mobile", mobile],
]) {
  test(`${name} attachment URL validation is same-origin and path constrained`, () => {
    assert.equal(
      implementation.validateLegacyAttachmentUrl("/uploads/attachments/private/object-1", BASE).href,
      ATTACHMENT,
    );
    for (const value of [
      "https://evil.example.test/uploads/attachments/private/object-1",
      "https://user:pass@app.example.test/uploads/attachments/private/object-1",
      "/uploads/attachments/private/object-1?token=secret",
      "/uploads/attachments/private/object-1#fragment",
      "/uploads/attachments/private/../object-1",
      "/uploads/attachments/private/%2e%2e/object-1",
      "/uploads/attachments/private/%2fobject-1",
      "/uploads/attachments/private\\object-1",
      "/uploads/private/object-1",
      "/uploads/attachments/",
    ]) {
      assert.throws(
        () => implementation.validateLegacyAttachmentUrl(value, BASE),
        (error) => error?.code === "invalid-url",
        value,
      );
    }
  });

  test(`${name} attachment filenames cannot escape the selected destination`, () => {
    assert.equal(implementation.sanitizeLegacyAttachmentFilename("..\\private/secret?.txt"), ".._private_secret_.txt");
    assert.equal(implementation.sanitizeLegacyAttachmentFilename("   "), "attachment.bin");
    assert.equal(implementation.sanitizeLegacyAttachmentFilename("report.pdf. "), "report.pdf");
  });
}

test("desktop attachment download authenticates through supplied fetch and revokes its object URL", async () => {
  const calls = [];
  const state = {};
  const revoked = [];
  const result = await desktop.downloadLegacyAttachmentDesktop({
    url: ATTACHMENT,
    baseUrl: BASE,
    filename: "report.pdf",
    authorizedFetch: async (url, init) => {
      calls.push({ url, init });
      return responseWithUrl(new Uint8Array([1, 2, 3]));
    },
    documentRef: fakeDocument(state),
    urlRef: {
      createObjectURL: () => "blob:test-attachment",
      revokeObjectURL: (url) => revoked.push(url),
    },
  });

  assert.deepEqual(result, { filename: "report.pdf", bytes: 3 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ATTACHMENT);
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(state.clicked, true);
  assert.equal(state.removed, true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(revoked, ["blob:test-attachment"]);
});

test("desktop attachment download rejects network failures without creating an export", async () => {
  await assert.rejects(
    () =>
      desktop.downloadLegacyAttachmentDesktop({
        url: ATTACHMENT,
        baseUrl: BASE,
        authorizedFetch: async () => {
          throw new Error("offline");
        },
        documentRef: fakeDocument({}),
        urlRef: { createObjectURL: () => "unused", revokeObjectURL: () => {} },
      }),
    (error) => error?.code === "network-failure",
  );
});

test("download helpers reject redirected or externally resolved responses", async () => {
  const redirected = responseWithUrl(new Uint8Array([1]));
  Object.defineProperty(redirected, "redirected", { configurable: true, value: true });
  await assert.rejects(
    () =>
      desktop.downloadLegacyAttachmentDesktop({
        url: ATTACHMENT,
        baseUrl: BASE,
        authorizedFetch: async () => redirected,
        documentRef: fakeDocument({}),
        urlRef: { createObjectURL: () => "unused", revokeObjectURL: () => {} },
      }),
    (error) => error?.code === "invalid-response",
  );

  await assert.rejects(
    () =>
      mobile.downloadLegacyAttachmentMobile({
        url: ATTACHMENT,
        baseUrl: BASE,
        platform: "android",
        apiFetch: async () =>
          responseWithUrl(new Uint8Array([1]), "https://evil.example.test/uploads/attachments/object-1"),
        fileSystem: {
          StorageAccessFramework: {
            async requestDirectoryPermissionsAsync() {
              return { granted: true, directoryUri: "content://unused" };
            },
            async createFileAsync() {
              return "content://unused/file";
            },
            async writeAsStringAsync() {},
          },
        },
      }),
    (error) => error?.code === "invalid-response",
  );
});

test("bounded streaming body cancels an oversized response and detects truncation", async () => {
  let cancelled = false;
  const oversized = {
    headers: new Headers(),
    body: {
      getReader() {
        return {
          async read() {
            return { done: false, value: new Uint8Array(6) };
          },
          async cancel() {
            cancelled = true;
          },
          releaseLock() {},
        };
      },
    },
  };
  await assert.rejects(
    () => desktop.readBoundedLegacyAttachmentBody(oversized, 5),
    (error) => error?.code === "too-large",
  );
  assert.equal(cancelled, true);

  const truncated = responseWithUrl(new Uint8Array([1, 2]), ATTACHMENT, {
    headers: { "Content-Length": "3" },
  });
  await assert.rejects(
    () => desktop.readBoundedLegacyAttachmentBody(truncated),
    (error) => error?.code === "invalid-response",
  );
});

test("non-streaming bodies require a bounded decoded-size header", async () => {
  const unbounded = {
    headers: new Headers(),
    body: {},
    async arrayBuffer() {
      return new Uint8Array([1]).buffer;
    },
  };
  await assert.rejects(
    () => mobile.readBoundedLegacyAttachmentBody(unbounded),
    (error) => error?.code === "invalid-response",
  );

  const compressed = {
    headers: new Headers({ "Content-Length": "1", "Content-Encoding": "gzip", "X-DeCave-Attachment-Size": "3" }),
    body: null,
    async arrayBuffer() {
      return new Uint8Array([1, 2, 3]).buffer;
    },
  };
  assert.equal((await mobile.readBoundedLegacyAttachmentBody(compressed)).byteLength, 3);
});

test("mobile Android export uses apiFetch, redirect error, and user-selected SAF directory", async () => {
  const calls = [];
  const writes = [];
  const fakeFileSystem = {
    EncodingType: { Base64: "base64" },
    StorageAccessFramework: {
      async requestDirectoryPermissionsAsync() {
        return { granted: true, directoryUri: "content://selected" };
      },
      async createFileAsync(parent, filename, mime) {
        writes.push({ parent, filename, mime });
        return "content://selected/report.pdf";
      },
      async writeAsStringAsync(uri, contents, options) {
        writes.push({ uri, contents, options });
      },
    },
  };
  const result = await mobile.downloadLegacyAttachmentMobile({
    url: ATTACHMENT,
    baseUrl: BASE,
    token: "synthetic-token",
    filename: "report.pdf",
    platform: "android",
    apiFetch: async (path, init, token) => {
      calls.push({ path, init, token });
      return responseWithUrl(new Uint8Array([1, 2, 3]));
    },
    fileSystem: fakeFileSystem,
  });
  assert.deepEqual(result, { filename: "report.pdf", bytes: 3, uri: "content://selected/report.pdf" });
  assert.equal(calls[0].path, "/uploads/attachments/private/object-1");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].token, "synthetic-token");
  assert.deepEqual(writes, [
    { parent: "content://selected", filename: "report.pdf", mime: "application/octet-stream" },
    { uri: "content://selected/report.pdf", contents: "AQID", options: { encoding: "base64" } },
  ]);
});

test("mobile iOS saves to the app documents folder and opens the share sheet", async () => {
  const writes = [];
  const shared = [];
  const result = await mobile.downloadLegacyAttachmentMobile({
    url: ATTACHMENT,
    baseUrl: BASE,
    filename: "report final.pdf",
    platform: "ios",
    apiFetch: async () => responseWithUrl(new Uint8Array([1, 2, 3])),
    fileSystem: {
      EncodingType: { Base64: "base64" },
      documentDirectory: "file:///docs/",
      writeAsStringAsync: async (uri, contents, options) => {
        writes.push({ uri, contents, options });
      },
      StorageAccessFramework: {
        requestDirectoryPermissionsAsync: async () => {
          throw new Error("no SAF on iOS");
        },
      },
    },
    share: async (content) => {
      shared.push(content);
    },
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].uri, "file:///docs/report%20final.pdf");
  assert.equal(writes[0].contents, "AQID");
  assert.deepEqual(shared, [{ url: "file:///docs/report%20final.pdf", title: "report final.pdf" }]);
  assert.equal(result.bytes, 3);
});

test("mobile export on an unsupported platform fails before making a network request", async () => {
  let called = false;
  await assert.rejects(
    () =>
      mobile.downloadLegacyAttachmentMobile({
        url: ATTACHMENT,
        baseUrl: BASE,
        platform: "web",
        apiFetch: async () => {
          called = true;
          return responseWithUrl(new Uint8Array());
        },
      }),
    (error) => error?.code === "export-unavailable",
  );
  assert.equal(called, false);
});
