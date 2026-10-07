// Legal pages. The privacy policy is rendered from privacy-policy.ts (which also
// generates docs/legal/PRIVACY-POLICY.md); the terms mirror
// docs/legal/TERMS-OF-SERVICE.md, keep them in sync when either changes.

import { ShieldAlert } from "lucide-react";
import { PageLayout } from "./layout";
import { PRIVACY_POLICY, type PolicyBlock } from "./privacy-policy";

// Inline formatting for policy text: **bold**, email addresses and https links.
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|[\w.+-]+@[\w-]+\.[\w.]+|https:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
        if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(part))
          return (
            <a key={index} href={`mailto:${part}`}>
              {part}
            </a>
          );
        if (part.startsWith("https://"))
          return (
            <a key={index} href={part}>
              {part}
            </a>
          );
        return part;
      })}
    </>
  );
}

function PolicyBlockView({ block }: { block: PolicyBlock }) {
  if ("p" in block)
    return (
      <p>
        <Inline text={block.p} />
      </p>
    );
  if ("list" in block)
    return (
      <ul>
        {block.list.map((item) => (
          <li key={item}>
            <Inline text={item} />
          </li>
        ))}
      </ul>
    );
  return (
    <div className="data-table" role="table" aria-label={block.table.head.join(" and ")}>
      <div role="row" className="data-table-head">
        <strong role="columnheader">{block.table.head[0]}</strong>
        <span role="columnheader">{block.table.head[1]}</span>
      </div>
      {block.table.rows.map(([label, value]) => (
        <div role="row" key={label}>
          <strong role="cell">{label}</strong>
          <span role="cell">{value}</span>
        </div>
      ))}
    </div>
  );
}

export function PrivacyPage() {
  const policy = PRIVACY_POLICY;
  return (
    <PageLayout
      eyebrow="Privacy policy"
      title={
        <>
          Your data, <span>kept to a minimum.</span>
        </>
      }
      lead="What DeCave collects, why, who receives it, how long we keep it and your rights."
      updated={`Effective ${policy.effective}`}
    >
      <div className="disclosure-banner">
        <ShieldAlert size={19} />
        <span>{policy.draftNote}</span>
      </div>
      <div className="info-columns">
        <aside className="info-aside">
          <span>On this page</span>
          {policy.sections.map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.nav}
            </a>
          ))}
        </aside>
        <article className="policy-article">
          <section>
            {policy.intro.map((paragraph) => (
              <p key={paragraph}>
                <Inline text={paragraph} />
              </p>
            ))}
          </section>
          {policy.sections.map((section) => (
            <section id={section.id} key={section.id}>
              <h2>{section.title}</h2>
              {section.blocks.map((block, index) => (
                <PolicyBlockView block={block} key={index} />
              ))}
            </section>
          ))}
        </article>
      </div>
    </PageLayout>
  );
}

export function TermsPage() {
  return (
    <PageLayout
      eyebrow="Terms of service"
      title={<>Use the cave.<br /><span>Keep it playable.</span></>}
      lead="The rules for accounts, content, communities, safety, release boundaries, and the current alpha service."
      updated="Effective 6 Oct 2026"
    >
      <div className="disclosure-banner">
        <ShieldAlert size={19} />
        <span><strong>Implementation draft:</strong> replace the address, governing law, liability cap, arbitration, copyright-agent, and market-specific terms with counsel-approved details before publication.</span>
      </div>
      <div className="info-columns">
        <aside className="info-aside">
          <span>On this page</span>
          <a href="#terms-agreement">Agreement</a>
          <a href="#terms-use">Acceptable use</a>
          <a href="#terms-content">Content &amp; communities</a>
          <a href="#terms-encryption">Encryption</a>
          <a href="#terms-safety">Safety &amp; enforcement</a>
          <a href="#terms-ip">Intellectual property</a>
          <a href="#terms-ending">Ending access</a>
          <a href="#terms-contact">Contact</a>
        </aside>
        <article className="policy-article">
          <section id="terms-agreement">
            <h2>1. Agreement, eligibility, and accounts</h2>
            <p>These Terms are an agreement between you and <strong>DeCave</strong> governing your use of DeCave. By creating an account, accessing, or using the Service, you agree to these Terms and the <a href="/privacy">Privacy Policy</a>. If you do not agree, do not use the Service.</p>
            <p>DeCave is for adults only. You must be at least 18, or older where local law sets a higher age of majority. Keep your account information accurate, protect your password and recovery materials, and do not use another person’s account without permission. We may require email verification, human verification, device approval, or a password reset to protect the Service.</p>
          </section>

          <section id="terms-release">
            <h2>2. The current release</h2>
            <p>DeCave provides Hubs, rooms, friends, messages, voice, video, screen sharing, discovery, safety tools, and related features. The current product is alpha or pre-release: access, downloads, messaging, and calls may be paused or restricted while security review, retention procedures, or other release gates are completed. Features may change, be limited by platform, or be removed.</p>
          </section>

          <section id="terms-use">
            <h2>3. Acceptable use</h2>
            <p>You must use DeCave lawfully and follow the Community Guidelines and Hub-specific rules. You must not:</p>
            <div className="data-table">
              <div><strong>Abuse or exploitation</strong><span>Harass, threaten, stalk, bully, groom, exploit, doxx, or target another person; publish hate speech, sexual exploitation, child sexual abuse material, credible threats, or non-consensual intimate media.</span></div>
              <div><strong>Fraud or impersonation</strong><span>Impersonate, scam, phish, harvest credentials, misrepresent affiliation, or distribute spam, malware, ransomware, or malicious links.</span></div>
              <div><strong>Security interference</strong><span>Probe, scrape, overload, reverse engineer, bypass, or interfere with accounts, rate limits, safety controls, security boundaries, or infrastructure, except where law and written authorization allow it.</span></div>
              <div><strong>Rights and privacy</strong><span>Infringe intellectual-property, privacy, publicity, confidentiality, or other rights, or expose another person’s personal information without a lawful reason and permission.</span></div>
              <div><strong>Unsafe use</strong><span>Use the Service for emergency communications, life-critical control, professional advice, or a situation where delay or failure could cause serious harm.</span></div>
            </div>
            <p>You are responsible for the content you submit and for the consequences of sharing it. Do not upload passwords, private keys, government IDs, payment data, or unnecessary sensitive information.</p>
          </section>

          <section id="terms-content">
            <h2>4. User content and communities</h2>
            <p>You retain ownership of content you create. You grant DeCave a limited, non-exclusive, worldwide, royalty-free license to host, store, reproduce, format, transmit, display, and technically process that content only as needed to operate, secure, moderate, support, and improve the Service and provide the feature you selected. The license ends when content is deleted, except for permitted or required copies in backups, legal holds, or moderation records. Messages and other account content are removed from active systems when erasure completes; recipients may retain copies they already received.</p>
            <p>Public profiles, public Hubs, invitations, messages, calls, and screen sharing are visible to the recipients you choose. Community owners and moderators may set local rules, remove content, manage roles, and restrict members. You must have the right to submit content about other people.</p>
          </section>

          <section id="terms-encryption">
            <h2>5. Messages, calls, and encryption</h2>
            <p>TLS protects network traffic to the Service. Direct messages and group chats are end-to-end encrypted and DeCave cannot read them; keeping your recovery code is your responsibility. Voice, video and screen sharing in calls and voice rooms are end-to-end encrypted between participants' devices; relays and DeCave's servers only forward encrypted media. DeCave stores and processes other message content and attachments in readable form to deliver and moderate them. DeCave also processes account, participant, group, routing, timing, size, delivery, IP/network, and signalling metadata. Recipients and capture tools can copy or record what they receive.</p>
          </section>

          <section id="terms-safety">
            <h2>6. Safety, reports, and enforcement</h2>
            <p>Use blocking, muting, reporting, and leaving controls where available. Reports should be truthful and limited to relevant context. We may investigate, preserve evidence, remove content, revoke devices, require a password reset, suspend or terminate accounts, limit a Hub, or contact authorities when reasonably necessary for safety, security, legal compliance, or the Service.</p>
            <p>We may act without advance notice where needed to prevent harm or preserve evidence. We do not promise to find every violation or produce a particular report outcome. If an appeal process is offered, follow the instructions included with the decision.</p>
          </section>

          <section id="terms-third-party">
            <h2>7. Optional integrations</h2>
            <p>Steam, GIPHY, Cloudflare, app stores, operating systems, game platforms, and other services may provide links, embeds, discovery, identity, transport, or distribution features. Their own terms and privacy notices apply. DeCave does not control their availability, accuracy, security, or moderation. You authorize an optional integration only when you choose to connect or use it.</p>
          </section>

          <section id="terms-ip">
            <h2>8. DeCave intellectual property</h2>
            <p>The Service, software, visual design, logos, names, documentation, and other DeCave materials belong to DeCave or its licensors. Subject to these Terms, we grant you a limited, revocable, non-exclusive, non-transferable license for personal or authorized community use. Do not copy, sell, sublicense, modify, distribute, or create derivative works from DeCave materials except as allowed by law or in writing.</p>
            <p>Rights complaints can be sent to <a href="mailto:security@de-cave.com">security@de-cave.com</a>. A jurisdiction-specific copyright-agent process will be added before relying on one.</p>
          </section>

          <section id="terms-ending">
            <h2>9. Privacy, fees, and ending access</h2>
            <p>The <a href="/privacy">Privacy Policy</a> explains data collection, security, retention, deletion, and rights. The current core Service has no stated subscription fee. Paid features, if introduced, will show pricing and additional terms before a charge.</p>
            <p>You may stop using DeCave and request account deletion. We may suspend or terminate access for violations, safety or security risk, legal requirements, extended inactivity, or operational reasons. Account erasure removes channel messages authored by the account and direct-message rows involving it, and deletes tracked account-owned attachments and Hub assets. Other users may have saved copies. Report evidence under legal hold may remain; non-held report evidence is deleted. Backups and provider logs follow their actual expiry periods.</p>
          </section>

          <section id="terms-disclaimers">
            <h2>10. Disclaimers and liability</h2>
            <p>To the maximum extent permitted by law, the Service is provided “as is” and “as available.” DeCave does not promise uninterrupted availability, error-free operation, delivery, recoverability, privacy, preservation, or that moderation will identify every harmful act. We disclaim warranties that cannot lawfully be excluded only to the extent allowed by law.</p>
            <p>To the maximum extent permitted by law, DeCave and its owners, staff, contractors, providers, and licensors will not be liable for indirect, special, consequential, exemplary, or punitive damages, or lost profits, data, goodwill, or revenue. Total liability will not exceed the greater of what you paid us for the Service in the prior 12 months or <strong>[INSERT CAP AMOUNT]</strong>. Non-waivable consumer rights and liability that cannot legally be limited are not affected.</p>
          </section>

          <section id="terms-disputes">
            <h2>11. Disputes and governing law</h2>
            <p><strong>Governing law and courts:</strong> [GOVERNING LAW AND COURTS]. The final informal-resolution, arbitration, class-action, and market-specific consumer terms must be completed after legal review. Contact <a href="mailto:security@de-cave.com">security@de-cave.com</a> first with a clear description of a dispute; this does not remove a non-waivable right to contact a regulator or seek urgent relief.</p>
          </section>

          <section id="terms-contact">
            <h2>12. Changes and contact</h2>
            <p>We may update these Terms when the Service or law changes. We will update the effective date and provide additional notice or consent where required. If you continue using the Service after the effective date, the updated Terms apply to future use. If you do not agree, stop using the Service and request deletion.</p>
            <p><strong>General support:</strong> <a href="mailto:support@de-cave.com">support@de-cave.com</a><br /><strong>Legal, privacy, and security:</strong> <a href="mailto:security@de-cave.com">security@de-cave.com</a><br /><strong>Legal entity:</strong> DeCave<br /><strong>Address:</strong> [CONTROLLER/CONTRACTING ADDRESS]</p>
          </section>

          <p className="article-footnote">These Terms are an implementation draft, not legal advice. Complete the bracketed fields and obtain jurisdiction-specific review before treating them as a final contract.</p>
        </article>
      </div>
    </PageLayout>
  );
}
