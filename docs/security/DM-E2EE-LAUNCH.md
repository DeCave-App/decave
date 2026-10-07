# Switching end-to-end encryption on: launch checklist

**Switched on 6 October 2026 with release 0.1.132** (`DM_E2EE_ENABLED` is
`"true"` in `wrangler.jsonc`) for DMs, group chats, direct calls and voice
rooms. The design is in [DM-E2EE.md](DM-E2EE.md).

Launch record: the switch was turned on by owner decision before the real-device
passes in sections 1 and 2 were completed; the automated tests (441) passed and the packaged Windows build was
launch-checked. The two-account production smoke test in section 4 is still
to do. Work through
the unticked device items below on the next mobile and desktop builds, and
keep section 5 as the post-launch watch list. To roll back, see section 5.

Encryption for DMs and group chats shipped dark behind `DM_E2EE_ENABLED`
(`wrangler.jsonc`, then `"false"`). The list below is what to check around the
switch, in order.

Tick each box in a copy of this list (an issue or the release notes) and note
who checked it, on which device and build.

## 0. Server prerequisites (every deploy, encryption on or off)

- [ ] Take a D1 bookmark before migrating:
      `npx wrangler d1 time-travel info YOUR_D1_DATABASE`.
- [ ] Apply migrations to production **before** deploying a Worker that needs
      them: `npx wrangler d1 migrations apply YOUR_D1_DATABASE --remote`.
      `0069_dm_e2ee_rotation_reactions.sql` adds `attachment_refs`, which the DM
      send path writes even while encryption is off.
- [ ] `npm run check` is green on the commit being deployed.

## 1. Mobile app (iOS and Android, real devices)

Use a build from the commit that will ship, on at least one iPhone and one
Android phone, against a staging Worker with `DM_E2EE_ENABLED=true` (for
example `npx wrangler dev --var DM_E2EE_ENABLED:true` with a test database, or a
separate staging Worker). Use test accounts only.

Setup and unlocking
- [ ] Fresh account, first device is the phone: the recovery code appears, can
      be copied or shared, and must be confirmed. Closing the app before
      confirming shows a new code on next launch.
- [ ] Sign in on a computer: it is locked; approve it from the phone. The
      12-digit codes match on both screens.
- [ ] Unlock a second phone (or reinstall) with the recovery code.
- [ ] Reinstalling the app without the code and without another device: the
      app stays locked and offers reset. Reset asks for the password.
- [ ] Choosing "Sign out" removes the key (next sign-in is locked). Being signed
      out by a sign-in elsewhere keeps it.
- [ ] Locking the phone screen and reopening: messages still decrypt (the key is
      readable while unlocked).

Direct messages
- [ ] Text, edits, replies, GIFs and photos in both directions, phone ↔
      computer, read correctly; the lock badge and security code show.
- [ ] Reactions from the phone show on the computer and back; toggling one off
      works. Poll votes (the phone has no poll UI, so vote on web and desktop):
      changing a vote replaces it.
- [ ] A conversation with someone on an old build stays plaintext, with no
      errors; after they update, the divider appears where encryption starts.
- [ ] Push notifications say "Sent you an encrypted message" and never the text.
- [ ] Poor network / airplane mode, then reconnect: unsent messages fail visibly,
      nothing is sent in plaintext.

Group chats
- [ ] A group where everyone is up to date becomes encrypted with the first
      message: lock in the header, messages read on every member's devices.
- [ ] Adding a friend who has no key is refused with a clear message; after they
      open an up-to-date app they can be added, and older messages show as
      unreadable for them.
- [ ] Removing a member, then sending: the removed member's app doesn't get it.

Key rotation and history
- [ ] Rotation: set the phone's date 31 days ahead and reopen the app. The key id
      in settings changes; the computer picks up the new key without approval;
      friends see no "security code changed" notice and the same security code;
      old messages still read on every device. Restore the date afterwards.
- [ ] History setting: choose 30 days on a test account with rotated keys older
      than that; old encrypted messages show as unreadable on all its devices,
      newer ones still read. The recovery code still unlocks a new device.

Reports
- [ ] Report an encrypted DM and an encrypted group message from the phone. In
      the safety review tools the evidence decrypts and
      `scripts/ops/verify-dm-report.mjs` accepts it with the sender's key.

## 2. Desktop app (packaged builds)

On each platform's packaged build (not `electron:dev`):
- [ ] Windows, macOS, Linux with a secret service: after setup, the IndexedDB
      record `decave-e2ee/account-keys` is `{ v: 1, keychain: … }` (DevTools →
      Application → IndexedDB), not raw bytes.
- [ ] Copy the profile folder to another OS user or machine: the app there is
      locked.
- [ ] Linux without a secret service (`basic_text`): the app still works and
      stores the keyring as the web app does.
- [ ] Rotation on desktop (advance the clock 31 days) and approval of a phone
      from the desktop.

## 3. Legal and product

- [ ] Legal review of the texts that go live with the switch:
      `website/src/privacy-policy.ts` (sections 2 and 4, generated into
      `docs/legal/PRIVACY-POLICY.md`), `website/src/legal.tsx` (Terms section 5),
      `website/src/pages.tsx` (FAQ), `website/src/home.tsx`, and
      `docs/legal/TERMS-OF-SERVICE.md`.
- [ ] The privacy policy's effective date is the launch date.
- [ ] Support has an answer for "I lost my recovery code and my devices" (reset;
      old encrypted messages are gone) and "messages say they can't be read"
      (unlock; or the history setting).

## 4. Switching on

- [ ] The mobile build from step 1 is live in both stores, and enough people
      have updated (check the share of mobile sessions on the new version).
- [ ] Set `"DM_E2EE_ENABLED": "true"` in `wrangler.jsonc`, commit, and run
      `npm run cf:deploy`.
- [ ] Deploy the website: `npm --prefix website run deploy`.
- [ ] Smoke test in production with two staff accounts: setup, a DM, a reaction,
      a group of three.

## 5. After switching on

- [ ] Watch the security events (`dm_e2ee.*` in the account security log) and
      Worker logs for `DM_E2EE_*` error codes for the first days. A steady stream
      of `DM_E2EE_REQUIRED` means old clients are still around.
- [ ] Rolling back: set the variable to `"false"` and deploy. New messages are
      plaintext again; messages already encrypted stay encrypted and readable in
      up-to-date apps only.
