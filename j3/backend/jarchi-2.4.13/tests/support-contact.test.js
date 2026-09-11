import test from "node:test";
import assert from "node:assert/strict";
import { formatTelegram } from "../src/formatters/telegram.js";
import { formatBale } from "../src/formatters/bale.js";
import { resolveContactButton } from "../src/core/contactButton.js";

/*
 * The contact button had one shape: reveal the advertiser's own number. It was
 * therefore gated on the advert carrying one, and on adverts without a number
 * there was no way to offer contact at all.
 *
 * The support mode is a link to one fixed account. It needs nothing from the
 * advert, which is the whole point — it has to appear on exactly the posts the
 * author button cannot serve.
 */

const adWithoutPhone = {
  contract_version: "1.3",
  title: "آگهی بدون شماره",
  url: "https://example.com/a",
  fields: {},
  field_meta: {},
  phone_published: false,
  contact_phone: "",
  contact_phone_platforms: { telegram: false, bale: false },
};

const supportButton = {
  enabled: true,
  label: "تماس با پشتیبانی",
  mode: "support",
  url: "https://t.me/iranexim_support",
};

test("a support contact button appears on an advert with no phone number", () => {
  const { buttons } = formatTelegram({ ...adWithoutPhone, buttons: { contact: supportButton } });
  const contact = buttons.find((b) => b.text === "تماس با پشتیبانی");

  assert.ok(contact, "the support button should be rendered");
  assert.equal(contact.url, "https://t.me/iranexim_support");
});

test("it is a link, not a reveal-the-number callback", () => {
  const { buttons } = formatTelegram({ ...adWithoutPhone, buttons: { contact: supportButton } });
  const contact = buttons.find((b) => b.text === "تماس با پشتیبانی");

  assert.equal(contact.callback_data, undefined, "a support button needs no callback handler");
});

test("the author button still needs a phone number behind it", () => {
  const { buttons } = formatTelegram({
    ...adWithoutPhone,
    buttons: { contact: { enabled: true, label: "تماس با آگهی‌دهنده", mode: "author" } },
  });

  assert.equal(
    buttons.length,
    0,
    "a button offering to reveal a number that does not exist is a dead end",
  );
});

test("a support mode with no destination renders nothing rather than a dead button", () => {
  const { buttons } = formatTelegram({
    ...adWithoutPhone,
    buttons: { contact: { enabled: true, label: "تماس", mode: "support", url: "" } },
  });

  assert.equal(buttons.length, 0);
});

test("Bale gets the support button, which it could never have for the author mode", () => {
  /*
   * Bale callback queries have no handler in the bot webhook, so the author
   * button was deliberately omitted there. A link needs no handler, so this is
   * the first contact button Bale can actually show.
   */
  const { buttons } = formatBale({
    ...adWithoutPhone,
    buttons: { contact: { ...supportButton, url: "https://ble.ir/iranexim_support" } },
  });

  const contact = buttons.find((b) => b.text === "تماس با پشتیبانی");

  assert.ok(contact, "Bale should render a support link");
  assert.equal(contact.url, "https://ble.ir/iranexim_support");
});

test("Bale still omits the author button, which it cannot answer", () => {
  const { buttons } = formatBale({
    ...adWithoutPhone,
    phone_published: true,
    contact_phone: "09120000000",
    contact_phone_platforms: { bale: true },
    buttons: { contact: { enabled: true, label: "تماس با آگهی‌دهنده", mode: "author" } },
  });

  assert.equal(
    buttons.filter((b) => b.callback_data).length,
    0,
    "a callback button with no webhook handler looks clickable and is not",
  );
});

test("a contact button that is switched off stays off in either mode", () => {
  for (const mode of ["author", "support"]) {
    const { buttons } = formatTelegram({
      ...adWithoutPhone,
      buttons: { contact: { ...supportButton, mode, enabled: false } },
    });

    assert.equal(buttons.length, 0, `mode ${mode} should render nothing when disabled`);
  }
});

test("the view button is unaffected by any of this", () => {
  const { buttons } = formatTelegram({
    ...adWithoutPhone,
    buttons: {
      view: { enabled: true, label: "مشاهده آگهی" },
      contact: supportButton,
    },
  });

  assert.deepEqual(
    buttons.map((b) => b.text),
    ["مشاهده آگهی", "تماس با پشتیبانی"],
  );
});

/*
 * The gate that decides whether a contact button survives into the message.
 * It used to sit inline in resolvePublication, beside the database and three
 * messaging APIs, where the only way to reach it was to run the whole
 * publication path.
 */

test("the support button survives the phone gate that kills the author button", () => {
  const contact = { enabled: true, mode: "support", url: "https://t.me/support" };

  assert.equal(resolveContactButton(contact, "").enabled, true, "no phone must not disable a link");
  assert.equal(
    resolveContactButton({ enabled: true, mode: "author" }, "").enabled,
    false,
    "the author button still needs a number",
  );
});

test("a support button needs a destination, an author button needs a number", () => {
  assert.equal(resolveContactButton({ enabled: true, mode: "support", url: "" }, "09120000000").enabled, false);
  assert.equal(resolveContactButton({ enabled: true, mode: "author" }, "09120000000").enabled, true);
});

test("only the author button asks for a callback token", () => {
  assert.equal(resolveContactButton({ enabled: true, mode: "support", url: "https://t.me/s" }, "").needsCallback, false);
  assert.equal(resolveContactButton({ enabled: true, mode: "author" }, "09120000000").needsCallback, true);
});

test("a button nobody switched on is off whatever else is true", () => {
  assert.equal(resolveContactButton({ enabled: false, mode: "support", url: "https://t.me/s" }, "0912").enabled, false);
  assert.equal(resolveContactButton(undefined, "0912").enabled, false);
});

test("an unknown mode is treated as the advertiser, not as support", () => {
  // Failing the other way would let a malformed payload produce a button
  // pointing at whatever string happened to be in `url`.
  const state = resolveContactButton({ enabled: true, mode: "nonsense", url: "https://evil.test" }, "");

  assert.equal(state.mode, "author");
  assert.equal(state.enabled, false);
});
