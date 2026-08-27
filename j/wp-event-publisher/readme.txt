=== جارچی ===
Contributors: bymer
Author: ممد از تیم بایمر
Tags: webhook, events, publish, integration, rest-api
Requires at least: 6.5
Tested up to: 6.8
Requires PHP: 8.1
Stable tag: 1.19.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

انتشار خودکار محتوای وردپرس در تلگرام، بله و واتس‌اپ از طریق سرویس جارچی — با نگاشت فیلدها، اطلاعیه‌ها و تاریخچه انتقال.

== Description ==

Jarchi connects your WordPress site to the Jarchi publishing service. Whenever content is published, modified or permanently deleted, the plugin:

1. Detects the lifecycle event and classifies it as `created`, `updated` or `deleted`.
2. Issues a stable, globally unique `event_id` and persists it.
3. Enqueues an asynchronous job with WP-Cron so publishing is never blocked.
4. Normalizes the post and maps it onto a versioned JSON contract.
5. Signs the exact request body with HMAC-SHA256 and POSTs it to your Node API URL.
6. Logs every request, response and exception into a custom database table.

The plugin never communicates with Telegram (or any other messaging platform) directly — that logic lives entirely inside the Node.js service.

= Webhook contract =

Every request carries the advertisement twice, so both a simple consumer and a structured one are served by the same request:

`{ "event_id", "event_type", "timestamp", "post_id", "title", "description", "price", "location", "url", "images", "site", "post", "author", "listing", "media", "taxonomy" }`

The flat keys (`post_id`, `title`, `description`, `price`, `location`, `url`, `images`) are what the Node.js Telegram Publisher reads. The blocks (`site`, `post`, `author`, `listing`, `media`, `taxonomy`) are the 1.1.0 envelope, unchanged.

`event_type` is one of `created`, `updated` or `deleted`. Two diagnostic types, `test` and `sample`, are emitted only by the Tools screen and can be acknowledged and discarded.

Headers sent with every request:

* `Content-Type: application/json; charset=utf-8`
* `X-Site-ID` — the configured Site ID
* `X-Event-ID` — the idempotency key
* `X-Timestamp` — UTC ISO 8601, e.g. `2026-07-25T10:30:00Z`
* `X-Signature` — hex HMAC-SHA256 digest over `timestamp + "." + raw_body`
* `X-Hub-Signature-256` — `sha256=` digest over the raw body alone
* `X-API-Key` / `X-Webhook-Secret` — the shared secret
* `Authorization: Bearer <secret>`
* `X-Idempotency-Key` — same value as `X-Event-ID`
* `X-Event-Type`, `X-Attempt`, `X-Plugin-Version`, `X-Site` — informational

Which credential headers are sent is controlled by the Authentication Style setting; the default sends all of them so the backend can verify whichever scheme it already implements.

= Signature =

`signature = HMAC_SHA256( timestamp + "." + raw_request_body, api_secret )`

The body is JSON-encoded once, signed, and transmitted unchanged, so the consumer must verify against the **raw** request body — not a re-serialized object. Node.js:

`const expected = crypto.createHmac('sha256', secret).update(req.header('X-Timestamp') + '.' + rawBody).digest('hex');`
`crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.header('X-Signature')));`

Reject requests whose `X-Timestamp` is older than the Webhook Signature Tolerance (default 300 seconds) to prevent replay, and deduplicate on `event_id`.

= Event lifecycle =

* **created** — sent once, the first time a post enters a configured publish status. A post that is unpublished and republished produces `updated`, never a second `created`.
* **updated** — sent when an already published post is modified and stays published. A content fingerprint covering title, content, excerpt, slug, status, thumbnail, terms and public meta suppresses saves that change nothing.
* **deleted** — sent when a previously published post is permanently deleted. The payload is snapshotted before deletion. Drafts that never went live are ignored.

= Idempotency =

Each event receives an identifier such as `evt_9f1c0f2a…` at detection time. It is persisted in post meta, travels in the payload, the `X-Event-ID` header and the logs, and **every retry reuses it unchanged** — only the timestamp and signature are refreshed. A genuinely new event always receives a new identifier.

= Retry scope =

Retries here are a short-lived delivery buffer with exponential backoff, not a durable queue. Queueing, orchestration and job processing are intended to live in the Node.js worker tier (BullMQ on Redis); WordPress is deliberately not the system of record for delivery state.

= Features =

* Top-level admin menu with Dashboard, Settings, Logs, Tools and About screens.
* Settings stored via the Options API with full sanitization and validation.
* Custom log table with search and filtering by event ID, event type, site ID, post ID and status, plus pagination, delete, clear and CSV export.
* Asynchronous delivery with configurable timeout, retry count and signature tolerance.
* Internal REST API (`wp-event-publisher/v1`): `/health`, `/test`, `/logs`, `/status`.
* Timing-safe API key and HMAC signature authentication for machine access.
* Dozens of actions and filters for extension without core edits.

= Extensibility =

Key hooks (see the About screen for the full list):

* `wpep_event_payload` — filter the complete envelope before encoding and signing.
* `wpep_contract_listing` / `wpep_contract_taxonomy` / `wpep_contract_site` — extend individual blocks.
* `wpep_detect_event_type` — reclassify or suppress a detected event.
* `wpep_fingerprint_source` — control which changes count as a modification.
* `wpep_update_cooldown` — tune the post-publish window that suppresses update events.
* `wpep_generate_event_id` — replace the identifier strategy.
* `wpep_site_id` — override the site identifier at runtime.
* `wpep_payload` — filter the flat normalized post data.
* `wpep_webhook_headers` / `wpep_webhook_request_args` — filter the HTTP request.
* `wpep_should_dispatch` — veto dispatching per post.
* `wpep_custom_fields` — control which meta fields are sent.
* `wpep_retry_delay` — customize retry backoff.
* `wpep_webhook_sent` / `wpep_webhook_failed` / `wpep_job_failed` — react to results.

== Installation ==

1. Upload the `wp-event-publisher` folder to `/wp-content/plugins/`.
2. Activate the plugin through the Plugins screen.
3. Go to **جارچی → تنظیمات**. Enter the Webhook URL Jarchi gave you, along with the shared secret your Node.js service expects and a Site ID such as `site_001`.
4. Tick the post type your advertisements use under **Allowed Post Types** (the list shows every custom post type with its published count), keep Enable Plugin and Enable Webhooks on, and save.
5. Use **Tools → Connection Test** to verify connectivity, then publish a real advertisement and watch **Logs**.

= Upgrading from 1.0.0 =

The upgrade is automatic and requires no manual step:

* The log table gains `event_id`, `event_type` and `site_id` columns via `dbDelta()`. Existing rows are preserved and show empty values for the new columns.
* `site_id` is populated with a value derived from your site address (for example `site_3f9a1c22`). Change it on the Settings screen if your Node.js service expects a specific tenant identifier.
* `signature_tolerance` defaults to 300 seconds.
* Posts published before the upgrade are recognised as already published, so upgrading never replays them as `created`.
* Jobs already queued on the 1.0.0 cron hook still run and are delivered using the new contract.

Requests are signed from the moment you upgrade, so deploy the signature verification in your Node.js service before or alongside the plugin update. Until then the endpoint can ignore `X-Signature` — the previously used `X-API-Key` header is still sent.

== Frequently Asked Questions ==

= Does this plugin send messages to Telegram? =

No. It only sends JSON webhooks to your own Node.js service; that service owns all Telegram logic.

= Why did my webhook not fire? =

Open **جارچی → تاریخچه انتقال**. Since 1.2.0 every step of the pipeline is recorded with its outcome, including the reason an event was *not* created — most often the advertisement's post type is not ticked under Settings → «کدام محتوا در جارچی منتشر شود؟», or Enable Plugin is off. Turn on Debug Mode to also see the hooks that fired and the scheduling decisions. Delivery no longer depends on WP-Cron: in Automatic mode the event is delivered at the end of the publish request, and a sweeper re-runs anything left waiting.

= Is the API secret exposed anywhere? =

The secret is stored in the options table and used to compute the request signature. It is transmitted only as the `X-API-Key` header over HTTPS, is never included in a webhook payload, never written to the log table, and never rendered into admin HTML — the Settings field renders empty and leaving it blank keeps the stored value.

= Why did I get an `updated` event I did not expect? =

Any change to the title, content, excerpt, slug, status, featured image, terms or public custom fields counts as a modification. Use the `wpep_fingerprint_source` filter to narrow what is considered a change.

= Why did publishing not produce a second `created` event after I republished? =

By design. `created` fires only the first time a post goes live; every later publish of the same post is an `updated` event, so the consumer never sees the same listing created twice.

= My Node.js service reports an invalid signature. =

Verify against the raw request body bytes, before any JSON parsing or re-serialization, and use the `X-Timestamp` header value — not your own clock — as the timestamp half of the signing string.

== Changelog ==

= 1.18.5 =
* رفع علت واقعی «خطای مهم». در قالب ساید‌بار، تابع رسم آیکن‌ها ($wpep_icon) داخل تابع رسم منو (‎$wpep_render_nav‎) در دسترس نبود، چون در فهرست use آن closure نیامده بود. PHP آن را null می‌دید و فراخوانی‌اش خطای مرگبار می‌داد. این خطا روی اولین آیتم منو رخ می‌داد، یعنی روی هر صفحهٔ جارچی. به همین دلیل نوار بالای جارچی نمایش داده می‌شد و بعد صفحه می‌مرد — دقیقاً همان چیزی که در تصویر دیده می‌شد.
* این ایراد از نسخه‌های پیش‌تر وجود داشت و در آزمون‌های قبلی دیده نشده بود، چون فقط تابع رندر صفحه اجرا می‌شد و قلاب in_admin_header — جایی که ساید‌بار ساخته می‌شود — اجرا نمی‌شد.
* آزمون‌ها اکنون چرخهٔ کامل یک درخواست پیشخوان را اجرا می‌کنند: admin_enqueue_scripts، admin_body_class، in_admin_header، رندر صفحه و admin_footer — برای همهٔ صفحه‌ها و همهٔ نماها (۶۶ درخواست).
* بررسی تازه‌ای اضافه شد که هر closure در قالب ساید‌بار باید هر closure دیگری را که صدا می‌زند در use خود داشته باشد.

= 1.18.4 =
* رفع «خطای مهم» صفحهٔ جارچی. علت، یک حلقهٔ بی‌نهایت بود: render_dashboard() مقدار jarchi_view را می‌خواند و به مسیریاب می‌داد؛ اگر آن نما در جدول مسیرها نبود، مسیریاب دوباره render_dashboard() را صدا می‌زد و همان مقدار را دوباره می‌خواند. حافظه تمام می‌شد و وردپرس «خطای مهم» نشان می‌داد. هر نشانی با jarchi_view ناشناخته سایت را از کار می‌انداخت.
* نمای ناشناخته اکنون صفحهٔ خانه را نشان می‌دهد. رندر صفحهٔ خانه از مسیریاب جدا شد تا دیگر نتواند به خودش برگردد.
* منوی دوم «ارتباط با کاربران» که اصلاً ساخته نمی‌شد اضافه شد. پیش‌تر مستقیم به آرایهٔ $submenu اضافه می‌شد، اما آن آرایه هرگز ساخته نشده بود، پس شرط isset همیشه نادرست بود و ورودی بی‌صدا حذف می‌شد.
* اکنون دقیقاً دو منوی نیتیو وجود دارد — «جارچی» و «ارتباط با کاربران» — و هر دو صفحهٔ واقعی ثبت‌شده هستند. بقیهٔ صفحه‌ها در ساید‌بار خود افزونه‌اند.
* نشانی‌های قدیمی (بوکمارک‌ها) به‌جای خطای «اجازه دسترسی ندارید» به صفحهٔ درست هدایت می‌شوند.
* سطح دسترسی تغییر نکرده است (manage_options).

= 1.17.7 =
* رفع ریشه‌ای خطای «شما اجازه دسترسی به این برگه را ندارید». علت این بود که افزونه پس از ثبت صفحه‌ها، ورودی‌های خودش را از $submenu حذف می‌کرد تا منوی وردپرس کوتاه بماند؛ اما وردپرس والدِ هر صفحهٔ افزونه را با جست‌وجو در همین $submenu پیدا می‌کند و نام قلاب را از روی آن می‌سازد. با حذف ورودی‌ها، نام قلاب دیگر با نام ثبت‌شده یکی نبود و وردپرس دسترسی را رد می‌کرد. از ۳۰ صفحه، ۲۸ صفحه غیرقابل‌دسترس بود.
* صفحه‌های پنهان اکنون با والد خالی ثبت می‌شوند — روش خودِ وردپرس برای صفحهٔ ثبت‌شده اما نمایش‌داده‌نشده — و دیگر چیزی از منو حذف نمی‌شود. منوی وردپرس همچنان فقط دو ورودی دارد.
* یک نقطهٔ ثبت واحد (Admin::register_screen) جایگزین ثبت‌های پراکنده شد. سه صفحهٔ تیکت که دو بار ثبت می‌شدند اصلاح شدند.
* رفع خطای مرگبار در پیام‌های اطلاع‌رسانی: قالب پیام با گیومهٔ دوتایی نوشته شده بود و PHP متغیر $s را در «%1$s» جای‌گذاری می‌کرد، بنابراین sprintf با خطا متوقف می‌شد — پس از آنکه تیکت ذخیره شده بود.
* شکست هر سرویس اختیاری (ایمیل، پیامک، اعلان، وب‌هوک) دیگر نمی‌تواند ساخت تیکت را خراب کند؛ خطا ثبت می‌شود و کار ادامه پیدا می‌کند.
* اگر صفحه‌ای به هر دلیل بارگذاری نشود، به‌جای صفحهٔ سفید «خطای مهم»، پیام خطا همراه با فایل و شمارهٔ خط نمایش داده می‌شود.
* تشخیص صفحهٔ جارچی از فهرست واقعی صفحه‌های ثبت‌شده خوانده می‌شود، نه از فهرست دستیِ اسلاگ‌ها.
* سطح دسترسی مورد نیاز تغییری نکرده است (manage_options).

= 1.7.3 =
* رفع خطای «شما اجازه دسترسی به این برگه را ندارید» در صفحهٔ اطلاعیه‌ها. علت واقعی، ثبت نادرست صفحه زیر منویی بود که وجود نداشت، نه مشکل دسترسی؛ سطح دسترسی لازم تغییری نکرده است.
* صفحهٔ اطلاعیه‌ها و سازندهٔ اطلاعیه به نشانی‌های استاندارد admin.php?page=… منتقل شدند. فهرست اطلاعیه‌ها همچنان روی نشانی خودِ نوع محتوا باقی است.
* دکمهٔ «اطلاعیه تازه» در نوار بالا مستقیم به سازندهٔ اطلاعیه می‌رود.
* جمع‌شدن نوار کناری در دسکتاپ و کشوی موبایل به دو حالت کاملاً مستقل تبدیل شدند؛ پیش‌تر یکی روی دیگری اثر می‌گذاشت.
* دیگر در پهنای زیر ۱۱۰۰ پیکسل نوار کناری به‌اجبار جمع نمی‌شود؛ انتخاب خود کاربر تا پهنای موبایل معتبر است.
* تغییر پهنای نوار کناری نرم و بدون پرش انجام می‌شود.
* نوار کناری تا پایین پنجره ادامه پیدا می‌کند، هنگام پیمایش سر جایش می‌ماند و در صورت بلند شدن فهرست، خودش اسکرول می‌شود.
* در حالت جمع‌شده، نام هر آیکن به‌صورت راهنمای شناور نمایش داده می‌شود.
* دکمهٔ جمع کردن و دکمهٔ بستن از هم جدا شدند و برچسب هرکدام با وضعیت فعلی هماهنگ است.
* کشوی موبایل با کلید Esc، با کلیک روی پوشش و با انتخاب هر پیوند بسته می‌شود و پشت آن صفحه اسکرول نمی‌کند.
* نشانه‌گذاری منوی فعال برای همهٔ مسیرهای اطلاعیه اصلاح شد.

= 1.7.2 =
* رنگ‌ها یک‌دست شد: سه مجموعهٔ متغیر جداگانه (jarchi، wpep و j) به یک مجموعهٔ واحد تبدیل شد و پالت دومی که رنگ‌های تیرهٔ خودش را تحمیل می‌کرد حذف شد.
* حالت روشن و تیره با پالت دقیق و کنترل‌شده بازنویسی شد؛ متن‌های کم‌رنگِ ناخوانا روی کارت‌ها اصلاح شد.
* کادر فیلدهای فرم مرز دیدنی گرفت تا در هر دو حالت مشخص باشد.
* «حداقل مبلغ سفارش» اکنون واقعاً کار می‌کند: سفارش کمتر از این مبلغ فرستاده نمی‌شود. ارقام فارسی، جداکنندهٔ هزارگان و اعشار پشتیبانی می‌شود.
* انتخاب پلتفرم برای سفارش‌ها اکنون مسیر واقعی ارسال را تعیین می‌کند؛ پیش‌تر هر سفارش با همهٔ پلتفرم‌ها خاموش به سرور می‌رسید.
* تلگرام و بله می‌توانند هم‌زمان سفارش بگیرند و هرکدام نشانی کانال خودش را همراه دارد.
* صفحهٔ ووکامرس نشان می‌دهد در این لحظه پیام سفارش‌ها به کدام پلتفرم‌ها می‌رود.
* «سازندهٔ اطلاعیه»: صفحهٔ اختصاصی جارچی برای نوشتن و تنظیم اطلاعیه، با چیدمان دو ستونی، انتخاب محل نمایش، تنظیم‌های مخصوص هر محل، شرط‌های نمایش، و پیش‌نمایش زندهٔ دسکتاپ/موبایل و روشن/تیره.
* فهرست اطلاعیه‌ها ستون‌های وضعیت، محل نمایش، مخاطب، اولویت و انقضا گرفت و امکان تکثیر اضافه شد.
* اطلاعیه‌های ساخته‌شده در نسخه‌های پیشین بدون از دست رفتن هیچ تنظیمی در صفحهٔ تازه باز می‌شوند و ویرایشگر پیشین هم در دسترس می‌ماند.

= 1.7.1 =
* نوار کناری جارچی روی همهٔ صفحه‌های افزونه، با منوی تودرتوی اطلاعیه‌ها و پلتفرم‌ها، نشانه‌گذاری صفحهٔ جاری، جمع‌شدن و حالت کشویی روی صفحه‌های کوچک.
* نوار بالا با مسیر صفحه و کلید تغییر حالت روشن/تیره/خودکار که روی همهٔ بخش‌ها اثر می‌گذارد و انتخاب هر کاربر جداگانه ذخیره می‌شود.
* پیش‌تر دو نوار کناری هم‌زمان روی صفحه ساخته می‌شد؛ اکنون فقط یکی وجود دارد.
* رنگ‌ها یک‌دست شدند: همهٔ رنگ‌های ثابت به یک مجموعهٔ متغیر مرکزی منتقل شد و لایهٔ قدیمی و ناسازگار حالت تیره حذف شد.
* خوانایی نوشته‌ها در هر دو حالت روشن و تیره اصلاح شد؛ متن ورودی‌ها در حالت روشن تیره و روی زمینهٔ سفید است.
* در حالت راست‌به‌چپ نوار کناری در سمت راست قرار می‌گیرد.

= 1.7.0 =
* سفارش‌های ووکامرس: ارسال پیام هنگام ثبت سفارش و تغییر وضعیت آن. سازگار با ذخیره‌سازی پرسرعت سفارش‌ها (HPOS) و ذخیره‌سازی کلاسیک، چون همه اطلاعات از خودِ ووکامرس خوانده می‌شود.
* هر رویداد سفارش فقط یک‌بار فرستاده می‌شود، حتی اگر ووکامرس همان وضعیت را دوباره اعلام کند.
* فیلدهای کامل سفارش: شماره، مشتری، صورتحساب، ارسال، پرداخت، مبالغ و فهرست کالاها.
* صفحه اختصاصی ووکامرس که فقط وقتی ووکامرس نصب باشد نمایش داده می‌شود.
* محل نمایش اطلاعیه‌ها: صفحه، بالای محتوا، پایین محتوا، نوار بالا، نوار پایین، پنجره بازشو، اعلان شناور و صفحه‌های ووکامرس.
* شرایط نمایش اطلاعیه بر اساس نشانی صفحه، نوع محتوا، صفحه اصلی، ورود کاربر، نقش کاربر و نوع دستگاه.
* افزودنی جت‌فرم‌بیلدر برای استفاده از اطلاعات فرم‌های ارسال‌شده.
* صفحه وضعیت سیستم که نشان می‌دهد جارچی چه افزونه‌هایی را می‌بیند.
* اطلاعیه‌های ساخته‌شده در نسخه‌های قبل بدون تغییر روی «صفحه اطلاعیه‌ها» باقی می‌مانند.
* این نسخه هیچ تغییری در ساختار پایگاه داده ندارد.

= 1.6.1 =
* صفحه اطلاعیه‌ها حالا یک صفحه واقعی با طراحی جارچی است — کارت، آیکون، تصویر، تاریخ و نشان وضعیت. بدون المنتور هم درست نمایش داده می‌شود؛ المنتور یک امکان اضافه است، نه پیش‌نیاز.
* رفع اشکال مهم در «فیلدهای انتشار»: فیلدها شناسایی می‌شدند اما در صفحه نمایش داده نمی‌شدند. کارت هر فیلد داخل یک جدول قرار می‌گرفت که مرورگر آن را از جدول بیرون می‌انداخت. حالا کارت‌ها در ظرف درست خود قرار می‌گیرند.
* صفحه فیلدها سه حالت متفاوت را از هم جدا می‌کند: در حال دریافت، فیلدی پیدا نشد، و دریافت با مشکل مواجه شد — به همراه دکمه تلاش دوباره.
* فیلدها در دسته‌های خوانا گروه‌بندی می‌شوند و فقط دسته‌هایی که واقعاً فیلد دارند نمایش داده می‌شوند.
* بازطراحی کامل رنگ‌ها بر پایه یک سیستم معنایی. همه رنگ‌های متن و وضعیت در هر دو حالت روشن و تاریک استاندارد دسترس‌پذیری AA را می‌گذرانند.
* حالت تاریک بازنویسی شد و دیگر وارونه‌سازی حالت روشن نیست.
* بهبود خوانایی برچسب‌ها، توضیح‌ها، متن راهنمای فیلدها، حاشیه‌ها و حالت‌های غیرفعال.
* یکدست شدن ظاهر کارت‌ها، دکمه‌ها، کلیدها و فاصله‌ها در همه صفحه‌ها.
* نمودار هفتگی داشبورد همیشه از شنبه شروع و به جمعه ختم می‌شود.
* بهبود ترجمه فارسی و یکدست شدن اصطلاح‌ها.
* این نسخه هیچ تغییری در پایگاه داده ندارد. ارتقا از ۱.۶.۰ بدون از دست رفتن تنظیمات، نگاشت فیلدها، اطلاعیه‌ها، صف، گزارش‌ها و کلیدها انجام می‌شود.

= 1.6.0 =
* جارچی: نام و هویت محصول به «جارچی» تغییر کرد. شناسه‌های داخلی — نام گزینه‌ها، هوک‌ها، کلیدهای پایگاه داده و دامنه ترجمه — دست‌نخورده ماندند تا هیچ سایتی چیزی از دست ندهد.
* پلتفرم‌ها: صفحه‌های تلگرام، بله و واتس‌اپ. هیچ توکن یا کلید محرمانه‌ای در وردپرس ذخیره نمی‌شود.
* انتخاب مقصد برای هر نوشته، با امکان انتخاب هم‌زمان چند پلتفرم.
* `publication_targets` و `buttons` حالا واقعاً از تنظیمات پر می‌شوند و تا خود وب‌هوک می‌روند. نسخه قرارداد ۱.۳.
* فیلد «شماره تماس» و «تماس با آگهی‌دهنده» با کنترل کامل نمایش در هر پلتفرم. شماره تماس فقط وقتی منتشر می‌شود که فیلد روشن باشد، پلتفرم مقصد روشن باشد و آن پلتفرم اجازه نمایش داشته باشد.
* نمایش هر فیلد به تفکیک پلتفرم، در صفحه فیلدها و در `field_meta`.
* سازنده بصری قالب پیام؛ ویرایش پیشرفته همچنان در دسترس است.
* اطلاعیه‌ها: نوع محتوای اختصاصی، شورت‌کد، ابزارک المنتور و آیکون اعلان.
* داشبورد: نمودار هفتگی همیشه هر هفت روز را نشان می‌دهد، روز جاری بلافاصله پر می‌شود و همه‌چیز بر اساس منطقه زمانی سایت محاسبه می‌شود.
* تنظیمات ساده‌تر شد. هیچ گزینه‌ای از پایگاه داده حذف نشده است؛ فقط از صفحه برداشته شده‌اند.
* روش پیش‌فرض احراز هویت: کلید API.
* برای نصب‌های تازه همه فیلدها و همه پلتفرم‌ها خاموش هستند. سایت‌هایی که ارتقا می‌دهند دقیقاً همان چیزی را منتشر می‌کنند که قبلاً می‌کردند.

= 1.5.1 =
* Added: `field_meta` in the webhook payload. It is keyed identically to `fields` and describes every value sent — the label the administrator gave it, the order they dragged it into, its type, its source, its storage key, whether it repeats, whether it is required, and its choice list. A consumer no longer has to fall back to a generic label or keep a hardcoded table of key-to-label guesses: WordPress is the source of truth for what a field is.
* Added: `author.phone`, read from the post author's user meta over a conventional key list (`billing_phone`, `phone`, `mobile`, and similar), extensible with the `wpep_author_phone_meta_keys` filter. Nothing is guessed: no number is taken from message text, no key is fuzzy-matched, and a user ID or other numeric metadata is never read as a telephone number. When no key holds one, the value is an empty string.
* Changed: the contract version is now `1.2`. The change is additive — no field was removed or renamed, and a consumer written against `1.1` keeps working untouched.
* Changed: the plugin author is now ممد از تیم بایمر. The plugin slug, text domain, namespace, hooks, option names and database keys are all unchanged.

= 1.5.0 =
* Added: Profiles. One reusable publishing configuration — fields, order, labels, template, images, destinations — assigned to a post type or a category, with inheritance between profiles. Only what a profile overrides is stored; a chain that would loop is refused. Create, rename, duplicate, delete, export, import and assign from a dedicated screen.
* Added: a Rule Engine. Conditions on category, taxonomy, post type, status, author, role, any custom field, price, image and gallery counts, word count, date and time, with sixteen operators, AND/OR groups and nesting. Actions can pick the profile, template, destinations and channel, add or replace text, show or hide fields, cap images, delay, or stop publication. Rules are drag-reorderable and run top to bottom.
* Added: a Rule Tester that shows, for any advertisement, which rules matched and why, the profile and template that won, the fields, the destinations, the final message and the final payload — without sending anything.
* Added: destination providers behind one interface. Telegram Publisher (the default, unchanged), generic webhook, Discord, Slack and e-mail ship; a new service is one adapter class registered with `wpep_delivery_providers`, and its settings form builds itself from the adapter's own schema, so the core plugin never needs modifying.
* Added: multiple destinations per advertisement, each with its own profile, template, image limit and delay. Five Telegram channels are five destinations sharing one adapter.
* Added: scheduled publishing on WP-Cron — immediately, 5 or 30 minutes, an hour, tomorrow, or a custom delay. A delayed publication is rebuilt when it is finally sent, so an edit goes out corrected and a deletion cancels it.
* Added: message generation separated from delivery. Every destination receives one identical normalized publication object.
* Improved: Field Mapping gains collapsible groups with counts and select-all, a NEW badge on fields a framework added since you last looked (left switched off), per-profile favourites, and a live preview that re-renders as you change anything.
* Improved: everything in boot is wrapped, so an unexpected failure becomes an explanatory admin notice instead of a white screen. A throwing field provider, delivery adapter or template is contained and logged.
* Fixed: `WordPressProvider` could not be resolved by the autoloader, which would have been a fatal on a real installation; the class is now `CoreProvider` and its `wordpress` provider id is unchanged, so no stored data was affected.
* Fixed: an undefined-index warning when a profile built its formatting defaults.
* Compatibility: nothing was removed from the payload and nothing changes on upgrade. A site with no profile, rule or destination posts the same payload to the same endpoint as before.

= 1.4.0 =
* Added: automatic field discovery. Selecting a post type lists every field it actually has — native post fields, every meta key in use, every registered taxonomy, and images — each with a label, type, sample value and whether it repeats.
* Added: a provider architecture behind one interface. JetEngine, Advanced Custom Fields, Meta Box and Pods are read when present and are never required; a site with none of them gets the same fields from the generic meta scan. A framework's own description replaces the guess rather than duplicating it, and deactivating a framework does not lose the field.
* Added: per-category field mappings that inherit. A mapping belongs to a post type, or to a post type and a term; resolution walks from the post's deepest category outwards, so "Cars → SUV" adds to what "Cars" says instead of repeating it, and editing "Cars" reaches everything under it.
* Added: a Field Mapping screen with enable/disable, editable labels, drag-and-drop ordering, search, bulk actions, and four visibilities — visible in Telegram, backend only, admin only (never transmitted) and hidden.
* Added: a message template builder. Every mapped field becomes a placeholder; `{{#if field}}…{{/if}}` and `{{#unless}}` handle optional blocks; templates inherit per category, so cars, real estate and jobs each get their own. Preview renders against a real advertisement.
* Added: repeaters (JetEngine, ACF, Meta Box clones, nested arrays) formatted as an inline list, bullets, numbers or one per line with a configurable separator; select and checkbox values resolved to their labels, so `diesel` publishes as "Diesel".
* Added: a dynamic `fields` object in the payload carrying exactly the enabled fields, plus `category`, `subcategory`, `term` and `path` in the taxonomy block and a rendered `message`.
* Performance: discovery is cached under a key that includes every provider's signature, so installing or editing a field framework invalidates it automatically. Delivery reads meta and never scans.
* Compatibility: no payload field was removed. A post type with no mapping falls back to a default reproducing exactly what the site sent before, so upgrading changes nothing downstream until you choose otherwise.

= 1.3.2 =
* Fixed: internal post types can no longer be watched. `attachment`, `revision`, `nav_menu_item`, `wp_navigation`, `wp_block`, `wp_template`, `wp_global_styles`, the font and Action Scheduler types and the rest of the WordPress internals are excluded in every detection mode, so editing a menu, saving a template or updating an attachment never produces an event.
* Fixed: editing an advertisement that went live before the plugin was installed no longer announces it as new. Bulk editing a back catalogue therefore cannot empty it into the channel. Anything published from the moment of installation onwards is announced normally, and the `wpep_backfill_cutoff` filter moves the line.
* Fixed: one request now delivers at most three advertisements itself. Publishing fifty at once used to chain fifty serial HTTP round trips onto a single shutdown, which is how a bulk action reaches the PHP execution time limit; the remainder is delivered by the scheduler or the queue sweeper moments later. The `wpep_inline_batch_limit` filter changes or removes the cap.
* Added: lifetime delivery counters — total successful deliveries, total failed deliveries, last success, last failure and last response code — shown on the Diagnostics screen and kept independently of the queue's retention window. No credential is stored, displayed or logged.

= 1.3.1 =
* Fixed: the payload builder no longer runs `the_content` during background delivery. It ran on shutdown after the response was flushed, outside the loop, with every third-party content filter attached — so a page builder or JetEngine filter that fataled there killed the delivery silently, before the HTTP request was made. This is why the connection test passed while real publishing did not.
* Fixed: a delivery that kills the process (fatal, memory limit, execution timeout) is now counted and retired instead of being retried forever.
* Changed: the sweeper's queue check is an autoloaded flag rather than a COUNT query, so a quiet queue costs nothing on front-end requests.

= 1.3.0 =
* Fixed: the delivery queue moved from transients into its own database table. With a persistent object cache a transient is a cache entry, so queued advertisements were evicted or flushed away — the cause of delivery working on one site and not another.
* Fixed: delivery no longer depends on which hooks a given publishing path fires. A router subscribes to transition_post_status, the {old}_to_publish aliases, wp_after_insert_post, post_updated, save_post, wp_trash_post, before_delete_post and untrashed_post, and the idempotency guard collapses them into one event.
* Fixed: the duplicate guard is keyed on the logical publication, not the derived event type, so an alias hook can no longer emit a second event as "updated".
* Added: retry policy by outcome — 401/403/404/422 are never retried, 408/429/5xx and transport failures are, with backoff, jitter and Retry-After support.
* Added: a Diagnostics screen checking configuration, URL, authentication, post types, hooks, queue, scheduling, DNS, TLS, service health and a real webhook request.
* Added: automatic post type discovery for JetEngine, ACF, CPT UI, WooCommerce and any other registration.
* Added: a safety net that announces a published advertisement which was never sent, restore handling, a separate connection timeout, custom request headers, and cross-framework field and gallery resolution.
* Added: failures are explained in words instead of "cURL error 28".

= 1.2.1 =
* Fixed: the webhook request no longer runs with a timeout the plugin did not ask for. Another plugin clamping `http_request_args` is overridden and named in the log; the minimum timeout is now 5 seconds and stored values below 10 are raised to 15 on upgrade. This is the "cURL error 28: Operation timed out after 3002 milliseconds" failure, which affected the connection test and real deliveries alike.
* Fixed: `X-Webhook-Secret` is sent with every authentication style, so narrowing the style cannot cause "Missing webhook authentication".
* Added: the connection test probes /health on the same origin when the webhook POST fails, separating a network problem from a configuration problem.
* Added: `phone` in the payload plus a Phone Meta Keys setting.
* Added: request duration and the effective timeout in every delivery log entry.
* Added: complete Persian (fa_IR) admin translation with RTL layout, and an Admin Language setting (Persian, English, or follow WordPress).

= 1.2.0 =
* Fixed: real advertisement publishes now reach the Node.js service. The payload carries the flat `post_id`, `title`, `description`, `price`, `location`, `url` and `images` fields the backend reads, alongside the existing structured blocks.
* Fixed: delivery no longer depends on WP-Cron. Automatic dispatch mode delivers at the end of the publish request, a sweeper re-runs stuck events, and a completion marker plus per-attempt lock prevent double delivery.
* Fixed: custom post types that are not `public` can now be selected as advertisement post types, and a selected slug is never silently dropped when saving.
* Added: full lifecycle logging (hook fired, skip reason, event created, queued, scheduled, sent, HTTP status, response body, retries) with a Debug Mode.
* Added: Event Types, Dispatch Mode, Authentication Style, Trash Handling, Debug Mode, price/location/image meta mapping, Description Source and Maximum Images settings.
* Added: Tools actions to send one advertisement immediately and to process the queue now, plus a pipeline status panel.
* Added: `X-Hub-Signature-256`, `X-Webhook-Secret`, `Authorization: Bearer` and `X-Idempotency-Key` headers so the backend can authenticate with the scheme it already implements.
* Added: image collection from WooCommerce galleries, mapped meta fields, attached images and content `<img>` tags, normalized to absolute HTTPS URLs.
* Changed: the webhook URL defaults to `https://your-jarchi-endpoint.example/webhook` and the plugin is enabled by default on a fresh install.

= 1.1.0 =
* Added the versioned webhook contract: event_id, event_type, timestamp, site, post, author, listing, media and taxonomy blocks.
* Added `created`, `updated` and `deleted` lifecycle detection with duplicate suppression and content fingerprinting.
* Added stable event identifiers that survive retries, for consumer-side idempotency.
* Added HMAC-SHA256 request signing over the raw body, with `X-Site-ID`, `X-Event-ID`, `X-Timestamp` and `X-Signature` headers.
* Added the Site ID and Webhook Signature Tolerance settings.
* Added event_id, event_type and site_id to the log table, the Logs filters, the CSV export and the REST `/logs` endpoint.
* Added HMAC authentication to the REST API alongside the existing API key.
* Extracted event detection, identifier generation, contract building, signing and retry orchestration into dedicated classes.
* Added an automatic migration from 1.0.0 that preserves all settings, logs and delivery history.

= 1.0.0 =
* Initial release: event detection, async webhook dispatch with retries, normalizer, custom log table, admin dashboard, REST API, tools.

== Upgrade Notice ==

= 1.5.1 =
Adds `field_meta` to the payload, so the receiving service can label every field the way you named it instead of guessing from the key, and adds `author.phone` read from user meta. The contract version moves to 1.2 and the change is purely additive: nothing was removed or renamed, and no configuration change is required.

= 1.5.0 =
Adds Profiles, a Rule Engine and multi-destination publishing (Telegram, Discord, Slack, e-mail, any webhook), plus scheduling and a Rule Tester. Also fixes an autoloader mismatch that would have been fatal on a real installation. Nothing is removed and nothing changes on upgrade: until you save a profile, rule or destination, your site publishes exactly what it published before.

= 1.4.0 =
Adds automatic field discovery, per-category field mappings and a message template builder, so the plugin adapts to any custom post type instead of assuming what an advertisement is. Nothing is removed from the payload and no mapping is required: until you save one, every post type keeps sending exactly what it sent before.

= 1.3.2 =
Hardening release. Internal post types can no longer be watched, editing a pre-install advertisement no longer announces it as new, bulk publishing no longer chains its HTTP requests onto one page load, and Diagnostics reports lifetime delivery totals and the last response code. No configuration change is required.

= 1.3.1 =
Fixes the real publish-time failure: the payload builder ran the_content in a background request, where a third-party filter could kill the delivery invisibly. Upgrade if publishing does not reliably reach the service.

= 1.3.0 =
Makes delivery reliable across installations: durable queue table, every publishing hook covered, retry policy by outcome and a diagnostics screen. Upgrades automatically and carries in-flight events across.

= 1.2.1 =
Fixes spurious webhook timeouts (cURL error 28) caused by a shortened request budget, always sends X-Webhook-Secret, and adds a Persian RTL admin UI. Settings migrate automatically.

= 1.2.0 =
Fixes real advertisement publishes not reaching the Node.js service. Settings and logs migrate automatically; review Settings → «کدام محتوا در جارچی منتشر شود؟» and Event Types after updating.

= 1.1.0 =
Adds the signed event contract for the Node.js backend. Existing settings and logs are migrated automatically. Deploy HMAC verification in your Node.js service before or alongside this update; the X-API-Key header is still sent for compatibility.

= 1.0.0 =
Initial release.
