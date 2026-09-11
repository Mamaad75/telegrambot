# Jarchi Bot API (v1.9.2)

All protected endpoints use the existing Jarchi authentication contract:

- `X-API-Key: <api_secret>` OR
- `X-Timestamp` + `X-Signature` HMAC using the configured `api_secret`.

Base namespace:
`/wp-json/wp-event-publisher/v1`

## Capabilities
`GET /bot/capabilities`

Returns which bot features are enabled and which ticket-reply platforms are allowed.

## Tickets
`GET /bot/tickets?status=waiting&limit=20`

Returns recent tickets and their status, department, category, URL.

`GET /bot/ticket/{ticket_id}`

Returns one ticket and its message thread.

`POST /bot/ticket/reply`

```json
{
  "ticket_id": 123,
  "message": "پاسخ پشتیبانی",
  "source": "telegram",
  "agent_name": "پشتیبانی جارچی"
}
```

`source` must be `telegram` or `bale` and the corresponding platform must be enabled in **ارتباط با کاربران → تنظیمات تیکت**.

`POST /bot/ticket/status`

```json
{
  "ticket_id": 123,
  "status": "reviewing",
  "source": "telegram"
}
```

Valid statuses: `waiting`, `reviewing`, `answered`, `closed`.

## Announcements
`POST /bot/announcement`

```json
{
  "title": "اطلاعیه جدید",
  "content": "متن اطلاعیه",
  "placement": "popup",
  "homepage": true
}
```

## WooCommerce Products
`POST /bot/product`

```json
{
  "name": "محصول جدید",
  "description": "توضیحات",
  "sku": "ABC-123",
  "price": "1250000",
  "status": "draft"
}
```

The Backend can use the same signed/API-key connection for Telegram and Bale bots. The plugin exposes the capabilities; the Jarchi service/plan layer should enforce whether the customer's subscription includes the bot features.
