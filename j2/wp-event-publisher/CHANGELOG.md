# جارچی 1.19.2

نسخهٔ رفع اشکال و پایداری. هیچ طراحی‌ای عوض نشده: رنگ‌ها، سایدبار، فیلدهای پویا، قالب‌بند پویا، طراحی المنتور، رابط اطلاعیه، رابط ووکامرس، تایپوگرافی و مسیر ناوبری دقیقاً همان‌اند که بودند. تنها افزودهٔ دیداری، یک صفحهٔ «پاک‌سازی تیکت» است که با همان کارت‌ها و همان استایل‌های موجود ساخته شده.

---

## ۱. تیکت تکراری دیگر ممکن نیست — این بار به‌صورت ریاضی

در ۱.۱۹.۰ تصمیم «این پیام را قبلاً فرستاده‌ایم یا نه» با خواندن یک متای کاربر و بعد نوشتن آن گرفته می‌شد. این دو عمل است، نه یک تصمیم. دو درخواستی که هم‌زمان می‌رسند هر دو «هنوز نفرستاده‌ایم» را می‌خوانند و هر دو می‌فرستند. با قلاب‌های هم‌پوشان ووکامرس، کران روی بارگذاری صفحه، و ذخیرهٔ دوبارهٔ نوشته، همین کافی بود که یک کاربر صدها نسخه از یک پیام بگیرد.

جای آن یک **دفتر رویداد** ماندگار آمده است: جدول `wp_wpep_automation_events` با کلید یکتا روی `event_key`، و ادعای هر رویداد با یک `INSERT IGNORE` انجام می‌شود. دیتابیس داوری می‌کند و دقیقاً یک فراخوان «تو بردی» می‌شنود. هیچ چیز دیگری در وردپرس عمل مقایسه‌وجایگزینی اتمیک ندارد؛ پس هیچ راه دیگری این تضمین را نمی‌دهد.

- ۵۰ ادعای هم‌زمان روی یک رویداد ← دقیقاً یک برنده (آزمون‌شده).
- ۵۰ رویداد متفاوت ← هر ۵۰ رد می‌شوند (چون سازوکاری که همه چیز را رد کند هم آزمون قبلی را پاس می‌کرد).
- اگر ساخت تیکت شکست بخورد، ادعا پس داده می‌شود؛ پیام برای همیشه بلعیده نمی‌شود.

## ۲. «فقط یک بار» یعنی یک بار برای همان چیز

اگر رویداد شیئی داشته باشد (آگهی، سفارش، دیدگاه) واحد شمارش همان شیء است: آگهی دوم فروشنده یک رویداد تازه است و پیام می‌گیرد، ولی همان آگهی هر چند بار هم منتشر شود تیکت دوم نمی‌سازد. اگر رویداد شیئی نداشته باشد (ثبت‌نام، تکمیل پروفایل، پویش زمان‌بندی‌شده) کلید به کاربر و قانون فرو می‌ریزد و پیام یک بار در کل عمر حساب می‌رود — و همین است که نمی‌گذارد پویشی که هر ساعت همهٔ کاربران را دوباره می‌بیند، هر ساعت به آن‌ها پیام بدهد.

پیش از این «فقط یک بار» شیء را نادیده می‌گرفت، پس آگهی دوم به کلید آگهی اول می‌چسبید و بی‌صدا ناپدید می‌شد. توضیح این گزینه در فرم هم اصلاح شد تا همین را بگوید.

## ۳. انتشار، فقط وقتی واقعاً انتشار است

قانون «انتشار آگهی» فقط روی گذاری اجرا می‌شود که از وضعیتی می‌آید که نوشته واقعاً می‌تواند از آن منتشر شود (پیش‌نویس، در انتظار بازبینی، زمان‌بندی‌شده و مانند آن). ویرایش یک نوشتهٔ منتشرشده، بازگرداندن از زباله‌دان یا تغییر خصوصی‌بودن دیگر رویداد «منتشر شد» تولید نمی‌کند.

## ۴. پویش زمان‌بندی‌شده: مکان‌نما، قفل، و کاربرانی که جا می‌ماندند

- پویش با مکان‌نما روی کاربران قدم می‌زند (۲۵تایی) به‌جای بارگذاری کل جدول کاربران در یک درخواست.
- یک قفل سراسری با عمر محدود مانع اجرای هم‌زمان دو پویش می‌شود، و قفل رهاشده بازیابی می‌شود.
- **باگ پیدا شده در همین دور:** مکان‌نما به اندازهٔ کل دسته جلو می‌رفت، حتی وقتی سقف ۲۰ تیکت در هر درخواست حلقه را زودتر می‌شکست. دستهٔ ۲۵تایی با سقف ۲۰ یعنی هر بار ۵ کاربر از رویشان رد می‌شد. در آزمون ۵۰۰ کاربر، ۱۰۰ نفر در گذر اول جا می‌ماندند و فقط دور بعدی — ساعت‌ها یا روزها بعد — پیام می‌گرفتند. حالا مکان‌نما فقط روی کسانی جلو می‌رود که واقعاً بررسی شده‌اند.

## ۵. کار تأخیری

قانون تأخیردار ادعایش را هنگام زمان‌بندی می‌گیرد، پس رویداد دوم اصلاً به زمان‌بندی نمی‌رسد و کار دوم صف نمی‌شود. پیش از تحویل هم دوباره بررسی می‌شود که قانون هنوز هست و هنوز روشن است؛ اگر مدیر در فاصلهٔ تأخیر آن را خاموش کرده باشد، ادعا پس داده می‌شود و پیامی نمی‌رود.

## ۶. اجرای آزمایشی (Dry run)

هر قانون یک دکمهٔ «اجرای آزمایشی» دارد: گزارش می‌دهد چند کاربر بررسی شدند، چند نفر شرط را داشتند، برای چند نفر پیام می‌رفت و چند نفر قبلاً گرفته‌اند — و **هیچ تیکتی نمی‌سازد**. اجرای دستی هم دیگر دکمهٔ «برای همه اجرا کن» ندارد؛ باید یک کاربر مشخص نام برده شود و از همان دفتر رویداد عبور می‌کند.

## ۷. پاک‌سازی تیکت (تنها صفحهٔ تازه)

ابزاری برای پاک کردن انبوه تیکت‌هایی که نسخه‌های قبل ساخته‌اند:

- دو دامنه: فقط تیکت‌های خودکار، یا همهٔ تیکت‌ها. دومی علاوه بر دکمه، تایپ کلمهٔ `DELETE` را لازم دارد.
- ۱۰۰تایی حذف می‌کند و وضعیت را نگه می‌دارد، چون حذف ده‌هزار نوشته در یک درخواست وسط کار تمام می‌شود و هیچ ردی از جای توقف نمی‌ماند.
- **تا وقتی کار در جریان است، تیکت‌های خودکار متوقف می‌شوند.** پاک کردن چیزی که همان لحظه دارد دوباره پر می‌شود، مسابقه است نه پاک‌سازی.
- در پایان دفتر رویداد هم فراموش می‌کند، وگرنه آن قانون‌ها دیگر هرگز نمی‌توانستند بفرستند.
- به هر چیزی که نوع محتوایش تیکت جارچی نیست دست نمی‌زند، شمارهٔ نوشته هرجور که رسیده باشد.
- پیوست‌های تیکت هم با آن پاک می‌شوند (بخش ۹).

## ۸. اعلان‌ها

- وب‌پوش به کران سپرده می‌شود، پس ثبت تیکت پشت درخواست HTTP به سرویس پوش منتظر نمی‌ماند. اگر زمان‌بندی ممکن نباشد، همان‌جا فرستاده می‌شود تا اعلان گم نشود.
- برای کاربری که اصلاً اشتراک پوش ندارد هیچ کاری زمان‌بندی نمی‌شود.
- فهرست اعلان‌های ذخیره‌شده سقف ۵۰ تایی دارد و بی‌نهایت رشد نمی‌کند.

## ۹. پیوست‌ها

- **یک سیاست، هر دو مسیر.** پیش از این سه مجموعه محدودیت ناهماهنگ وجود داشت: تنظیمات پیشرفته، عدد ثابت داخل کد، و متنی که زیر فرم چاپ می‌شد و با هیچ‌کدام نمی‌خواند. حالا هر سه از یک جا می‌آیند و متن زیر فرم همان دو عددی را می‌گوید که سرور اجرا می‌کند.
- **اعتبارسنجی بر اساس محتوا، نه بر اساس ادعا.** مرورگر برای هر فایل یک Content-Type می‌فرستد و هیچ چیز آن را راستی‌آزمایی نمی‌کند. حالا امضای واقعی فایل خوانده می‌شود: اسکریپتی که با نام `.png` فرستاده شود رد می‌شود، و نوع تشخیص‌داده‌شده — نه نوع ادعاشده — به وردپرس تحویل می‌رود.
- **مسیرهای جعلی.** فایلی که این درخواست واقعاً آپلود نکرده باشد رد می‌شود، وگرنه یک درخواست دستکاری‌شده می‌توانست فایلی که از قبل روی دیسک است را به کتابخانهٔ رسانهٔ عمومی کپی کند.
- سقف حجم و سقف تعداد سمت سرور اجرا می‌شوند، و شمارش روی فایل‌های **پذیرفته‌شده** است نه روی دفعات حلقه.
- **حذف امن:** با حذف تیکت، پیوست‌هایش هم حذف می‌شوند — از هر مسیری که حذف شده باشد. پیش از این مدارک هویتی یا فاکتور مشتری بعد از حذف تیکت روی یک نشانی عمومی باقی می‌ماند، و بعد از یک پاک‌سازی انبوه، هزاران فایل بی‌صاحب.

## ۱۰. اجازه‌ها — روی خود تیکت، نه فقط روی صفحه

- تغییر وضعیت و واگذاری، شمارهٔ تیکت را از فیلد فرم می‌گرفتند و آن را بررسی نمی‌کردند. شمارهٔ اشتباه یا جعلی، متای جارچی را روی یک نوشتهٔ بی‌ربط می‌نوشت و وب‌هوکی می‌فرستاد که آن را تیکت معرفی می‌کرد. حالا هر کنش، تیکت‌بودن و دسترسی را تأیید می‌کند.
- **پشتیبان‌ها بالاخره می‌توانند کار کنند.** بررسی فقط-بر-اساس-توانایی، پشتیبان را مثل مشتری می‌دید و اجازهٔ پاسخ به تیکت دپارتمان خودش را هم نمی‌داد. حالا می‌تواند — و فقط داخل دپارتمان‌های خودش. واگذاری همچنان تصمیم مدیر است.
- پشتیبان بدون دپارتمان هیچ چیز نمی‌بیند، نه همه چیز: «هنوز تنظیم نشده» نباید بازترین حالت باشد.

## ۱۱. ارسال همگانی برای ده‌هزار نفر

«ارسال به همهٔ کاربران» تنها جای باقی‌مانده بود که کل جدول کاربران را در یک درخواست می‌خواند و بعد **همهٔ** شناسه‌ها را در یک ردیف آپشن ذخیره می‌کرد، و هر دسته ۲۵تا از ابتدای آرایه برمی‌داشت و کل ردیف را دوباره می‌نوشت. برای ده‌هزار کاربر یعنی کار درجه‌دو برای فرستادن پیام درجه‌یک. حالا آن ردیف یک مکان‌نماست: ۳۴۷ بایت، مستقل از تعداد کاربران.

## ۱۲. باگ‌های دیگری که در همین دور پیدا شد

- پاسخ دادن به تیکتی که حساب مشتریِ آن حذف شده بود، درخواست را با خطای نوع تمام می‌کرد — **بعد از اینکه پاسخ ذخیره شده بود**. `get_user_by()` برای حساب حذف‌شده `false` برمی‌گرداند نه `null`.
- اگر ثبت اولین پیام تیکت شکست می‌خورد، تیکت خالی باقی می‌ماند. حالا برگردانده می‌شود.
- تیکتی که مدیر بدون اجازهٔ پاسخ می‌سازد، **بسته** ثبت می‌شود نه «در انتظار پاسخ».
- یک فایل خالی به نام `false"` که از یک تغییرمسیر اشتباه در پوسته جا مانده بود و در بستهٔ ۱.۱۹.۰ منتشر شده بود، حذف شد.

---

## آزمون‌ها

پنج مجموعه، همه سبز: تیکت‌ها، خودکارسازی، تکرارناپذیری، بار و همروندی، و بازرسی ایستا. ادعاهای تازهٔ اجازه‌ها و پیوست‌ها با **آزمون جهش** تأیید شده‌اند — یعنی هر محافظ یک‌به‌یک برداشته شد و بررسی شد که آزمون واقعاً شکست می‌خورد.

**چیزی که آزمون نشده و ادعا نمی‌شود:** این‌ها روی یک بدل آزمایشی اجرا می‌شوند، نه روی وردپرس و MySQL واقعی. شکل کار (چند تیکت، چند کوئری، چقدر کار در هر درخواست) دقیق سنجیده می‌شود؛ تأخیر واقعی، قفل ردیف در InnoDB، بن‌بست و تلاش دوباره، محدودیت worker‌های PHP-FPM، و رفتار کش شیء تحت فشار سنجیده **نمی‌شود**. بار تولیدی با این فایل‌ها تأیید نشده است.


---

# جارچی 1.19.0

## ۱. سیل تیکت خودکار — علت اصلی پیدا و بسته شد

تیکت خودش یک نوشته است. ساختنش رویداد `transition_post_status` را صادر می‌کند و همان رویدادی است که قانون «انتشار آگهی» به آن گوش می‌دهد. پس خروجی قانون دوباره خودش را فعال می‌کرد و حلقه فقط وقتی می‌ایستاد که PHP تمام می‌شد — یعنی صدها تیکت برای یک کاربر و مرگ همان درخواستی که داشت آگهی را ثبت می‌کرد.

سه محافظ مستقل گذاشته شد، چون یک محافظ برای باگی که علامتش بی‌نهایت است کافی نیست:

1. نوع محتواهای خود افزونه (تیکت، اطلاعیه، سفارش، بازبینی، پیوست) هرگز هیچ قانونی را فعال نمی‌کنند.
2. هر قانون فقط برای نوع محتوایی که برایش تنظیم شده اجرا می‌شود. این همان بررسی‌ای بود که وجود نداشت: فیلد `post_type` ذخیره می‌شد ولی خوانده نمی‌شد.
3. یک پرچم ورود مجدد و سقف ۲۰ تیکت در هر درخواست. اگر سقف پر شود، در گزارش ثبت می‌شود.

آزمون این حلقه را واقعاً بازتولید می‌کند: `wp_insert_post` در هارنس مثل وردپرس رویداد صادر می‌کند. با برداشتن محافظ‌ها، آزمون ۲۰ تیکت می‌شمارد و شکست می‌خورد.

## ۲. تیکت خودکار قابل پاسخ نیست

- تیکت خودکار و اطلاع‌رسانی: **بسته** ساخته می‌شود، نه «در انتظار پاسخ». در فهرست کاربر هم به‌عنوان کار ناتمام نمی‌ماند.
- در فرم ادمین تیک «کاربر بتواند پاسخ دهد» اضافه شد. اگر نخورد، تیکت بسته و بدون امکان پاسخ است.
- این یک قانون است نه پنهان‌کردن دکمه: اگر کسی فرم را دوباره ارسال کند، سمت سرور رد می‌شود.
- زمان «اولین پاسخ» برای تیکت‌هایی که خود سایت شروع کرده ثبت نمی‌شود؛ ثبتش گزارش SLA را با کاری که انجام نشده زیبا می‌کرد.

## ۳. تیکت فقط برای همان کاربر

هر رویداد صاحب مشخصی دارد و تیکت فقط برای او می‌رود: ثبت‌نام، اولین ورود، انتشار آگهی (نویسنده), رد آگهی، ثبت سفارش (خریدار)، تغییر وضعیت سفارش، پاسخ روی دیدگاه (صاحب دیدگاه). فقط دو رویداد «همهٔ کاربران» را بررسی می‌کنند و هر دو در صفحه با هشدار مشخص شده‌اند.

## ۴. شرط‌ها قابل فهم شد

- هر شرط نوع مقدارش را اعلام می‌کند، پس فرم کنترل درست را نشان می‌دهد: فهرست نقش‌ها، جعبهٔ عدد، یا متن — نه یک جعبهٔ متن بی‌برچسب کنار همه چیز.
- فرم فقط فیلدهای مربوط به رویداد انتخاب‌شده را نشان می‌دهد.
- هر قانون در فهرست به‌صورت یک جملهٔ فارسی نمایش داده می‌شود: «وقتی «ثبت‌نام کاربر» رخ دهد، فقط برای کاربران با نقش «customer» تیکتی با عنوان «...» ساخته می‌شود.»

## ۵. سفارش ووکامرس

- قالب **ثبت سفارش** با شمارهٔ سفارش، مبلغ، وضعیت و فهرست اقلام.
- قالب **تغییر وضعیت سفارش** که می‌تواند روی همهٔ تغییرات یا یک وضعیت خاص تنظیم شود.
- «یک بار» برای سفارش یعنی یک بار به‌ازای هر سفارش، نه یک بار در عمر کاربر.

## ۶. بج تیکت — علتش ترتیب بود

سربرگ صفحه تعداد خوانده‌نشده را چاپ می‌کرد و بعد رشتهٔ گفتگو پرچم را پاک می‌کرد؛ یعنی روی همان صفحه‌ای که تازه خوانده بودید عدد قدیمی می‌ماند. حالا پرچم قبل از هر رندری پاک می‌شود.

- شمارش با یک `COUNT(*)` انجام می‌شود، نه `WP_Query` با شمارش کل ردیف‌ها.
- نتیجه ۳۰ ثانیه کش می‌شود و هر نوشتن پرچم کش را باطل می‌کند.
- به‌روزرسانی هر **۱۰ ثانیه**، و در تب پنهان اصلاً درخواستی فرستاده نمی‌شود.

## ۷. اعلان‌ها

- **باگ واقعی:** درخواست وب‌پوش با `blocking => false` فرستاده می‌شد، پس کد پاسخ همیشه صفر بود و شاخهٔ حذف اشتراک‌های منقضی (404/410) هرگز اجرا نمی‌شد. اشتراک‌های مرده برای همیشه انباشته می‌شدند.
- **گپ واقعی:** وقتی کاربر تیکت می‌زد یا پاسخ می‌داد، هیچ ایمیلی برای تیم پشتیبانی نمی‌رفت. حالا می‌رود — اول به پشتیبان‌های همان دپارتمان، وگرنه به ایمیل مدیر.
- متن ایمیل دیگر برای پیامی که خود سایت شروع کرده نمی‌گوید «پاسخ داده شد».

## ۸. صفحهٔ «تیکت‌های من»

چیدمان دو ستونی بود بدون هیچ نقطهٔ شکست موبایلی. روی صفحهٔ ۳۹۰ پیکسلی فهرست و گفتگو فضایی را تقسیم می‌کردند که هیچ‌کدام نداشت.

- زیر ۸۶۰ پیکسل: یک‌بار یک صفحه. باز کردن تیکت، فهرست را کنار می‌گذارد و لینک «همهٔ تیکت‌ها» برمی‌گرداند.
- جعبهٔ پاسخ روی موبایل چسبیده به پایین می‌ماند.
- هدف‌های لمسی حداقل ۴۴ پیکسل، فیلترها به‌جای شکستن به دیوار، افقی اسکرول می‌شوند.
- تراشه‌های وضعیت رنگی، عنوان دو خطی به‌جای بریدن، و پیام روشن برای گفتگوی بسته یا اطلاع‌رسانی.

## ۹. حذف دپارتمان و دسته‌بندی

دپارتمان و دستهٔ پیش‌فرض از `register_content_types()` ساخته می‌شدند که روی هر `init` اجرا می‌شود — پس حذف آخرین مورد موفق بود و درخواست بعدی برش می‌گرداند. حالا فقط یک بار ساخته می‌شوند.

## ۱۰. پشتیبان و دپارتمان

هر پشتیبان به دپارتمان وصل می‌شود و فقط تیکت‌های همان‌ها را می‌بیند. محدودیت در **کوئری** است نه روی نمایش، و صفحهٔ تک‌تیکت جداگانه هم بررسی می‌کند. پشتیبان بدون دپارتمان هیچ تیکتی نمی‌بیند.

## ۱۱. کارایی

- شمارش وضعیت تیکت‌ها: از «همهٔ شناسه‌ها + یک کوئری متا برای هرکدام» به یک `GROUP BY`. روی ۵۰ هزار تیکت یعنی ۵۰ هزار کوئری کمتر.
- میانگین امتیاز پشتیبان: از همان الگو به یک کوئری تجمیعی با کش پنج‌دقیقه‌ای — این یکی داخل حلقهٔ پشتیبان‌ها صدا زده می‌شد.
- مهاجرت وضعیت‌های قدیمی: دسته‌ای ۲۰۰تایی روی cron به‌جای همه در یک درخواست.

## آزمون‌ها

سه مجموعه: `test-automations.php`، `test-tickets.php`، `audit.php`. هارنس وردپرس از نو نوشته شد؛ مهم‌ترین بخشش این است که `wp_insert_post` رویداد `transition_post_status` را صادر می‌کند — بدون آن، حلقهٔ تیکت اصلاً قابل بازتولید نبود و همین بود که اجازه داد باگ منتشر شود.

هر رفع با برگرداندن عمدی همان باگ آزموده شد. دو بررسی که در این آزمون گرفته نشدند بازنویسی شدند: یکی از آن‌ها اصلاً نمی‌توانست فعال شود.

# جارچی 1.18.6

رفع چهار ایراد گزارش‌شده در منوی وردپرس و ساید‌بار افزونه.

- **منوی نیتیو با هاور باز می‌شود.** استایل خود افزونه با `display: none !important` زیرمنوی وردپرس را روی هر دو ورودی «جارچی» و «ارتباط با کاربران» پنهان کرده بود؛ آن قانون حذف شد. هر دو ورودی از ابتدا ثبت شده بودند، فقط دیده نمی‌شدند.
- **ساید‌بار هر بخش مخصوص همان بخش است.** صفحهٔ «ارتباط با کاربران» با اسلاگ باز می‌شود و پارامتر `jarchi_view` ندارد، ولی `AdminShell::current()` فقط همان پارامتر را می‌خواند؛ نتیجه صفحه‌ای بدون شناسه بود و منوی انتشار نمایش داده می‌شد. حالا اسلاگ صفحه هم از همان نگاشت مسیرها ترجمه می‌شود. فهرست صفحات پشتیبانی که در سه جا تکرار شده بود (و از هم فاصله گرفته بود) به یک منبع واحد `AdminShell::SUPPORT_SCREENS` تبدیل شد.
- **در حالت جمع‌شده آیکون‌ها نمایش داده می‌شوند.** ریل جمع‌شده زیرمجموعه‌ها را کامل پنهان می‌کرد و چون کل درخت انتشار زیر یک گروه است، فقط یک آیکون باقی می‌ماند. حالا درخت مسطح می‌شود: عنوان گروه‌ها کنار می‌رود و هر مقصد آیکون خودش را نگه می‌دارد. رنگ خاکستریِ کم‌رنگ آیکون‌ها هم برداشته شد و رنگ اختصاصی تلگرام، بله و واتس‌اپ دست‌نخورده ماند.
- **تاگل باز و بستهٔ گروه‌ها کار می‌کند.** جمع‌شدن با `grid-template-rows: 0fr` انجام می‌شد، ولی این روش فقط ردیف‌های تعریف‌شده را اندازه می‌گیرد؛ آیتم‌ها مستقیم داخل گرید بودند، پس فقط اولین مورد جمع می‌شد. حالا فرزندان داخل یک عنصر واحد قرار می‌گیرند و کل گروه با هم باز و بسته می‌شود. انتخاب‌گر `is-open` هم به فرزند مستقیم محدود شد تا گروهِ بستهٔ داخلی همراه والدش باز نشود.

آزمون‌ها: چرخهٔ کامل ۶۶ درخواست بدون خطا، به‌علاوهٔ بررسی‌های تازه برای همین چهار مورد. هر بررسی با بازگرداندن عمدی همان باگ آزموده شد.

# 1.17.4

- Fixed admin-created ticket submissions so optional notification/push failures cannot abort ticket creation.
- Skipped optional remote webhook delivery when the webhook endpoint is not configured.
- Fixed the admin new-ticket user picker selected-user layout and details.
- Added branded Telegram, Bale and WhatsApp icons to the Jarchi sidebar/platform screens.

# Jarchi 1.17.2

- Merged the full 1.17.x Ticket/FAQ/Automation/Notification/Customer Hub/Elementor improvements onto the 1.9.7 dynamic-field branch.
- Preserved the 1.9.7 dynamic publication formatter: rendering metadata, field icons, prefixes, suffixes, ordering, labels, and dynamic field mapping UI.
- Retained the duplicate-bootstrap guard and guarded `wpep()` declaration to prevent fatal `Cannot redeclare wpep()` errors.
- Preserved the independent WordPress Ticket Center and Mini App Plan Entitlement architecture.

# Jarchi 1.17.0

- Added dedicated FAQ management and searchable FAQ before ticket submission.
- Added admin-created tickets with customer selection.
- Added horizontal admin ticket status chips with counts and icons.
- Added canned reply → FAQ promotion.
- Removed automatic admin theme mode; only Light/Dark are available.
- Applied Peyda/JarchiPeyda consistently across Jarchi admin UI.
- Improved sidebar active/hover states and icon reliability.
- Hardened Elementor Ticket Center rendering so widget-level colors/theme stay isolated from parent sections/editor styles.
- Added Elementor controls for ticket status filter colors.
- Preserved existing Ticket Center, notifications, automations, SLA and backend-independent WordPress support features.

# Jarchi 1.16.0

- Added WordPress-native Web Push notifications for ticket creation and support replies on desktop and mobile browsers.
- Added in-site notification center, unread badges and browser notification opt-in without Backend/Mini App dependency.
- Added automated ticket rules for registration, first login, completed WooCommerce orders and scheduled condition checks.
- Added one-time-per-user automation markers, delays, role/domain/profile/meta/order-total conditions and personalized placeholders.
- Added dedicated admin screens for ticket notifications and automated tickets.
- Preserved Ticket Center independence from the Jarchi Backend/Mini App.

# Jarchi 1.14.0

- Added local Ticket Operations: SLA monitoring, escalation alerts and agent performance analytics.
- Added dedicated SLA/Performance admin screen without introducing Mini App dependency to local ticketing.
- Clarified that Mini App is an optional client-admin control plane.
- Preserved existing Ticket Center, Elementor, SMS, WooCommerce, Announcement and Field Mapping functionality.

## 1.12.0
- Added a first-party Jarchi Customer Hub page for logged-in users.
- Added Elementor Customer Hub widget with content, color, layout and typography controls.
- Combined announcements, ticket center, unread counters and account overview into one front-end hub.
- Auto-creates `/jarchi-account/` and keeps shortcode compatibility.
## 1.11.0 – Premium Ticket Center & UX Hardening

- Ticket Center status filters now include per-user counts and clearer active states.
- Added remote canned-replies API for Mini App/Backend clients.
- Added remote ticket rating endpoint with ownership validation.
- Fixed frontend unread counter to include published ticket posts.
- Mini App can create customer tickets using the authenticated customer's email/phone mapping.
- Mini App Ticket Center redesigned with filter chips, search, new-ticket flow, canned replies, review/close/reopen actions, and 30-second unread refresh.
- Added remote category/department-aware ticket creation.
- Preserved existing webhook, SMS, Telegram/Bale, WooCommerce, Announcement, Field Mapping and Elementor capabilities.

## 1.10.0
- Premium ticket filter row with status icons, accents and counts.
- Ticket REST API now returns category filters and status/unread summaries.
- Richer ticket webhook payload includes customer contact metadata.
- Support navigation visual hierarchy refinements.

## 1.10.0
- Premium ticket center status filters with counts and improved visual states.
- Extended ticket REST filtering with category + status counts/unread metadata.
- Hardened backend ticket event payload with customer contact metadata.
- Refined Jarchi support navigation and visual hierarchy.

## 1.9.6 — Ticket Center API hardening

- Added secure remote ticket creation for the Jarchi backend/Admin Mini App.
- Added WordPress customer lookup, support unread counts, and admin mark-read endpoint.
- Added ticket filters for priority, department, and assigned agent.
- Hardened agent assignment to actual Jarchi support agents.
- Added admin-origin ticket notifications and audit-friendly metadata.
- Added sender typing for remote ticket messages.

## 1.7.15
- Ticket module no longer sends ticket events to the central webhook.
- Advertisement phone detection now falls back to extracting Iranian mobile numbers from the plain-text description, including Persian/Arabic numerals and common international formats.

# Changelog

## 1.18.0
- Reworked native Jarchi menu: only Jarchi and ارتباط با کاربران are visible.
- Centralized admin screen registration and removed competing submenu registrations.
- Added canonical Support admin slug with legacy ticket URL redirect.
- Hidden all detailed screens with stable hidden-page registration.


## 1.7.8
- Consolidated native WordPress navigation into Jarchi + ارتباط با کاربران.
- Reworked the internal sidebar hierarchy for publishing/configuration vs user communication.
- Added optional SMS.ir ticket-reply notifications with per-reply opt-in.
- Added ticket SMS settings and pattern mapping UI.

# Changelog

All notable changes to WP Event Publisher.

## 1.5.1 — the payload says what its fields mean

The plugin already sent every field an administrator mapped. It sent them
as bare keys and values, which left the receiving service guessing: a key
like `company_or_institution_name1` carries no hint that it should be
shown as "نام شرکت". The only ways out were a generic label on every line
or a hardcoded table of key-to-label guesses per category — one useless,
the other a maintenance liability that breaks the moment a site adds a
field.

Neither is necessary, because the answer already exists on the site where
the administrator typed it. This release transmits it.

### Added — `field_meta`

A new top-level block, keyed identically to `fields`, describing every
value transmitted:

```json
"fields":     { "fuel_type": "Diesel" },
"field_meta": {
  "fuel_type": {
    "label": "نوع سوخت", "order": 2, "visibility": "telegram",
    "format": "inline", "separator": "، ",
    "type": "select", "source": "jetengine", "storage_key": "fuel_type",
    "repeatable": false, "required": false,
    "choices": { "diesel": "Diesel", "petrol": "Petrol" },
    "meta": {}
  }
}
```

- **The label is the effective mapping label**, so a rename on the Field
  Mapping screen and a per-category override both reach the wire on the
  next publication, with nothing to rebuild and no cache to clear. When a
  field has no label of its own, the framework's label answers for it. A
  label is never derived from the key.
- **The order is the order fields were dragged into**, and `fields` is
  already in it — nothing is sorted alphabetically anywhere.
- **Structure comes from the provider that discovered the field**: its
  declared type, its source, its storage key, whether it repeats, whether
  it is required, and its full choice list, so a consumer can resolve a
  stored value to its display label itself.
- **`field_meta` describes exactly what `fields` carries and nothing
  else.** A field that is disabled, admin-only, hidden, or resolved to
  nothing is absent from both. The two are built in a single pass in
  `DynamicPayload::describe()` — one discovery, one resolution — and are
  reconciled after filtering, so no filter can make them disagree.
- Provider metadata is reduced to JSON-safe values before it travels; no
  PHP object ever reaches the payload, which matters because the HMAC
  signature is computed over the encoded bytes.

Two new filters: `wpep_mapped_field_meta` and `wpep_contract_field_meta`.

### Added — `author.phone`

The `author` block gains `phone`, read from the post author's **user
meta** over a fixed conventional key list — `billing_phone`, `phone`,
`user_phone`, `mobile`, `user_mobile`, `mobile_number`, `phone_number`,
`telephone`, `tel`, `contact_phone`, `whatsapp` — first plausible value
wins. `wpep_author_phone_meta_keys` adds a site's own key;
`wpep_author_phone` replaces the result outright.

What it deliberately does not do, because a wrong number published to a
channel is worse than no number:

- It does not read the message, the content, the title or any custom
  field. A number that appears in text is not a number anyone declared to
  be a phone number.
- It does not fuzzy-match key names, so `verification_code` is never
  mistaken for a phone key.
- **It never falls back to the user ID**, the login, or any other numeric
  user attribute. Those are identifiers that happen to be digits.
- A candidate must be 7–15 digits written only with digits, `+`, spaces
  and phone punctuation. Persian and Arabic-Indic digits are understood
  and transmitted as written.

When nothing qualifies, `author.phone` is `""`. That is the correct
answer, not a failure.

This is the author's own number. The existing top-level `phone` and
`listing.phone` are the contact number stored on the advertisement, and
are unchanged.

### Changed

- `contract_version` is now `1.2`. The change is purely additive: no field
  was removed, renamed or moved, and a consumer written against `1.1`
  keeps working with no change at all. A payload rebuilt from a snapshot
  taken by an older version is filled in, so every block is still always
  present.
- The plugin author is now ممد از تیم بایمر. Branding only — the plugin
  slug, text domain, PHP namespace, function prefixes, hooks, option
  names, database keys and REST routes are all untouched.

## 1.5.0 — from Telegram publisher to publishing platform

The plugin already knew how to find any field on any post type. It still
assumed there was one way to publish and one place to publish to. This
release removes both assumptions without changing what an existing site
does.

### Added — Profiles

**A profile is one complete publishing configuration**: which fields, under
what labels, in what order, rendered by which template, with which images, to
which destinations. It is the thing you name, duplicate, export and assign.

**Profiles inherit.** `Default → Cars → SUV → Luxury SUV`. A profile stores
**only what it overrides**, so "Luxury SUV" can say one thing about badges
and inherit forty field decisions from "Cars". Widening a decision at the top
is one edit rather than twenty. A chain that would loop back on itself is
refused with an explanation rather than hanging.

**Profiles are assigned to scopes** — a post type, or a post type and a
category. Resolution walks outwards from an advertisement's own deepest
category through its ancestors to the post type and takes the first
assignment it finds, so assigning "Cars" covers every category under it.

Two independent hierarchies, deliberately kept apart: inheritance merges
*configuration*, assignment picks *which profile*. Neither has to know about
the other.

Deleting a profile re-parents its children onto its own parent and clears any
assignment that pointed at it, so a deletion can never leave a dangling
reference.

A **Profiles** screen creates, renames, duplicates, deletes, exports,
imports and assigns them. Export carries the whole ancestry, so an import on
another site lands complete; a dangling parent is repaired and reported.
*(`class-profile.php`, `class-profile-repository.php`, `admin/views/profiles.php`)*

### Added — a Rule Engine

Rules run in order before every publication and decide what happens: which
profile, which template, which destinations, whether to publish at all.

**Conditions** cover category, subcategory, parent category, any taxonomy,
tags, post type, status, ID, title, author, author role, any custom field as
text/number/yes-no, price, image count, gallery count, word count, date, time
and weekday — with sixteen operators, AND/OR groups and nesting.

A select compares against the label you see (`Diesel`, not `diesel`), and a
price written `۲٬۵۰۰٬۰۰۰٬۰۰۰ تومان` compares as a number.

Pattern matching is `*` and `?`, **not** a regular expression: an
administrator types these into a text box, and a malformed expression there
would be a denial of service on every publication.

**Actions**: use profile, use template, send only to, also send to, add text
before/after, replace text, show field, hide field, limit images, send no
images, delay publishing, do not publish, stop processing, continue
processing. Rules are drag-reorderable.

**Rules never act.** They accumulate decisions in a `RuleOutcome` and the
publisher acts on the result. That is what makes the **Rule Tester** able to
show, for any advertisement, every rule that matched and every one that did
not *and why*, the profile that won and its chain, the fields, the
destinations with their delays, the final message and the final payload —
without sending anything. It is also why every delivery can log why it went
where it went.

A condition that cannot be evaluated is traced as "not matched" and
publication continues.
*(`class-rule.php`, `class-rule-context.php`, `class-rule-engine.php`,
`class-rule-outcome.php`, `admin/views/rules.php`)*

### Added — an automation and publishing platform

**Message generation is now separate from delivery.** The plugin builds one
normalized `Publication` — message, payload, images, fields, profile, rule
decisions — and hands the identical object to every destination. Discord and
Telegram cannot drift apart, because neither of them builds anything.

**Destination providers** implement one interface: `initialize`, `validate`,
`send`, `settings_schema`, and `supports_images` / `supports_gallery` /
`supports_formatting` / `supports_buttons` / `supports_scheduling`. Five
ship:

| Provider | Notes |
| --- | --- |
| **Telegram Publisher** | The default; the existing Node.js webhook, unchanged |
| **Generic webhook** | Any endpoint, optionally HMAC-signed |
| **Discord** | Rich embeds with the mapped fields as columns |
| **Slack** | Block Kit, always with a plain-text fallback |
| **E-mail** | `wp_mail()`, HTML or plain text |

**A provider is a kind of service; a destination is one configured instance
of it.** Five Telegram channels are five destinations sharing one adapter,
each with its own template, image limit and delay.

**Adding a service never requires touching the core plugin.** Register an
adapter with `wpep_delivery_providers` and the Destinations screen builds its
settings form from the adapter's own schema — no admin code. WhatsApp, Teams,
a CRM or an internal queue are each one class.

**Scheduling**: immediately, 5 or 30 minutes, an hour, tomorrow, or a custom
delay, on WP-Cron. A delayed publication is **rebuilt when it is finally
sent**, so an edit during the wait goes out corrected and a deletion cancels
it.

Every delivery logs the destination, provider, profile, matched rules, image
count, response code and duration.
*(`interface-delivery-provider.php`, `class-publication.php`,
`class-base-delivery-provider.php`, the five adapters,
`class-destination-registry.php`, `class-publisher.php`,
`admin/views/destinations.php`)*

### Improved — Field Mapping

- Field groups **collapse**, each with a count, **Select all** and **Select
  none**.
- A field a framework added since you last looked is badged **NEW** and left
  switched off — the plugin never enables something behind your back.
- **Favourites**: star a field to pin it to the top. Stored per profile.
- **Live preview**: the message re-renders as you change the template, the
  order, what is enabled, or a visibility.

### Improved — error handling

Everything in boot is wrapped: an unexpected failure becomes an admin notice
naming the message, file and line, and WordPress carries on. A publishing
plugin must never be the reason an administrator cannot reach their own
dashboard.

A provider that throws during discovery costs its own fields. An adapter that
throws becomes a failed, retryable delivery. A template that throws falls
back to title and permalink and logs why.

### Fixed

- **`WordPressProvider` could not be autoloaded.** The autoloader splits a
  class name on capitals, so `WordPressProvider` resolved to
  `class-word-press-provider.php` while the file was
  `class-wordpress-provider.php`. On a real installation that was a fatal on
  the first discovery; the 1.4.0 test harness never caught it because it
  `require`s every file directly and bypasses the autoloader. The class is
  now `CoreProvider` in `class-core-provider.php`. **Its provider id is still
  `wordpress`, so no stored mapping, profile or field data changed.** A
  release check now walks every declared class through the autoloader's exact
  algorithm.
- **`Profile` read an undefined index** building its formatting defaults: the
  `?? 'none'` fallback satisfied the `in_array()` guard, which then read the
  absent key. Found by the new harness.

### Compatibility

**Nothing was removed and nothing changes on upgrade.** Every flat field and
every block the payload carried before is still carried. A site with no
profile, no rule and no destination resolves the generated default, evaluates
nothing, and posts the same payload to the same endpoint through the same
transport as 1.4.0.

`Migrator::to_1_5_0()` creates a **Default profile** from the field mapping
the site already had and one **primary destination** with no configuration of
its own, so it publishes to the endpoint in Settings. It creates **no rules**:
a site with no rules publishes everything, which is the pre-1.5.0 behaviour,
and a default "publish everything" rule would be a no-op that only makes the
screen look busier.

## 1.4.0 — the plugin stops knowing what an advertisement is

Until now the plugin had opinions: an advertisement has a price, a location,
a phone number, and those live under one of a list of meta keys it shipped
with. That works until a site sells something the list never anticipated —
a job with a salary and an experience requirement, a property with an area
and a floor count.

This release removes the opinion. The plugin discovers what a post type
actually has and lets the administrator decide what any of it means.

### Added

**Field discovery.** Selecting a post type scans it and lists every field it
has: native post fields, every meta key the type actually uses (from one
grouped query, not a guess), every registered taxonomy, and images. Each
field is reported with a label, its storage key, a type, whether it repeats,
whether it is required, and a sample value read from a real post.

**A provider architecture.** Discovery is the sum of what the registered
providers report, behind one five-method interface. Eight ship:
`WordPressProvider`, `MetaProvider`, `TaxonomyProvider`, `ImageProvider`,
`JetEngineProvider`, `AcfProvider`, `MetaBoxProvider`, `PodsProvider`.

**None of the frameworks is a dependency**, JetEngine least of all. Each
optional provider reports itself unavailable when its plugin is absent and
contributes nothing; the generic meta scan finds the same data regardless.
When a framework *is* present its description wins — real label, declared
type, actual choice list — and the key is listed once, not twice.
Deactivating a framework later does not lose the field: the value is still
in post meta, so it keeps resolving under a generated label.
*(`includes/interface-field-provider.php`, `includes/class-base-provider.php`,
and the eight provider classes)*

**Per-category field mappings, with inheritance.** A mapping belongs to a
scope: a post type, or a post type and a term. Resolution walks from the
post's deepest term outwards through its ancestors to the post type, and the
first scope with an opinion about a field wins. "Cars → SUV" can add
`drivetrain` without repeating what "Cars" already said, and editing "Cars"
reaches every category under it. A subcategory stores only what it changes.
*(`includes/class-field-mapping.php`)*

**A Field Mapping screen.** Post type, category and subcategory selectors; a
table grouped by provider; per field an enable toggle, an editable label, a
visibility, a list format, and drag-and-drop ordering that drives both the
message and the payload. Search filters on label, key, storage key and source
at once, and the bulk actions apply to whatever the filter is showing.
*(`includes/class-field-mapping-admin.php`, `admin/views/field-mapping.php`,
`admin/js/field-mapping.js`)*

**Four visibilities**, because "send it" and "print it" are different
questions: visible in Telegram, send to backend only, visible in admin only
(never transmitted), and hidden.

**A message template builder.** `{{field}}` prints a field,
`{{#if field}}…{{/if}}` keeps its block only when there is a value, and
`{{#unless}}` is its inverse. Every mapped field is automatically a
placeholder, listed beside the editor and inserted at the cursor on click.
Templates inherit per category, so cars, real estate and jobs each get their
own. Preview renders the template you are looking at — saved or not —
against a real advertisement of the selected category.

That is the entire language. A template is content stored in an option and
rendered in a background request, so it must never be able to run anything:
there is no loop, no expression and no function call, `<?php` and
`[shortcode]` stay literal, and a field value that contains `{{price}}` is
printed rather than expanded. A line whose placeholders all came out empty
is removed along with any punctuation stranded on it.
*(`includes/class-message-template.php`)*

**Repeaters, selects and lists resolve properly.** JetEngine repeaters, ACF
repeaters, Meta Box cloneable fields and plain nested arrays all become rows
with named columns, formatted as an inline list, bullets, numbers or one per
line, with a configurable separator. Select and checkbox fields are resolved
to their **labels**: a stored `diesel` is published as "Diesel", including
inside a repeater column.
*(`includes/class-field-resolver.php`)*

**Taxonomies carry their hierarchy.** Each term is described with its slug,
parent, ancestors, children and full path, and a hierarchical taxonomy also
produces derived `_top`, `_leaf` and `_path` fields, so a template can print
"Cars › SUV › Compact SUV" without the site storing that anywhere.
*(`includes/class-taxonomy-provider.php`)*

**A dynamic payload.** Advertisements now carry a `fields` object containing
exactly the enabled fields whose visibility transmits them, keyed by the same
names the template uses, with values keeping their shape. The `taxonomy`
block gained `category`, `subcategory`, `term` and `path`, resolved once so
the consumer does not have to walk the tree. A `message` field carries what
the template produced; empty means no template applied.
*(`includes/class-dynamic-payload.php`, `includes/class-contract.php`)*

### Performance

Discovery is cached under a key that includes a signature from every
provider, so activating ACF, editing a JetEngine meta box, updating a plugin
or deactivating Meta Box rebuilds the list on its own — nobody has to clear a
cache. It is also flushed on activation, on settings save, on the plugin
activation and upgrade hooks, and on demand from the screen. Delivering an
advertisement reads meta and never scans, and each field is read at most once
per delivery even though the payload builder and the message renderer both
use it.

### Compatibility

**Nothing was removed from the payload.** Every flat field and every block
the plugin sent before this release is still sent, unchanged. `taxonomy`
gained keys and lost none. An existing Node.js consumer needs no change.

A post type with no stored mapping falls back to a generated default that
reproduces exactly what the site was already sending, so an upgrade changes
nothing downstream until somebody opens the screen and decides otherwise.

### Migration

`Migrator::to_1_4_0()` writes no data. It drops the discovery cache, because
the providers that fill it did not exist a moment ago, and logs one line
explaining where the new screen is. There is no schema change and no setting
is rewritten.

## 1.3.2 — production hardening, same architecture

1.3.1 delivers advertisements correctly, so nothing about how it delivers
them was changed: same hook router, same durable queue, same inline-plus-cron
dispatch, same payload. This release closes three gaps found by walking the
editing paths that had never been exercised, and answers the two questions an
administrator asks when something looks wrong.

### Fixed

**Internal post types could be watched.** Automatic detection excluded
`attachment` and nothing else, and manual selection excluded nothing at all.
A site that ticked the wrong box — or ran automatic detection with a plugin
that registers a public internal type — could emit events for menu items,
navigation posts, reusable blocks, templates, revisions or attachment
updates. `Settings::EXCLUDED_POST_TYPES` now removes `attachment`,
`revision`, `nav_menu_item`, `custom_css`, `customize_changeset`,
`oembed_cache`, `user_request`, `wp_block`, `wp_template`,
`wp_template_part`, `wp_global_styles`, `wp_navigation`, `wp_font_family`,
`wp_font_face`, `patterns_ai_data` and the two Action Scheduler types in
**every** mode, and the `wpep_excluded_post_types` filter adjusts the list.
*(`includes/class-settings.php`)*

**Editing an old advertisement announced it as new.** The 1.3.0 safety net
announces a published advertisement the plugin has never sent — the case
where a listing went live while the plugin was disabled. It had no lower
bound, so on a site with a back catalogue, Quick Edit or Bulk Edit on old
listings would announce them one after another. The net is now bounded by
`wpep_installed_at`, recorded at activation and at upgrade: only content
published from that moment onwards is eligible, everything older is treated
as back catalogue and logged as `detect.pre_install`. Tools → Send One
Advertisement Now still sends an older listing deliberately, and the
`wpep_backfill_cutoff` filter moves or removes the line.
*(`includes/class-event-detector.php`, `includes/class-migrator.php`)*

**Bulk publishing chained its HTTP requests onto one page load.** Every
event detected in a request registered its own inline delivery on `shutdown`.
Publishing fifty advertisements through Bulk Edit therefore performed fifty
serial round trips to the Node.js service in a single PHP process — the shape
of a bulk action that hits `max_execution_time` and takes its last events
down with it. A request now delivers at most three advertisements itself;
anything beyond that stays in the queue and is delivered by the scheduled
cron job or the sweeper moments later. Nothing is dropped and nothing is
duplicated: the queue row and the event identifier are the same either way.
The `wpep_inline_batch_limit` filter raises, lowers or removes the cap.
*(`includes/class-dispatcher.php`)*

### Added

**Lifetime delivery counters.** The queue table only keeps terminal rows for
the retention window, so it cannot answer "how many advertisements has this
site delivered". A single option now records total successful deliveries,
total failed deliveries, the last success, the last failure, the last HTTP
status code and the moment it arrived. The Diagnostics screen shows them next
to the configured webhook URL. A delivery that is about to be retried updates
the last status code but is not counted as a failure; only terminal outcomes
are. Nothing secret is stored: the webhook secret only ever travels in a
request header and never appears in the counters, the logs or the page source.
*(`includes/class-dispatcher.php`, `includes/class-diagnostics.php`,
`admin/views/diagnostics.php`)*

### Migration

`Migrator::to_1_3_2()` writes `wpep_installed_at` if it is absent and logs
what that means for existing content. There is no schema change, no setting
is rewritten, and an installation that upgrades keeps publishing without any
manual step. Downgrading to 1.3.1 leaves two unused options behind and is
otherwise safe.

## 1.3.1 — the reason a real publish failed while every test passed

Reported after 1.3.0: the connection test works, a manual `wp_remote_post()`
works, but publishing a real advertisement still does not reliably reach the
service — "especially with custom post types / JetEngine / Gutenberg".

That asymmetry was the clue, and it pointed at exactly one line.

### Fixed

**The payload builder ran `the_content` in a background request.**
`Normalizer::normalize()` built the `content` field with
`apply_filters( 'the_content', … )`. That is fine inside the loop on a page
render. It is not fine where this code actually runs:

- on `shutdown`, **after `fastcgi_finish_request()`** — the browser already
  received "Published", so anything that happens next is invisible;
- with **no loop context** — no `setup_postdata()`, no reliable global `$post`;
- with **every third-party content filter attached** — page builders render
  whole documents on `the_content`, JetEngine listings run nested queries,
  and several plugins simply assume they are inside the loop.

A filter that fataled, recursed or exceeded the execution limit there took
the delivery down with it, silently, before `wp_remote_post()` was ever
reached. The connection test never touches the normalizer — which is
precisely why it passed while real publications did not, on exactly the
sites with the heaviest content filters.

`the_content` is no longer applied. The raw content travels in
`post.content`, the plain-text `description` the Node.js publisher actually
reads is unchanged, and a site that wants the rendered HTML can opt in with
the `wpep_render_the_content` filter — wrapped in a `try`/`catch` so a broken
filter costs the HTML rather than the advertisement. `get_post_galleries()`,
which runs `do_shortcode()` internally, is contained the same way.
*(`includes/class-normalizer.php`)*

**A delivery that killed the process was retried forever.**
Fallout from the same class of failure: a fatal, a memory limit or an
execution timeout never reaches the failure handler, so nothing counted the
attempt and nothing retired the event — it was reserved, recovered, and
reserved again every five minutes indefinitely. The queue claim now counts
the attempt, and the sweeper retires anything past its budget with an
explanation. *(`includes/class-queue.php`, `includes/class-dispatcher.php`)*

### Changed

- The sweeper's "is there work?" check is an autoloaded flag instead of a
  `COUNT(*)`, so a quiet queue costs no query on front-end page views.

### Migration

Automatic and free of schema changes: the work flag is re-derived from the
queue, so an upgrade with events in flight leaves nothing unattended.

## 1.3.0 — the queue became durable, and one hook became nine

Field report: publishing does not *always* trigger delivery, and the
behaviour differs between installations. The endpoint, DNS, TLS, Nginx,
Node.js and Telegram were all verified healthy, and manual
`wp_remote_post()` calls worked, so the fault was inside the plugin.

Two architectural causes, both install-dependent — which is exactly why it
looked intermittent.

### Fixed

**1. The queue lived in transients, and transients are not storage.**
Until now an in-flight event was a transient plus an index option. On a
plain installation transients are database rows and everything works. On a
real one with a persistent object cache — Redis, Memcached, a hosting
layer — a transient is a *cache entry*: it is evicted under memory
pressure, dropped by a cache flush and lost when the cache restarts. An
advertisement queued a second before any of those disappeared silently,
with nothing left to sweep and nothing to report. That is the whole
signature of the report: same code, different outcome per site.

Version 1.3.0 gives the queue its own table (`{prefix}wpep_queue`). A
queued event now survives page reloads, cache flushes, object cache
restarts and PHP fatals. Concurrency is handled by an atomic claim: a
worker flips rows from `pending` to `reserved` with its own token in one
conditional `UPDATE`, then reads back only what it owns, so a cron run, an
inline dispatch and a manual "process queue" can all run at the same
moment without sending anything twice. Abandoned claims — a killed FPM
child, a deploy mid-delivery — are recovered after five minutes instead of
being stuck forever. *(`includes/class-queue.php`)*

**2. Delivery depended on the hooks one plugin happens to fire.**
`transition_post_status` and `wp_after_insert_post` cover the standard
editor. They do not cover every path a JetEngine form, an importer, a REST
client or `wp_update_post()` can take. A new router now subscribes to all
of them — the generic transition, the `draft_to_publish` /
`pending_to_publish` / `future_to_publish` / `new_to_publish` /
`private_to_publish` / `auto-draft_to_publish` aliases, `wp_after_insert_post`,
`post_updated`, `save_post`, `wp_trash_post`, `before_delete_post` and
`untrashed_post` — logs which one fired, and funnels all of them into one
decision point. Firing five times for one publication is expected: the
idempotency claim collapses them into a single event.
*(`includes/class-hook-router.php`)*

Fixing that surfaced a duplicate-guard bug the new tests caught: the guard
was keyed on the *derived* event type, so an alias hook that ran after the
first hook marked the post published reclassified the same publication as
`updated` and slipped through as a second event. The guard is now keyed on
the logical publication, with separate groups for removal and restoration.

### Added

- **Retry policy by outcome.** 401, 403, 404, 405, 409, 410, 413 and 422
  are never retried — repeating a rejected credential produces four more
  rejections and buries the real problem. 408, 423, 425, 429, 5xx and
  every transport failure are retried with exponential backoff plus
  jitter, honouring `Retry-After` when the service sends it.
  *(`includes/class-retry-policy.php`)*
- **Failures explained in words.** Every failure is classified —
  authentication, not found, rejected, rate limited, server, timeout, DNS,
  TLS, connection — and the log says what it means and what to do, instead
  of `cURL error 28`.
- **Diagnostics screen.** Checks configuration, webhook URL,
  authentication, post types, hook attachment, queue health, scheduling,
  DNS resolution, the service health endpoint and a real authenticated
  webhook request — in the order a publication travels them, so the first
  red row is the thing to fix. Also lists every registered post type with
  its published count and whether it is watched.
  *(`includes/class-diagnostics.php`)*
- **Automatic post type discovery.** A new Post Type Detection setting
  watches every public post type, whichever plugin registered it
  (JetEngine, ACF, CPT UI, WooCommerce, a theme or core), so a post type
  added later needs no visit to the settings screen. Manual selections are
  always kept on top.
- **A safety net for advertisements published while the plugin was blind.**
  If a post is live but was never announced — published while the plugin
  was disabled, misconfigured, or before its post type was enabled — the
  next save announces it once.
- **Restore handling.** Restoring from the trash re-announces the listing
  and re-arms its deletion event.
- **Field resolution across frameworks.** One resolver with ordered
  fallback chains per logical field: administrator mapping → the
  conventions of WooCommerce / JetEngine / ACF / common themes → fuzzy key
  matching → empty. Galleries understand comma-separated ID lists,
  arrays of IDs, arrays of attachment arrays and direct URLs.
  *(`includes/class-field-map.php`)*
- **Separate connection timeout**, so an unreachable host fails fast and
  recognisably instead of consuming the whole request budget.
- **Custom request headers** for a backend that needs one this plugin does
  not send.
- Persian translation extended to 421 strings, including every new screen,
  check and failure explanation.

### Changed

- `EventStore` is now a thin facade over the queue. It still works — it is
  public API — but holds no data.
- `Dispatcher::store()` became `Dispatcher::storage()` and returns the
  queue. `Hooks::register()` is deprecated in favour of the router.
- The sweeper claims only events that are already overdue by a grace
  period, so it rescues stragglers instead of racing the primary path.

### Migration

Automatic. The queue table is created on upgrade and any event still held
in the old transient store is carried across, so upgrading while
advertisements are in flight does not drop them. Settings, logs, delivery
history and post meta are untouched.

## 1.2.1 — the timeout that looked like an unreachable endpoint, and a Persian admin

Field report from 1.2.0: the Connection Test failed with
`cURL error 28: Operation timed out after 3002 milliseconds with 0 bytes
received`, while a standalone `wp_remote_post()` script hitting the very same
URL answered HTTP 200 in 0.299 s. DNS, TLS, Nginx, Node.js and `/webhook` were
all verified healthy, so the failure was in the request WordPress built, not in
the network.

### Fixed

**1. The request was not using the timeout the plugin asked for.**
`3002 ms` is cURL being given a 3 second budget — 1.2.0 configures 15. Two
things could produce that, and both are now handled:

- **Another plugin shortening the request.** WordPress runs every outgoing
  request through `http_request_args` *after* the caller has built its
  arguments, so a security or performance plugin can silently rewrite
  `timeout` to 3. The transport now re-asserts its own budget at
  `PHP_INT_MAX` priority, for the configured endpoint only, and reads the
  final value back through `http_api_debug`. If something still shortened the
  request, the log says so by name: *"Another plugin shortened this request to
  3 s despite the configured 15 s; that is the cause, not the endpoint."*
- **A too-small configured value.** The minimum accepted timeout rose from 1
  to 5 seconds, the upgrade raises any stored value below 10 to 15, and the
  configuration validator flags a short timeout with the exact cURL error it
  causes.

  Because the connection test and real deliveries share one transport, this
  fixes both at once — a marginal 3 second budget is exactly the shape of
  "sometimes Node.js receives nothing".

**2. Narrowing the authentication style could lock the plugin out.**
The backend authenticates on `X-Webhook-Secret` and answers *"Missing webhook
authentication"* without it, but 1.2.0 only sent that header for the `all` and
`api_key` styles. It is now sent with every style whenever a secret is
configured. An empty secret is also called out in the admin notice, since the
backend rejects every request without one.

**3. A failed test could not distinguish "host unreachable" from "request
rejected".** When the webhook POST fails, the Connection Test now also probes
`/health` on the same origin (same scheme, host and port as the configured
endpoint — no caller-supplied URL is ever fetched) and reports which side the
problem is on.

### Added

- `phone` in the payload, at the top level and in the `listing` block, resolved
  from mapped meta keys first and then by field-name detection (`phone`,
  `mobile`, `tel`, `whatsapp`, …). New **Phone Meta Keys** setting.
- Request duration in every delivery log line, plus the timeout actually used,
  so a slow endpoint and a clamped request are no longer indistinguishable.
- **Persian (Farsi) admin UI with RTL layout.** The plugin ships a complete
  `fa_IR` translation (332 strings: menus, settings, tools, logs, dashboard,
  about, notices, validation messages and every lifecycle log message) plus a
  scoped RTL stylesheet. Technical values — hook names, HTTP headers, JSON
  keys, event types — deliberately stay in Latin script, because they are
  values you match against the Node.js service.
- **Admin Language** setting: Persian (default), English, or follow the
  WordPress language. It applies to this plugin's screens only, so a Persian
  plugin UI works on an English admin and vice versa.

### Changed

- Minimum webhook timeout 1 → 5 seconds; the settings field documents why.
- `X-Webhook-Secret` is documented as the primary credential for this backend.
- Translation template (`languages/wp-event-publisher.pot`) regenerated.

### Migration

Automatic. A stored webhook timeout below 10 seconds is raised to 15 and the
change is written to the log; `phone_meta_keys` and `admin_locale` are seeded.
Nothing else is touched: settings, logs, delivery history and post meta are
preserved.

## 1.2.0 — advertisement publishing actually reaches Telegram

This release fixes the reported problem: the Connection Test succeeded while
publishing a real advertisement produced nothing on the Node.js side. There
were four independent causes, all of them upstream of `wp_remote_post()`.

### Fixed

**1. The payload did not match what the Node.js publisher reads.**
Version 1.1.0 sent a nested envelope only (`post.title`, `media.gallery`, …).
The backend reads flat fields (`title`, `description`, `price`, `location`,
`url`, `images`, `post_id`) — the same shape as the manual `curl` test that
worked. The payload now carries **both**: the flat advertisement fields at the
top level *and* the 1.1.0 blocks, built from the same data so they cannot
disagree. Nothing was removed, so existing consumers keep working.
*(`includes/class-contract.php`)*

**2. Delivery depended on WP-Cron, with no way to notice it never ran.**
An event was scheduled with `wp_schedule_single_event()` and then forgotten.
If cron was disabled, blocked or simply never triggered, the event sat in a
transient until it expired — silently. Now:

- Automatic dispatch mode delivers at the end of the publish request (after
  `fastcgi_finish_request()`, so the editor never waits), and keeps the cron
  job only as a backstop.
- A sweeper (`wpep_sweep_queue`, every five minutes, plus a throttled check on
  every request) re-runs any event whose scheduled moment passed.
- A completion marker, a per-attempt lock and `wp_clear_scheduled_hook()`
  guarantee a late cron tick can never deliver the same event twice.
- Scheduling failures are logged instead of being discarded.
*(`includes/class-dispatcher.php`, `includes/class-event-store.php`)*

**3. Advertisement custom post types could not be selected.**
The settings screen listed only `public => true` post types, and the sanitizer
silently dropped any slug that was not registered at save time — so a
classifieds CPT could be ticked and lost. The screen now lists every post type
with an editing UI plus every non-built-in type (with published counts to help
identify the right one), and a valid slug is preserved even when the CPT is
registered later than the options screen runs.
*(`includes/class-validator.php`, `admin/views/settings.php`)*

**4. Nothing told you why an event was not created.**
`Enable Plugin` gates event detection but not the Connection Test, so the test
button was green while every publish was ignored. Skips are now logged with the
exact reason ("the post type X is not enabled. Enabled post types: …", "the
plugin is disabled in Settings"), an admin notice names the specific blockers,
and the Connection Test reports configuration problems alongside the HTTP
result instead of a bare success.
*(`includes/class-event-detector.php`, `includes/class-admin.php`)*

### Added

- **Lifecycle logging.** Every step is a log row with a stage name:
  `hook.transition`, `detect.matched`, `detect.skipped`, `event.queued`,
  `cron.scheduled`, `cron.schedule_failed`, `dispatch.inline`,
  `dispatch.started`, `webhook.sending`, `webhook.response`, `delivery.retry`,
  `delivery.exhausted`, `queue.swept`. New `stage`, `attempt` and `message`
  columns are added by `dbDelta()`; existing rows are preserved.
- **Debug Mode.** Records the complete lifecycle including every hook that
  fired and every decision not to act; mirrors to `debug.log` when
  `WP_DEBUG_LOG` is on. Secrets are redacted before anything is written.
- **New settings:** Event Types, Dispatch Mode (Automatic / Immediate /
  WP-Cron only), Authentication Style, Trash Handling, Debug Mode, Price /
  Location / Image meta key mapping, Description Source and Maximum Images.
- **New tools:** "Send One Advertisement Now" (builds the real payload for a
  post ID and reports the HTTP status synchronously), "Process Queue Now", and
  a Pipeline Status panel showing the endpoint, enabled post types, queue
  depth and cron health.
- **Authentication aliases.** Alongside `X-Signature` / `X-API-Key`, requests
  now carry `X-Hub-Signature-256` (body-only digest), `X-Webhook-Secret`,
  `Authorization: Bearer` and `X-Idempotency-Key`, so the backend can verify
  with whichever scheme it already implements. Authentication was not weakened
  and cannot be turned off; the Connection Test uses the identical headers.
- **Better advertisement data.** `description` is plain UTF-8 text with block
  markup and shortcodes removed (the untouched HTML stays in `post.content`);
  `price` resolves through mapped meta keys → WooCommerce → fuzzy matching;
  `location` adds geographic taxonomies as a fallback; `images` collects the
  featured image, gallery blocks, `[gallery]` shortcodes, WooCommerce
  galleries, mapped meta fields, attached images and content `<img>` tags,
  normalized to absolute HTTPS URLs and capped by a setting.
- **Duplicate prevention.** One publish creates exactly one event even when
  `transition_post_status` and `wp_after_insert_post` both fire, and trashing
  followed by permanent deletion produces a single `deleted` event.
- **Optional trash handling.** Moving an advertisement to the trash can be
  treated as a deletion (off by default).
- **SSRF guard.** Link-local and cloud metadata hosts are refused as webhook
  endpoints.

### Changed

- The webhook URL defaults to `https://bot.iran-exim.ir/webhook`, and an
  upgraded installation with an empty URL is pointed at it. A configured URL
  is never overwritten.
- `Enable Plugin` defaults to on for fresh installations.
- Default webhook timeout raised from 10 to 15 seconds.
- Contract version is now `1.1` (additive: flat fields added, nothing removed).
- The REST `/status` endpoint reports queue depth, dispatch mode, debug mode
  and cron availability; `/logs` accepts a `stage` filter.

### Migration

Automatic on upgrade, no manual step. Settings, logs, delivery history and
post meta are preserved; the log table gains three columns; missing settings
are seeded with their defaults. Review **Settings → Allowed Post Types** and
**Event Types** after updating.

## 1.1.0

- Added the versioned webhook contract: `event_id`, `event_type`, `timestamp`,
  `site`, `post`, `author`, `listing`, `media` and `taxonomy` blocks.
- Added `created`, `updated` and `deleted` lifecycle detection with content
  fingerprinting and duplicate suppression.
- Added stable event identifiers that survive retries.
- Added HMAC-SHA256 request signing over the raw body.
- Added the Site ID and Webhook Signature Tolerance settings.
- Added `event_id`, `event_type` and `site_id` to the log table, filters, CSV
  export and REST endpoints.
- Extracted detection, identifiers, contract building, signing and retry
  orchestration into dedicated classes.

## 1.0.0

- Initial release: event detection, asynchronous webhook dispatch with
  retries, normalizer, custom log table, admin dashboard, REST API, tools.

## 1.15.0
- Clarified and locked the architecture: local WordPress Ticket Center remains independent from Mini App/Backend.
- Remote Mini App capabilities are granted by the Backend plan entitlement system after successful payment; no manual activation is required in the plugin.

## 1.18.0
- Fixed the WordPress native Jarchi menu architecture: only `جارچی` and `ارتباط با کاربران` are visible in the native submenu.
- Kept all detailed Jarchi/Ticket screens registered under the canonical Jarchi parent so WordPress can resolve `admin.php?page=...` permissions correctly.
- Removed the separate top-level Ticket Center menu.
- Hid detailed native submenu entries with scoped CSS instead of removing them from WordPress's submenu registry, preventing the recurring "Sorry, you are not allowed to access this page" error.
- Preserved the internal Jarchi Sidebar as the sole detailed navigation.
