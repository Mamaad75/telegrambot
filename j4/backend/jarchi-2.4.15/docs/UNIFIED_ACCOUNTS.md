# Unified Telegram/Bale Accounts

Jarchi treats Telegram and Bale as two authenticated identities of one canonical Jarchi user.

## Rules

- One Jarchi user may have at most one Telegram identity and one Bale identity.
- The subscription belongs to `users.id`, not to a platform identity.
- Site memberships, roles, tickets, AI drafts/jobs, quotas and settings therefore remain shared when a second platform is linked.
- Identity linking is explicit. Username/name/phone similarity is never used as proof.
- A link is a short-lived, one-time, platform-bound challenge. Only its SHA-256 hash is stored.
- A target identity already belonging to another Jarchi account can never be moved automatically.
- The last remaining identity cannot be unlinked.
- Active sessions for the unlinked platform are revoked.
- If the linked Jarchi account is also an administrator, the empty admin identity slot is synchronized safely without overwriting another administrator.

## Flow

1. Open **حساب‌های متصل** in the Mini App.
2. Select Telegram or Bale.
3. Backend creates a 10-minute challenge and returns a deep link to the target bot.
4. User opens the bot. The bot receives `/start <challenge>`.
5. Backend validates the challenge and the platform identity, then attaches that identity to the existing Jarchi user inside a database transaction.
6. The target bot immediately offers the same Jarchi Mini App session for the same account.

## Security

Link tokens are random, URL-safe, short-lived and never stored in plaintext. Challenges are locked during completion to prevent replay/race conditions. Platform identities are protected by a unique `(platform, platform_user_id)` constraint, and a unique `(user_id, platform)` constraint ensures one identity per platform per Jarchi account.
