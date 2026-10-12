# Bot builder: admin guide

The bot builder lets a Hub admin make bots without writing code. A bot is a list
of rules: **when** something happens, **if** some conditions hold, **do** a few
actions, **otherwise** do others. This guide covers what you can build, the
limits, and how to read the Activity log when a bot does not do what you expect.

You need the **Manage Bots** permission (roles with Manage Rooms have it too).
Open the Hub, then Settings, then **Bots**. Bots that use an API key (token
bots) are listed there as well and are not affected by anything below.

Bots work only in Hub rooms and forums. **Direct messages and group chats are
never touched by bots**; they are end-to-end encrypted.

## Making a bot

**New bot** offers four starting points:

- **From a template:** Welcome, Reaction roles, Polls, Reminders, Dice.
- **Describe it:** an AI helper turns a description into a draft (see below).
- **From scratch:** an empty bot.
- **Import:** a bot file exported from another Hub.

A bot page has four tabs: **Rules**, **Test** (shows each step a rule would take
without sending or changing anything), **Activity** (the run log) and
**Settings** (name, avatar, colour, allowed rooms, what the bot may do, enable,
export, delete).

Edits stay a **draft** until you press **Publish**. Validation runs on save and
again on publish, with the message shown next to the field at fault. Nothing
invalid is ever published.

### Templates

| Template | What it does |
| --- | --- |
| Welcome | Greets every new member in the Hub's first text room. |
| Reaction roles | Gives a role when a member reacts with a check mark, takes it away when they remove it. Pick the role first; until then the rules stay drafts and publishing is refused. |
| Polls | `/poll` starts a poll from a question and two choices. |
| Reminders | `/remind` sends you a private reminder after 10 minutes (change the wait in the rule). |
| Dice | `/roll` rolls a die with the number of sides you give (default 6). |

### Things to know

- **Role actions only work for bots published by the Hub owner.** Giving,
  removing and toggling roles mirrors the owner-only role assignment, so a bot
  published by anyone else fails these actions with a plain reason in the log.
- **A bot made from scratch can only send messages** until you allow more under
  Settings. Bots from a template or an import start with whatever their rules
  need.
- **Forms open from card buttons or dropdowns, not from typed commands.** A
  slash command cannot open a form directly; have it post a card with a button
  that does.
- **Role changes made by a bot do not trigger role rules.** A bot giving a role
  will not set off a "role added" rule (bot messages do not trigger rules
  either, unless a rule opts in, with a chain depth of 3).
- **Card images show as a link** rather than as an embedded picture.
- **A bot that fails 50 runs in a row is paused automatically** and shows
  "Paused after repeated errors". Fix the cause (usually visible in Activity),
  then turn the bot back on in Settings.
- Bots never expand `@everyone` or `@here`.

## Rules

### Triggers (When)

| Trigger | Notes |
| --- | --- |
| Slash command `/name` | Options typed as text, number, user, role, channel or choice; each required or optional. Names are 1-32 lowercase letters, digits or dashes, are unique in the Hub, and cannot shadow a built-in command. |
| Message posted | Contains, starts with, exact, or regex; optional case sensitivity. |
| Member joins / leaves | |
| Role added / removed | |
| Reaction added / removed | A specific emoji, optionally on one message. |
| Button or select used | On a bot card. |
| Form submitted | |
| Joins / leaves voice | Any voice room or a chosen one. |
| On a schedule | Every N minutes (at least 5), daily, weekly or cron, with a time zone. |
| Hub event starts | |

Regex patterns are limited to 200 characters and must fit a small, safe
subset, because a slow pattern would stall message handling for every Hub.
Anything outside this subset is refused on save:

- Plain characters, escaped symbols (`\.`, `\(`), `.`, `\d \w \s \D \W \S`,
  character classes like `[a-z0-9]`, and the anchors `^ $ \b \B`.
- A repeat (`?`, `*`, `+`, `{n}`, `{n,m}`, `{n,}`) goes on a single character,
  class or `.`, never on a group, and `{n,m}` goes up to 10.
- At most one open-ended repeat (`*`, `+` or `{n,}`) in the whole pattern.
- Bounded repeats (`?`, `{n,m}`) add at most 20 optional characters in total.
- Groups `( )` and `(?: )` are for choices like `(world|there)`; each choice is
  plain text with no repeats. Groups can't be nested or repeated.
- No backreferences, lookaheads/lookbehinds, named groups or inline flags.

Bot regex patterns are not run by the JavaScript regex engine: they run on a
small matcher whose time grows only with message length times pattern size,
so no pattern can stall the server. Regex triggers only look at the first 500 characters of a message (other
match modes look at 2000). `^!roll \d+$`, `^hello (world|there)$`,
`\bdeal\b.*done`, `colou?r` and `^[a-z]{2,5}$` are fine; `.*.*x`, `a+a+b`,
`\w+\s+\w+`, `(ab)+` and `(a?a?)+b` are not. The same check runs again before
matching: a stored pattern that fails it never runs and logs a `skipped` run
"Pattern not allowed".

### Conditions (If)

Has / lacks a role, room is / is not, account age, member for (days), a stored
variable compared (`=`, `!=`, `>`, `<`, contains), random chance (percent), time
of day, weekday. Combine them with all / any. Each rule may have an Otherwise
branch.

### Actions (Do)

- **Messages:** send a message or card (title, text, colour, image, fields, up
  to 5 buttons or one dropdown), reply, edit a bot message, pin / unpin, delete
  the triggering message, react, create a forum thread, private notice (visible
  only to that member, in that room).
- **Roles:** give, remove or toggle a role, optionally for a set time.
- **Interactive:** open a form (up to 5 fields), start a poll, create a Hub
  event.
- **Data:** set, add to or reset a variable (per member or per Hub).
- **Flow:** wait (up to 7 days), stop, run another rule.
- **External:** call a webhook. HTTPS only, 5 second timeout, redirects are not
  followed, the response is read up to 64 KB, and private, loopback,
  link-local, shared-address and Cloudflare-internal hosts are refused.

## Variables in text

Write a name in braces inside any text the bot sends.

| Text | Becomes |
| --- | --- |
| `{user}` | The member's display name (their username if they have none). |
| `{user.mention}` | The chat `@username` mention. |
| `{user.id}` | The member's public DeCave id. |
| `{channel}`, `{hub}`, `{role}` | The room, Hub and (for role rules) role name. |
| `{args.<option>}` | A slash command option, for example `{args.sides}`. |
| `{text}` | The message text, for message rules. |
| `{match.0}`, `{match.1}` ... | The matched text and regex groups. |
| `{emoji}` | The emoji, for reaction rules. |
| `{value}` | The chosen value, for dropdown rules. |
| `{field.<id>}` | A submitted form field. |
| `{webhook.<key>}`, `{webhook.status}` | Fields of a webhook reply. |
| `{random:a\|b\|c}`, `{random 1-100}` | A random choice or number. |
| `{date}` | Today's date. |

Add a filter after a pipe: `{args.sides|default:6}`, `{user|upper}`,
`{user|lower}`. Braces can nest: `{random 1-{args.sides|default:6}}`. Rendered
text is limited to 2000 characters and goes through the same cleaning as member
messages.

## Limits

| Limit | Value |
| --- | --- |
| Bots per Hub | 25 |
| Rules per bot | 50 |
| Actions per rule | 20 |
| Slash commands per Hub | 100 |
| Variable names per Hub | 200 |
| Rule runs per Hub per minute | 120 |
| Bot messages per Hub per minute | 30 |
| Webhook calls per Hub per minute | 10 |
| Shortest schedule | every 5 minutes |
| Longest wait | 7 days (10080 minutes) |
| Bot chain depth | 3 |
| Regex pattern length | 200 characters |
| Form fields | 5 |
| Card buttons | 5 |
| Text length after variables | 2000 characters |
| Run log kept | 30 days |
| Failed runs in a row before auto-pause | 50 |
| AI generations per Hub per day (UTC) | 5 |

Runs over a per-minute limit are dropped and logged with the status `limited`.

## Describe it (AI)

If the Hub's deployment has an AI key configured, **Describe it** appears for
members with Manage Bots. You type what you want; the Worker asks Claude
(Anthropic) for a draft.

**What is sent to Anthropic:** only your description, the list of what rules can
be built from, and the names and ids of the Hub's rooms and roles. No messages,
members or usernames. The same is stated in the
[data-routing disclosure](../legal/PRIVACY-AND-DATA-ROUTING.md).

- The answer is checked with the same rules as a manual save and opens as an
  **unpublished draft** with a "Generated, review before publishing" banner. AI
  output is never published for you.
- If part of the request is not possible, the reply says which part.
- Limit: **5 per Hub per day**. A generation counts only when the provider was
  actually called.
- Without the key the option is hidden.

## Troubleshooting with Activity

Activity lists each rule run with a status: `ok`, `error` (the reason is shown),
`limited` (a per-minute limit was hit) or `skipped`. Filter to errors to find
problems quickly. The **Test** tab shows the same steps without side effects.

| Message | What to do |
| --- | --- |
| Publisher can't manage this role | Role actions work only for bots published by the Hub owner, and the role must exist. Have the owner publish the bot. |
| Publisher can't post in this Hub / Publisher can't access this channel | The member who last published no longer has access; publish again from an account that does. |
| Publisher is no longer in this hub | Same: publish again. |
| Bot isn't allowed in this channel | Add the room under allowed rooms in Settings. |
| Channel no longer exists / Role no longer exists | A room or role was deleted. Pick another in the rule. |
| Bots can only post in text channels and forums | The target is a voice room or something else. |
| Bots can only act in hub channels | The target was a DM or group chat (always refused), or a private squad room. |
| Message limit reached / Webhook limit reached | The per-minute limit for the Hub was hit. Make the rule post less. |
| Variable limit reached | The Hub has 200 variable names. Reuse names or reset unused ones. |
| Waiting needs a text channel in this hub | Timed roles and waits need a text room to run in. |
| Bot chain too deep | Bots triggering bots went past depth 3. |
| That rule isn't published or is paused | A "run another rule" action points at a draft or paused rule. |
| Forms need a command or button | A form was started from a trigger that cannot open one. Use a card button or dropdown. |
| Polls need a question and two options | A variable in the poll came out empty. |
| Paused after repeated errors (on the bot) | 50 runs failed in a row. Read Activity, fix the rule, publish, then turn the bot back on. |

If nothing appears in Activity at all, check that the bot is enabled, the rule
is published and not paused, the trigger matches (command name, emoji, room
scope), and that the feature is switched on for your deployment.

## Export and import

Export saves the bot and its rules as a JSON file. Room and role ids are
replaced by names, and matched by name on import; anything that does not match
is left empty for you to pick, and those rules stay drafts until you do.

## Mobile

The mobile app can list bots, enable or disable them, show Activity and create a
bot from a template. The full rule editor is on web and desktop.

## Deploying

Apply the D1 migrations `0076_bot_builder.sql` and `0077_bot_pending_forms.sql`
(`npm run cf:migrate:remote`) **before** deploying the Worker that contains the
bot builder. Token bots write the new message columns (`bot_id`, `card_json`,
`visible_to_user_id`) even while the builder is switched off, so a Worker
deployed ahead of the migrations would fail their posts.

`BOTS_BUILDER_ENABLED` in `wrangler.jsonc` is `"true"`. Set it to `"false"` to
switch the builder off: then the builder routes answer 404, the dispatcher does nothing and the
"Manage bots" role toggle and slash-command suggestions stay hidden.
