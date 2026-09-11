/**
 * Whether a contact button is live, and what kind it is.
 *
 * There are two kinds, and they are gated differently:
 *
 *   author  — reveals the advertiser's own number through a callback query.
 *             Without a number there is nothing to reveal, so the button is a
 *             dead control and is switched off.
 *
 *   support — a link to one fixed account. It needs nothing from the advert.
 *             Applying the phone test to it switched off the very button whose
 *             purpose is to work on the adverts that have no number, which is
 *             why it lived inline in resolvePublication and was wrong there.
 *
 * Kept as a pure rule with no imports so it can be reasoned about and tested
 * on its own, rather than only through a function that also talks to the
 * database and to three messaging APIs.
 *
 * @param {object|undefined} contact  ad.buttons.contact, as the plugin sent it
 * @param {string} phone              resolved contact phone for this platform ("" when none)
 * @returns {{enabled:boolean, mode:string, url:string, needsCallback:boolean}}
 */
export function resolveContactButton(contact, phone) {
  const requested = contact?.enabled === true;
  const mode = contact?.mode === "support" ? "support" : "author";
  const url = typeof contact?.url === "string" ? contact.url : "";

  // A support button with no destination is worse than no button: it looks
  // like a way to reach somebody and is not.
  const usable = mode === "support" ? url !== "" : Boolean(phone);
  const enabled = requested && usable;

  return {
    enabled,
    mode,
    url,
    // Only the reveal-the-number button is answered by us; a link is answered
    // by the messenger.
    needsCallback: enabled && mode !== "support",
  };
}
