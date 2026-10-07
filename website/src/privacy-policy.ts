// The DeCave Privacy Policy, as data. The website renders it (legal.tsx) and
// scripts/dev/render-privacy-policy.mjs writes docs/legal/PRIVACY-POLICY.md
// from it, so the two never drift. Inline **bold** is supported; email
// addresses and https links become links on the website.
//
// Retention periods must match worker/retention.ts (RETENTION_DAYS).

export type PolicyBlock = { p: string } | { list: string[] } | { table: { head: [string, string]; rows: [string, string][] } };

export type PolicySection = { id: string; nav: string; title: string; blocks: PolicyBlock[] };

export const PRIVACY_POLICY = {
  title: "DeCave Privacy Policy",
  effective: "6 October 2026",
  draftNote:
    "Implementation draft: replace the controller address and confirm the processing regions and transfer safeguards with counsel before treating this as the final legal notice.",
  intro: [
    "This policy explains what personal data DeCave collects when you use the DeCave website, web app, desktop apps and mobile app (the **Service**), why we need it, who receives it, how long we keep it and what your rights are. DeCave is an alpha service for adults aged 18 and over.",
    "We collect only what a feature needs. We do not sell personal data, show ads, use advertising or analytics SDKs, or use your messages to train AI models.",
  ],
  sections: [
    {
      id: "privacy-controller",
      nav: "Who we are",
      title: "1. Who is responsible",
      blocks: [
        {
          p: "The controller is **DeCave**, [CONTROLLER ADDRESS]. Contact us about privacy at security@de-cave.com. We have not appointed a data protection officer; if the law requires one or an EU/UK representative, we will name them here.",
        },
      ],
    },
    {
      id: "privacy-collection",
      nav: "What we collect",
      title: "2. What we collect and why",
      blocks: [
        { p: "**Your account.** Email address, username, display name, password (stored only as a salted hash), profile picture, banner, bio, status, settings, and when the account was created. Needed to run your account (contract)." },
        { p: "**Your age.** You enter your birth date when signing up. We use it once to confirm you are 18 or older and keep only the result (eligible or not) and when it was checked, never the date itself. Needed to keep the Service adults-only (legal obligation and legitimate interest)." },
        { p: "**What you post and send.** Messages in Hubs, direct and group messages, forum posts, reactions, polls, files, Hub artwork, stickers and soundboard sounds. Direct messages (with their photos, files, reactions and poll votes) and group chats are end-to-end encrypted once everyone in the conversation uses an up-to-date DeCave, so we can't read them (see section 4). Everything else, and messages sent before encryption, is stored readable on our servers so it can be delivered, synced, searched and moderated. Needed to provide the features you use (contract)." },
        { p: "**Your connections.** Friends and requests, blocks and mutes, Hubs, roles and invites, event RSVPs, Squad Finder searches, and your online status and the last time you were online. Needed to provide those features (contract)." },
        { p: "**Sign-ins and security.** For each signed-in device: the app or browser and operating system, the country it connected from, and when it was last used. A security log of account events (for example sign-ins, password changes) with the browser's user agent. We do not store your IP address. Needed to show you where you're signed in, alert you about new sign-ins and protect accounts (legitimate interest)." },
        { p: "**Game activity (optional).** If you turn it on, the desktop app checks locally which game is running; only the game name and start time are sent to us. If you link Steam and turn on Steam presence, we read your public Steam profile and current game. New accounts share activity with friends only. Based on your choice (consent); you can turn it off at any time." },
        { p: "**Reports and moderation.** If you report something: the category, your description and any evidence you choose to attach (encrypted on your device before upload). If someone reports you: the report and the moderation decision. Needed to keep the Service safe and to meet our duties for online platforms (legitimate interest and legal obligation)." },
        { p: "**Feedback.** What you write in Feedback and an optional reply email. Used to answer you and improve the Service (legitimate interest)." },
        { p: "Calls and voice rooms are not recorded. Giving us your email, username, password and birth date is required to create an account; everything else is optional or created by what you do." },
      ],
    },
    {
      id: "privacy-recipients",
      nav: "Who receives it",
      title: "3. Who receives your data",
      blocks: [
        { p: "**Other people on DeCave** see what you share with them: your profile, messages in the Hubs and conversations you post in, your online status, and your game activity if you share it." },
        { p: "**Service providers who process data on our behalf:**" },
        {
          list: [
            "**Cloudflare** hosts the Service (servers, database, file storage, realtime connections), sends our emails, provides the bot check at sign-in (Turnstile) and relays voice and video calls (TURN).",
            "**Expo**, with Apple and Google, delivers mobile push notifications. A notification contains the route to open and, only if you enable previews, the sender and a short preview.",
          ],
        },
        { p: "**Services you choose to use:**" },
        {
          list: [
            "**Steam**, when you link your account: we receive your public Steam profile and current game.",
            "**GIPHY**, for GIF search: we forward your search words. GIFs are loaded through our servers, so GIPHY never sees who searches for or views them.",
          ],
        },
        { p: "We disclose data to authorities only when the law requires it, and to a successor if DeCave is reorganised or sold. We never sell data." },
      ],
    },
    {
      id: "privacy-calls",
      nav: "Calls and security",
      title: "4. Calls, encryption and security",
      blocks: [
        { p: "**End-to-end encrypted direct messages and group chats.** These are encrypted on the sender's device and can only be read on the devices of the people in the conversation (in a group, its members at the time a message is sent). Reactions and poll votes in direct messages are encrypted too. We store the encrypted messages, each account's public keys, and a copy of your keys locked with a recovery code that only you have. Your key changes every month. You can choose to have your devices forget old keys after 30, 90 or 365 days; encrypted messages older than that then can't be read on your devices any more. We still see who messaged whom and when, who is in a group, message sizes, and that someone reacted. If you lose every signed-in device and your recovery code, we can't recover your encrypted messages. If you report an encrypted message, your device includes a proof that lets our safety team confirm who sent it and what it said." },
        { p: "**Encrypted calls.** Voice, video and screen sharing in direct calls and voice rooms use DTLS-SRTP between participants' devices through Cloudflare TURN relays, which forward encrypted media. A direct call rejects an invalid signature and rejects a missing signature when the peer's key is available or pinned. If no peer key is available or pinned, an unsigned description may proceed without a visible verification mark. A voice room can admit an unverified participant, shown without a lock; for an unverified participant, a signaling-level interception is not ruled out. All call traffic goes through Cloudflare's relay servers, so the people you talk to never see your IP address. We still see who is in a call or voice room and when. Web traffic is protected by TLS." },
        { p: "We protect data with hashed passwords and tokens, access controls, rate limits, two-factor authentication for accounts that enable it, and limited staff access. No system is completely secure; tell us promptly at security@de-cave.com if you suspect a problem." },
      ],
    },
    {
      id: "privacy-retention",
      nav: "How long we keep it",
      title: "5. How long we keep data",
      blocks: [
        { p: "We delete data automatically when it is no longer needed:" },
        {
          table: {
            head: ["Data", "Kept for"],
            rows: [
              ["Your account, profile, messages, files, connections", "Until you delete them or your account"],
              ["Sign-in sessions and one-time links or codes", "Until they expire, are used or you sign out"],
              ["Security log (account events, user agent)", "180 days"],
              ["Devices remembered for sign-in alerts", "1 year after last use"],
              ["Evidence attached to a report", "6 months after the case is closed"],
              ["Reports, moderation cases and decisions", "1 year after the case is closed"],
              ["Moderation and admin audit logs", "1 year"],
              ["Hub moderation history (kicks, bans, role changes)", "6 months"],
              ["Feedback", "1 year"],
              ["Squad Finder searches", "Until the search expires"],
              ["Uploads never sent in a message", "1 day"],
              ["Request logs at our hosting provider (a sample of requests)", "A few days"],
            ],
          },
        },
        { p: "Moderation data can be kept longer only while a case is under legal hold. The 6-month evidence period lets people contest a moderation decision, as EU law requires; the security-log period follows European data-protection authorities' guidance on security logging." },
        { p: "**Deleting your account.** You can delete your account in Settings. It is closed immediately and permanently erased after 30 days, so you can change your mind. If you own a Hub, transfer it to someone else first. Erasure removes your profile, messages, direct messages, files, connections, settings and devices. We keep only a minimal record that the account existed (to stop its ID being reused), plus security-log and moderation entries until their periods above end. People you messaged may have kept their own copies. Database recovery copies roll off within 30 days." },
        { p: "Accounts found to be under 18 are erased 30 days after we find out, unless an admin confirms the person is 18 or older." },
        { p: "Deleting a direct message you sent deletes it and its files for both people. Deleting a whole conversation hides it for you only; the other person keeps their copy." },
      ],
    },
    {
      id: "privacy-device",
      nav: "On your device",
      title: "6. What stays on your device",
      blocks: [
        { p: "The apps keep your sign-in session, settings, drafts and notes on your device. The desktop app's game check runs entirely on your computer. The website stores only your theme choice and uses no cookies for tracking. We ask for microphone, camera, screen and notification permissions only when you use those features; you can withdraw them in your device settings." },
      ],
    },
    {
      id: "privacy-rights",
      nav: "Your rights",
      title: "7. Your rights",
      blocks: [
        { p: "You can access, correct, delete or download your data, object to or restrict processing based on legitimate interest, and withdraw consent at any time (for example by turning off game activity or unlinking Steam). Download your data in Settings → Account → Download my data, or delete your account in Settings → Account." },
        { p: "For anything else, email security@de-cave.com with the subject \"Privacy request\". We answer within one month and may ask you to confirm the request comes from your account. You can also complain to your local data-protection authority." },
        { p: "We do not make decisions about you based solely on automated processing. Rate limits and spam checks only slow down or pause actions; moderation decisions are made by people." },
      ],
    },
    {
      id: "privacy-transfers",
      nav: "International transfers",
      title: "8. International transfers",
      blocks: [
        { p: "Cloudflare and Expo may process data outside your country, including in the United States. Where data leaves the EU or UK, it is protected by safeguards such as the EU–US Data Privacy Framework or the European Commission's standard contractual clauses." },
      ],
    },
    {
      id: "privacy-children",
      nav: "Age",
      title: "9. Age requirement",
      blocks: [
        { p: "DeCave is for adults only. You must be at least 18, or older where local law sets a higher age of majority. We do not knowingly collect data from anyone under 18. If you believe someone under 18 has an account, tell us at security@de-cave.com." },
      ],
    },
    {
      id: "privacy-changes",
      nav: "Changes",
      title: "10. Changes",
      blocks: [
        { p: "When this policy changes, we update the date above and tell you in the app before significant changes take effect." },
      ],
    },
    {
      id: "privacy-contact",
      nav: "Contact",
      title: "11. Contact",
      blocks: [
        { p: "**Controller:** DeCave, [CONTROLLER ADDRESS]. **Privacy and security:** security@de-cave.com." },
        { p: "Please don't include passwords or private conversations in an email to us." },
      ],
    },
  ] satisfies PolicySection[],
};
