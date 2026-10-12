import assert from "node:assert/strict";
import test from "node:test";
import {
  PRIVATE_NOTICE_LABEL,
  buttonStyle,
  cardButtons,
  cardSelect,
  cardTextParts,
  filterCommands,
  formFromResponse,
  formPayload,
  interactionBody,
  missingRequired,
  messageBotFields,
  safeCardLink,
  botMessageText,
  botRenderMode,
  commandsFromResponse,
  sendsCommandDirectly,
} from "../../shared/bots/card-view.ts";

test("a card with 5 buttons yields 5 buttons; extra or malformed ones are dropped", () => {
  const buttons = [1, 2, 3, 4, 5].map((n) => ({ customId: `b${n}`, label: `B${n}`, style: "primary" }));
  assert.equal(cardButtons({ buttons }).length, 5);
  assert.equal(cardButtons({ buttons: [...buttons, { customId: "b6", label: "B6", style: "x" }] }).length, 5);
  assert.deepEqual(cardButtons({ buttons: [{ customId: 3, label: "bad" }, null] }), []);
  assert.deepEqual(cardButtons(null), []);
});

test("button styles map to known styles, unknown becomes secondary", () => {
  assert.equal(buttonStyle("primary"), "primary");
  assert.equal(buttonStyle("danger"), "danger");
  assert.equal(buttonStyle("success"), "success");
  assert.equal(buttonStyle("weird"), "secondary");
  assert.equal(buttonStyle(undefined), "secondary");
});

test("select keeps only well-formed options", () => {
  const select = cardSelect({ select: { customId: "pick", options: [{ label: "A", value: "a" }, { label: 1 }] } });
  assert.deepEqual(select, { customId: "pick", options: [{ label: "A", value: "a" }] });
  assert.equal(cardSelect({}), null);
});

test("only https links are links", () => {
  assert.equal(safeCardLink("https://example.com/x"), "https://example.com/x");
  assert.equal(safeCardLink("javascript:alert(1)"), null);
  assert.equal(safeCardLink("http://example.com"), null);
  assert.equal(safeCardLink("data:text/html,hi"), null);
  assert.equal(safeCardLink(42), null);
});

test("javascript: in card text is not rendered as a link", () => {
  const parts = cardTextParts("see javascript:alert(1) and https://ok.example/a.");
  assert.equal(parts.filter((p) => p.kind === "link").length, 1);
  assert.deepEqual(
    parts.find((p) => p.kind === "link"),
    { kind: "link", value: "https://ok.example/a" },
  );
  assert.ok(parts.some((p) => p.kind === "text" && p.value.includes("javascript:alert(1)")));
  assert.equal(parts.map((p) => p.value).join(""), "see javascript:alert(1) and https://ok.example/a.");
});

test("a button click posts {messageId, customId}; a select adds value", () => {
  assert.deepEqual(interactionBody("m1", "b1"), { messageId: "m1", customId: "b1" });
  assert.deepEqual(interactionBody("m1", "pick", "a"), { messageId: "m1", customId: "pick", value: "a" });
});

test("a response with a form opens the form", () => {
  const form = formFromResponse({
    ok: true,
    form: { formId: "f1", title: "Apply", fields: [{ id: "why", label: "Why?", style: "long", required: true }] },
  });
  assert.equal(form?.formId, "f1");
  assert.equal(form?.fields.length, 1);
  assert.equal(formFromResponse({ ok: true }), null);
  assert.equal(formFromResponse({ ok: true, form: { formId: 3 } }), null);
});

test("form payload sends declared fields only and reports missing required ones", () => {
  const fields = [
    { id: "name", label: "Name", style: "short", required: true },
    { id: "note", label: "Note", style: "long", required: false },
  ];
  assert.deepEqual(formPayload(fields, { name: "Ana", stray: "x" }), { fields: { name: "Ana", note: "" } });
  assert.deepEqual(missingRequired(fields, { name: "  " }), ["Name"]);
  assert.deepEqual(missingRequired(fields, { name: "Ana" }), []);
});

test("private notice carries the label", () => {
  assert.equal(PRIVATE_NOTICE_LABEL, "Only you can see this");
  const fields = messageBotFields({
    bot: { id: "b", name: "Dice", color: null, avatarEmoji: "🎲" },
    privateNotice: true,
  });
  assert.equal(fields.privateNotice, true);
  assert.equal(fields.bot?.name, "Dice");
  assert.deepEqual(messageBotFields({ text: "hi" }), {});
});

test("slash command autocomplete filters by prefix", () => {
  const commands = [
    { name: "roll", botId: "b", botName: "Dice", options: [] },
    { name: "rank", botId: "b", botName: "Levels", options: [] },
    { name: "help", botId: "c", botName: "Help", options: [] },
  ];
  assert.deepEqual(
    filterCommands(commands, "/r").map((c) => c.name),
    ["rank", "roll"],
  );
  assert.deepEqual(
    filterCommands(commands, "/").map((c) => c.name),
    ["help", "rank", "roll"],
  );
  assert.deepEqual(filterCommands(commands, "/roll 3"), []);
  assert.deepEqual(filterCommands(commands, "roll"), []);
});

test("bot message text is unwrapped from the stored bot payload", () => {
  assert.equal(botMessageText('__DECAVE_BOT__{"botId":"b","name":"Dice","text":"You rolled 4"}'), "You rolled 4");
  assert.equal(botMessageText("__DECAVE_BOT__{bad"), "");
  assert.equal(botMessageText("plain"), "plain");
});

const dice = { id: "b", name: "Dice", color: null, avatarEmoji: null };

test("only bot-wrapped text uses the card renderer", () => {
  assert.equal(botRenderMode({ bot: dice, text: '__DECAVE_BOT__{"botId":"b","name":"Dice","text":"4"}' }), "card");
  const forum = { bot: dice, text: '__DECAVE_FORUM_POST_V1__{"title":"T","body":"B"}' };
  assert.equal(botRenderMode(forum), "default");
  assert.equal(messageBotFields(forum).bot?.name, "Dice");
  const plain = { bot: dice, text: "hello from a token bot" };
  assert.equal(botRenderMode(plain), "default");
  assert.equal(messageBotFields(plain).bot?.name, "Dice");
  assert.equal(botRenderMode({ text: '__DECAVE_BOT__{"text":"x"}' }), "default");
});

test("command options are validated", () => {
  const [command] = commandsFromResponse({
    commands: [
      {
        name: "roll",
        botId: "b",
        botName: "Dice",
        options: [
          { name: "sides", type: "number", required: true },
          { name: 3 },
          { name: "x", type: "evil", required: false },
          null,
        ],
      },
    ],
  });
  assert.deepEqual(command.options, [{ name: "sides", type: "number", required: true }]);
});

test("Enter sends an exact command that needs no options", () => {
  const commands = [
    { name: "roll", botId: "b", botName: "Dice", options: [] },
    { name: "rank", botId: "b", botName: "L", options: [{ name: "user", type: "user", required: true }] },
  ];
  assert.equal(sendsCommandDirectly(commands, "/roll"), true);
  assert.equal(sendsCommandDirectly(commands, "/ROLL"), true);
  assert.equal(sendsCommandDirectly(commands, "/rank"), false);
  assert.equal(sendsCommandDirectly(commands, "/ro"), false);
});
