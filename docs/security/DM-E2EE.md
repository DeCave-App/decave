# End-to-end encrypted direct messages, group chats and calls

Status: **live since 6 October 2026 (release 0.1.132)** for direct messages
(with their reactions and poll votes), group chats, direct calls and voice
rooms. Hub rooms and forums are not end-to-end encrypted and are stored
readable, as before.

## The switch

Encryption is controlled by the Worker variable `DM_E2EE_ENABLED` in
`wrangler.jsonc`, now `"true"`. It covers messages and calls together: call
verification (see "Calls and voice rooms") uses the same account keys, which
are only created while the switch is on. Change it in `wrangler.jsonc` and run
`npm run cf:deploy`; changing it only in the Cloudflare dashboard is undone by
the next deploy.

While it's off, the key routes refuse to create keys, DMs and group messages
stay plaintext, calls connect unverified, and the apps show nothing about
encryption. Switching off again (the rollback) stops new keys and encryption,
but messages already encrypted stay encrypted and readable only in up-to-date
apps. [DM-E2EE-LAUNCH.md](DM-E2EE-LAUNCH.md) records the launch checklist and
what to watch after launch.

Apps that predate encryption keep working: their conversations stay plaintext
until both people update, and actions they can't encrypt (for example reacting
to an encrypted message) are refused with "Update DeCave" instead of being sent
in plaintext.

## What it protects

**Direct messages.** Once both people have opened an up-to-date DeCave, every new
message, edit, GIF, photo, poll, reaction and poll vote in that conversation is
encrypted on the sender's device and can only be decrypted by the two accounts'
devices.

**Group chats.** Once every member has a key, every new message is encrypted for
the members at that moment. From then on the group stays encrypted: the server
refuses plaintext, and only people who have a key can be added. Someone who
joins later can't read what was sent before they joined; someone who leaves
can't read what is sent after.

The Worker, D1 and R2 hold ciphertext. A database dump, a Cloudflare operator, or
DeCave staff cannot read those messages.

What the server still sees: who talks to whom and when, who is in a group,
message ids, sizes, that an account reacted to a message (not with what),
deletions, read receipts, typing indicators, and attachment sizes. Reply links
travel inside the ciphertext; the server stores no `reply_to_id` for encrypted
messages. Push notifications for encrypted messages say "Sent you an encrypted
message" and never quote it.

Messages sent before encryption stay stored readable. The apps show a divider
where a conversation's history switches to encrypted.

## Keys

Each account has **one current key**, shared by all of that account's devices.
It is a random 32-byte seed. HKDF-SHA256 derives an X25519 key (messages are
encrypted to it) and an Ed25519 key (messages are signed with it) from the
seed. The key id is the first 16 bytes of SHA-256 over both public keys. The
server publishes public keys (`decave_dm_keys`) and never receives a seed.

One key per account, rather than per device, is what lets every device read the
full history, which the server keeps (the apps have no local message database).

### Rotation and the keyring

A device rotates the account key when it is more than 30 days old:

1. It creates a new seed. The current key signs the new public key (a
   *succession certificate* over the account, both key ids and the new key).
2. It seals the new seed to the current key's X25519 key, so the account's other
   devices, which hold the current key, can open it.
3. It posts both to `POST /api/dm-keys/me/rotate`, with the recovery backup
   updated to include the new key. The Worker checks the certificate against the
   current key (WebCrypto Ed25519), so a stolen session without the seed can't
   rotate. Two devices rotating at once: the unique index on current keys lets
   one win; the other picks up the winner's key.

Devices keep the replaced keys in a **keyring** (newest first, at most 120), so
older messages stay readable. Another device of the account follows a rotation
on the `DM_KEYS_CHANGED` event or its next start, by opening each sealed
successor with the key before it. It needs no approval or recovery code.

Other people's apps follow the chain of certificates back to the account's
**root key** (its first key, or the key it last reset to). Key pins and safety
numbers use the root, so a rotation changes nothing they see. A reset has no
certificate, so it starts a new chain: the root changes and friends see a
"security code changed" notice.

### The history setting

By default devices keep replaced keys for good. In privacy settings the account
can choose to keep them for 365, 90 or 30 days after they are replaced
(`decave_dm_key_settings`). Devices then drop older keys from their keyring and
from the recovery backup. A device or recovery code stolen after that can't read
the messages those keys protected. This is forward secrecy at the granularity of
a month plus the chosen window, in exchange for those messages becoming
unreadable on the account's own devices too.

It applies to the account's own copies only. The other person's devices follow
their own setting, so a message stays readable to whichever side still keeps
the key.

### Where the key lives

| Platform | Storage |
| --- | --- |
| Web | IndexedDB (`decave-e2ee`), per account: the keyring's seeds |
| Desktop | The same IndexedDB record, holding the keyring wrapped by the OS keychain (Electron `safeStorage`), so a copied profile folder is useless without the user's OS login. Without a real keychain (Linux with no secret service) it stores the keyring as the web app does. |
| iOS and Android | The keyring encrypted (XChaCha20-Poly1305) in a file in the app's documents folder; that file's name and key in SecureStore (Keychain / Keystore, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`). The keyring can outgrow SecureStore's ~2 KB limit, so it can't be stored there directly. |

Choosing to sign out deletes the keyring from that device. Being signed out
because the account signed in elsewhere (DeCave allows one computer session and
one phone session) keeps it, so switching computers doesn't mean unlocking again.

### Getting the keys onto a device

1. **First device:** creates the key, publishes the public half, and stores a
   backup under a new **recovery code** (160 random bits as eight groups of four
   Crockford base32 characters). The code is shown once and must be confirmed as
   saved. If the app closes first, the next start creates and shows a fresh code,
   and the unseen one stops working.
2. **Approval from a signed-in device:** the new device creates a one-time X25519
   key pair and posts the public half. A signed-in device (in practice the phone
   approving a computer, or the reverse) seals the keyring to it. Both screens
   show a 12-digit comparison code derived from the request; the person checks
   they match before approving, so a server that swapped in its own key would be
   caught. The sealed keyring can be collected once, by the requesting session
   only. Requests expire after 10 minutes.
3. **Recovery code:** unlocks the server-held backup. The code derives an X25519
   key pair; the backup is the keyring sealed to its public half (`bpk`). Devices
   can therefore update the backup after a rotation or a history change without
   knowing the code. `bpk` is signed by the account key, and devices refuse to
   seal to a `bpk` the account didn't sign, so a server can't substitute a key it
   could open. The code has enough entropy that no slow KDF is needed and the
   server can't brute-force it.
4. **Reset:** if every device and the code are lost, the person can create a new
   key (password required). Old encrypted messages become unreadable, and their
   friends see a "security code changed" notice.

## Messages

`shared/dm-e2ee.ts` seals every encrypted item the same way:

- a random content key encrypts the payload with XChaCha20-Poly1305;
- the content key is wrapped for each reader's current account key (sender
  included) with an ephemeral X25519 key, HKDF and XChaCha20-Poly1305;
- the sender signs the whole envelope with Ed25519.

The signed header names a **scope** and binds the item's id, sender, recipient
and the sender's key id, so the server cannot move an item to another
conversation, give it another id, swap its content, or pass one kind of item
off as another:

| Scope | id | to | Payload |
| --- | --- | --- | --- |
| `message` (DM) | message id, chosen by the sender | the other person | `{ t: text, r?: replyToId }`, `t` in the text format the apps already use (attachments and polls included) |
| `reactions` (DM) | the message's id | the other person | `{ e: [emoji, …] }`: all of that account's reactions and poll votes (`poll_<index>`) on the message |
| `group` | message id, chosen by the sender | the group id | `{ t, r? }`, wrapped for every member (up to 20) |

The apps cache what they decrypted under the server's id, sender and
conversation as well as the signature, so an envelope shown again under another
id is checked again and refused.

The Worker checks only an envelope's shape and its addressing
(`worker/lib/dm-e2ee.ts`):

- **DMs:** sealed with the sender's current key, readable by both accounts'
  current keys. Once both accounts have keys, plaintext DMs are refused, so an old
  client can't silently downgrade a conversation.
- **Reactions:** one envelope per account per encrypted message
  (`decave_dm_reaction_envelopes`), replaced on every change and removed when
  empty. Plaintext reactions on an encrypted message are refused. Poll votes are
  single choice: the apps replace an earlier vote in the same envelope and ignore
  votes for options a poll doesn't have.
- **Groups:** wrapped for exactly the members' current keys, nobody left out and
  nobody extra. A group is marked encrypted (`decave_group_chats.e2ee_since`)
  with its first encrypted message.

A send that fails because a key or the member list changed is sealed again with
fresh keys and sent once more.

**Attachments** are encrypted before upload with their own random key and nonce.
The server sees an anonymous blob named `encrypted`; the real name, type, size
and file key travel inside the encrypted message. The message lists the uploads
it uses next to the envelope (`attachment_refs`), each checked to be the sender's
own upload for that conversation, so the daily cleanup of unsent uploads keeps
them and deleting the message deletes them.

## Calls and voice rooms

Voice rooms and direct calls are peer to peer: every participant has a WebRTC
connection to every other, relayed by Cloudflare TURN (relay-only, so nobody
learns anyone's IP address). The audio, video and screen share are encrypted
with DTLS-SRTP between the two devices; the TURN relay forwards ciphertext and
DeCave's servers never receive the media.

What the server could attack is the signaling: it relays each side's session
description, which carries that side's DTLS certificate fingerprint, and could
swap in its own to sit in the middle. So each device signs the fingerprints in
its description with its account key, for the specific peer
(`signRtcDescription` in `shared/dm-e2ee.ts`, sent as `auth` next to the
description), and the receiver checks the signature against that person's
current key (`verifyRtc` in the session):

- a description signed by the wrong key, or whose fingerprints were changed, is
  rejected: the app doesn't connect to it;
- **direct calls** are strict: if the friend has a key (or this device pinned
  one), an unsigned description is rejected too, and the call ends with an
  explanation;
- **voice rooms** treat an unsigned description as "not verified" rather than
  blocking it, so someone whose device is locked can still be heard. Verified
  participants show a lock next to their name.

When no peer key is available or pinned (for example, with encryption disabled
or an older app), an unsigned direct-call description may proceed unverified,
without a visible verification mark.

## Verifying people

Each conversation has a 60-digit **security code** (safety number) computed from
both accounts' root keys; both people see the same one, and it stays the same
across rotations. Comparing it in person or on a call rules out a substituted
key. The apps pin each peer's root key on first sight and show a notice when it
changes. People can mark a conversation as verified.

## Reporting and moderation

Reporting a message from an encrypted DM or group chat, on web, desktop or
mobile, attaches the reported message to the report's evidence (encrypted to the
safety team's P-256 key; on mobile with @noble, in the web app's format) and,
inside it, a **proof**: the message's signed envelope and that one message's
content key. The content key opens only that message.

A reviewer with the decrypted evidence and the sender's public key (from
`decave_dm_keys`) runs

```
node --experimental-strip-types scripts/ops/verify-dm-report.mjs evidence.json sender-key.json
```

It confirms that the reported account's key signed the message and that the
reported text is exactly what was sent. A reporter can't invent a message, pin
one on someone else, or change what it said.

## Code map

| Where | What |
| --- | --- |
| `shared/dm-e2ee.ts` | Crypto: keys, keyrings, rotation, recovery backup, envelopes (messages, reactions, groups), attachments, device linking, safety numbers, report proofs |
| `shared/dm-e2ee-format.ts` | Wire formats and shape checks (no crypto; the Worker uses this) |
| `shared/dm-e2ee-session.ts` | One device's flows: setup, unlock, approve, reset, rotation, history setting, key pins, open/seal |
| `shared/dm-e2ee-sending.ts` | Building DM, reaction and group requests and resending after a stale key, for both apps |
| `src/e2ee/` | Web/desktop storage, UI and helpers |
| `mobile/src/lib/e2ee/`, `mobile/src/providers/DmE2eeProvider.tsx` | Mobile storage, UI and helpers |
| `mobile/src/lib/report-evidence.ts` | Encrypted report evidence from the phone |
| `worker/routes/dm-keys.ts`, `worker/lib/dm-e2ee.ts` | Key, rotation, backup, setting and link-request routes; envelope checks |
| `migrations/0068_dm_e2ee.sql`, `migrations/0069_dm_e2ee_rotation_reactions.sql` | Tables (group chat columns are added by `ensureGroupChatSchema`) |
| `electron/main.cjs` (`decave:e2ee:*`) | Wrapping the desktop keyring with the OS keychain |
| `scripts/ops/verify-dm-report.mjs` | Checking a report about an encrypted message |

The mobile app can't import from outside its folder, so it keeps identical copies
of the four `shared/dm-e2ee*.ts` files. After changing them, run
`node scripts/dev/sync-dm-e2ee.mjs`; `scripts/__tests__/dm-e2ee.test.mjs` fails
while the copies differ.

All crypto is [@noble](https://paulmillr.com/noble/) (audited, pure
TypeScript), so the browser, Electron, React Native (Hermes) and the Node tests
run the same code. On Hermes, `expo-crypto` supplies the secure random source.

## Known limits

- **The server distributes keys and group membership.** On first contact the
  apps trust the key the server returns, then pin the root. Only comparing
  security codes rules out a key that was substituted from the start. In a group,
  the apps encrypt for the members the server lists; a member the server added
  would show in the member list, but nothing stops the server from listing one.
- **Someone with a stolen session** could publish a key for an account that has
  never set up encryption. The real owner then sees their messages as locked,
  and their friends would later see a security-code change when the owner resets.
  Resetting a key, unlike creating the first one, requires the password, and
  rotating requires the current key.
- **Someone with a stolen seed** can rotate the account's key too (the old key
  signs the new one). Resetting, which starts a new chain, is the way out.
- **Rollback:** the server could show an earlier version of an edited message or
  of someone's reactions (both versions are validly signed for the same id), or
  serve an older recovery backup.
- **Forward secrecy is coarse and opt-in.** It is monthly plus the chosen
  history window, and only for the account's own copies. There is no
  per-message ratchet and no post-compromise security against a device
  compromised for good: a stolen seed also follows future rotations.
- **Voice rooms** accept unsigned participants (shown without a lock). A server
  in the middle of one of those connections is only ruled out for participants
  with the lock. Room membership is the server's, as for groups.
- **Metadata** is not hidden (see "What it protects"), nor who is in a call.

## Not yet

- Hub rooms and forums.
- A per-device key ratchet (Signal-style forward secrecy and post-compromise
  security). It needs per-device keys and a local message store, which the apps
  don't have.
- Encrypting typing indicators and read receipts (judged not worth the cost; the
  server already sees that two people are talking).
