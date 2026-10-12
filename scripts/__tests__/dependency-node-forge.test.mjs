import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signWithNode } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const forge = require("../../vendor/node-forge");
const { BigInteger } = require("../../vendor/node-forge/lib/jsbn");
const packageMetadata = JSON.parse(
  readFileSync(new URL("../../vendor/node-forge/package.json", import.meta.url), "utf8"),
);

test("vendored package includes the security patch provenance", () => {
  assert.equal(packageMetadata.name, "node-forge");
  assert.equal(packageMetadata.version, "1.4.1-decave.1");
  assert.equal(packageMetadata.private, true);
  assert.ok(packageMetadata.files.includes("VENDOR_PATCH.md"));
});

// Public e=3 test key and signatures reproduced from node-forge PR #1159,
// which documents the CVE-2026-85393 regression vectors.
const lowExponentModulus = [
  "e932ac92252f585b3a80a4dd76a897c8b7652952fe788f6ec8dd640587a1ee56",
  "47670a8ad4c2be0f9fa6e49c605adf77b5174230af7bd50e5d6d6d6d28ccf0a8",
  "86a514cc72e51d209cc772a52ef419f6a953f3135929588ebe9b351fca61ced7",
  "8f346fe00dbb6306e5c2a4c6dfc3779af85ab417371cf34d8387b9b30ae46d7a",
  "5ff5a655b8d8455f1b94ae736989d60a6f2fd5cadbffbd504c5a756a2e6bb5ce",
  "cc13bca7503f6df8b52ace5c410997e98809db4dc30d943de4e812a47553dce5",
  "4844a78e36401d13f77dc650619fed88d8b3926e3d8e319c80c744779ac5d6ab",
  "e252896950917476ece5e8fc27d5f053d6018d91b502c4787558a002b9283da7",
].join("");
const exploitDigest = "7509e5bda0c762d2bac7f90d758b5b2263fa01ccbc542ab5e3df163be08e6ca9";
const exploitKey = forge.pki.rsa.setPublicKey(new BigInteger(lowExponentModulus, 16), new BigInteger("3", 10));

function asBinary(hex) {
  return Buffer.from(hex, "hex").toString("binary");
}

function digestSha256(message) {
  const digest = forge.md.sha256.create();
  digest.update(message, "utf8");
  return digest.digest().getBytes();
}

test("rejects the published e=3 DigestAlgorithm element-forgery signature", () => {
  const forgedSignature = asBinary(
    [
      "3408bdfaeca12b29c6ac284f95aca731a14f9c06125cca16d54ae0cc3f6fe6ff",
      "0005425b3dcd8122ef4c94781556a3d174f72e1cd5df0c79aed2d0b617fdd52",
      "ec430eae767873065d9a770c57b8c451775afe3bdc0bb86ff4d9319d2008548",
      "ae653308ba32be9b456710e7e04cc39232db5794b06afa95eed00697d32efd3",
      "46155fd483ec1709c281aeb4253c967494fe4f30be67bacb0b41f343d1c767e",
      "808b6370039d16b7c13a7921965c37062ddca94cc519c4569e5a8abf5245886",
      "e3b6deb8224994db79f7189da3090bf50d3bdd4257f472aeafae7240db7ed40",
      "e5583588305d94d61e24e7749b2225b8e3c0c793f94a0a6cd4907e6f35cd20e",
      "ad3be37",
    ].join(""),
  );

  assert.equal(digestSha256("hello world!"), asBinary(exploitDigest));
  assert.throws(() => exploitKey.verify(asBinary(exploitDigest), forgedSignature));
});

test("rejects other non-canonical nested DigestInfo encodings", () => {
  const malformedSignatures = [
    {
      name: "non-NULL second AlgorithmIdentifier element",
      hex: [
        "949824e00859dfb3b773511c7154655f0ec8d00ac794a90149a675d03f507418",
        "d695d41e7f05a164a6da6f06a7f4ecf9ef32be436ecb55856dd6fad5b30ac958",
        "3b165843a0d7b6e9fd64446370683c89c0bb3329a766b6caf77379e4ff9b62cd",
        "0e11f7cdd9598678a86bbcb84e4323ed2dac268df54861d9b6d2d92699ce85a6",
        "f2c5170d293ea218ee3d386cfb9980191903428618150b9136b266c664635979",
        "968f7dfaf3ecd18dfb894c9681794099b86cfe76d7110b258284744d21b1822b",
        "0d97793e6e7f4335807b18366037c7a70d42a6f8519194168db0d7dca805084b",
        "7808df9cc831ba2036708e77ca7a0b9753a2043925d897a5b0dbf4db6b46a74a",
      ].join(""),
    },
    {
      name: "NULL parameters containing bytes",
      hex: [
        "6cbe22adc4ee40e1d0feb9610bb0dbff668920486cb702f97c5facbbca980bf9",
        "b7130378f9c26f48dcaa6f6aee893880a2bba807ceae692f1db84510e0b1bdf9",
        "1516ae082e9fdce6cc894b9a71da05da94eb67b2e66b7ac624737a9062619860",
        "cda4325bab5618749e865f6b234f480b4f34c6eedf980109d5706090da9a6ab9",
        "8e51da2657908cfdf624526eccf531918f3af0f8c277b1bc22285048c39e1628",
        "b4c4f9345ac388bfa622577dc2e1c00ea53cbcdecaf06ea647ad690801d2ba40",
        "665ec4a03ec89364a04456e66b49d99c2b7256cf55e0273d1875efef5214bf35",
        "c5d833d0e542dac41abf0292852e5078f5af0018318687afed57b953ca49674f",
      ].join(""),
    },
    {
      name: "non-minimal long-form DER lengths",
      hex: [
        "4f818f8bcdd0933f8016b285fad842a79e7a6580b0186703e5aa2fea9b438034",
        "258698f1a0964f59647ebcfd3a151abeed5c6632a416e5439a4cdfb1e01f43e1",
        "6f6e310369a15006d9838efaade707e81b812d4968d0585e9536ccd5d9511301",
        "644fbcd307f2abc6e8aefdd642d076f3afd7a9669e3e7b84c17fe2cf46ae7e26",
        "1742f8e626d5323eaa3eb5d613e568024a671d6b740d523ab7f856dec0b3151a",
        "b9e7115daff812a966f56d745941aa1fc15a320df759f690998d4afbe2649876",
        "f3f68fb9104dbfc26b7d9af4248bc15a2aa2fd7aaa47eb72ae01b231915b652a",
        "68ab0bca1646e48933be3b260a0227906c4812e0dd2f165014c27abacea9c7ac",
      ].join(""),
    },
  ];

  for (const { name, hex } of malformedSignatures) {
    assert.throws(
      () => exploitKey.verify(asBinary(exploitDigest), asBinary(hex), undefined, { _skipPaddingChecks: true }),
      /ASN\.1 object does not contain a valid RSASSA-PKCS1-v1_5 DigestInfo value\./,
      name,
    );
  }
});

test("accepts a valid parameter-less SHA-256 DigestInfo signature", () => {
  const signature = asBinary(
    [
      "a0073057133ff3758e7e111b4d7441f1d8cbe4b2dd5ee4316a14264290dee5ed",
      "7f175716639bd9bb43a14e4f9fcb9e84dedd35e2205caac04828b2c053f68176",
      "d971ea88534dd2eeec903043c3469fc69c206b2a8694fd262488441ed8852280",
      "c3d4994e9d42bd1d575c7024095f1a20665925c2175e089c0d731471f6cc1454",
      "04edf5559fd2276e45e448086f71c78d0cc6628fad394a34e51e8c10bc39bfe0",
      "9ed2f5f742cc68bee899d0a41e4c75b7b80afd1c321d89ccd9fe8197c44624d9",
      "1cc935dfa48de3c201099b5b417be748aef29248527e8bbb173cab76b48478d4",
      "177b338fe1f1244e64d7d23f07add560d5ad50b68d6649a49d7bc3db686daaa7",
    ].join(""),
  );

  assert.equal(exploitKey.verify(asBinary(exploitDigest), signature), true);
});

test("accepts a standards-compliant SHA-256 signature with NULL parameters", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 1024,
    publicExponent: 0x10001,
  });
  const message = Buffer.from("valid node-forge signature compatibility test");
  const signature = signWithNode("sha256", message, privateKey);
  const forgeKey = forge.pki.publicKeyFromPem(
    publicKey.export({
      type: "spki",
      format: "pem",
    }),
  );

  assert.equal(forgeKey.verify(digestSha256(message.toString("utf8")), signature.toString("binary")), true);
});
