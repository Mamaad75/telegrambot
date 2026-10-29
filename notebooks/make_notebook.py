"""Generates the Colab notebook from the verified core."""
import json
from pathlib import Path

CORE = Path("core.py").read_text(encoding="utf-8")

# The core, minus its module docstring and imports — those go in their own cell.
body = CORE.split('from sklearn.preprocessing import StandardScaler\n', 1)[1].lstrip("\n")


def md(*lines):
    return {"cell_type": "markdown", "metadata": {}, "source": list(lines)}


def code(*lines):
    return {"cell_type": "code", "execution_count": None, "metadata": {},
            "outputs": [], "source": list(lines)}


cells = [
    md(
        "# بخش‌بندی مشتریان باهوش\n",
        "\n",
        "این نوت‌بوک سه کار می‌کند:\n",
        "\n",
        "1. بسته داده‌ای را که از افزونه دانلود کرده‌اید می‌خواند\n",
        "2. چند الگوریتم خوشه‌بندی را اجرا و با عدد مقایسه می‌کند\n",
        "3. فایل نتیجه را با برچسب‌های فارسی می‌سازد تا در افزونه بارگذاری کنید\n",
        "\n",
        "---\n",
        "\n",
        "**پیش از شروع، در وردپرس:**\n",
        "\n",
        "باهوش ← بخش‌بندی مشتریان ← دکمه **«دانلود بسته داده»**\n",
        "\n",
        "فایلی با نام `bahoosh-ml-export-۲۰۲۶۰۱۰۱-۱۲۰۰۰۰.json` می‌گیرید.\n",
        "\n",
        "> هیچ نام، ایمیل، تلفن یا آدرسی در آن بسته نیست. هویت هر مشتری پیش از\n",
        "> خروج با HMAC-SHA256 شبه‌نام شده است.\n",
        "\n",
        "**منوی بالا ← Runtime ← Run all** را بزنید و وقتی خواست، فایل را آپلود کنید."
    ),

    md("## ۰ — آماده‌سازی"),
    code(
        "# کولب همه اینها را دارد؛ این سلول فقط مطمئن می‌شود نسخه‌ها سازگارند.\n",
        "!pip install -q scikit-learn pandas matplotlib\n",
        "print('آماده')"
    ),
    code(
        "import json\n",
        "import math\n",
        "import uuid\n",
        "from datetime import datetime, timezone\n",
        "\n",
        "import matplotlib.pyplot as plt\n",
        "import numpy as np\n",
        "import pandas as pd\n",
        "from sklearn.cluster import DBSCAN, AgglomerativeClustering, KMeans\n",
        "from sklearn.metrics import (\n",
        "    calinski_harabasz_score,\n",
        "    davies_bouldin_score,\n",
        "    silhouette_score,\n",
        ")\n",
        "from sklearn.neighbors import NearestNeighbors\n",
        "from sklearn.preprocessing import StandardScaler\n",
        "\n",
        "pd.set_option('display.max_columns', 40)\n",
        "pd.set_option('display.width', 200)\n",
        "print('کتابخانه‌ها بارگذاری شد')"
    ),

    md(
        "## ۱ — توابع تحلیل\n",
        "\n",
        "این سلول فقط تعریف می‌کند و چیزی اجرا نمی‌کند. اگر خواستید منطق را عوض\n",
        "کنید، `build_features` و `_persian_name` دو جایی هستند که معمولاً تغییر\n",
        "می‌کنند."
    ),
    code(*[line + "\n" for line in body.rstrip().split("\n")]),

    md(
        "## ۲ — بسته داده را آپلود کنید\n",
        "\n",
        "همان فایلی که از افزونه دانلود کردید."
    ),
    code(
        "try:\n",
        "    from google.colab import files\n",
        "    uploaded = files.upload()\n",
        "    BUNDLE_PATH = next(iter(uploaded))\n",
        "except ImportError:\n",
        "    # خارج از کولب: مسیر فایل را دستی بگذارید.\n",
        "    BUNDLE_PATH = 'bahoosh-ml-export.json'\n",
        "\n",
        "bundle = load_bundle(BUNDLE_PATH)\n",
        "context = bundle.get('context', {})\n",
        "\n",
        "print(f\"فروشگاه     : {context.get('store_name', '—')}\")\n",
        "print(f\"واحد پول    : {context.get('currency', '—')}\")\n",
        "print(f\"نسخه افزونه : {context.get('plugin_version', '—')}\")\n",
        "print()\n",
        "for name in ('customers', 'orders', 'products', 'coupons', 'behaviors'):\n",
        "    print(f\"{name:<12}: {len(bundle.get(name, [])):>7,}\")"
    ),

    md(
        "## ۳ — ساخت ویژگی‌ها\n",
        "\n",
        "برای هر مشتری نُه عدد ساخته می‌شود. چهارتای اول همان RFM کلاسیک است؛\n",
        "پنج‌تای بعدی چیزی است که بسته باهوش دارد و RFM نمی‌بیند — مثل\n",
        "`discount_share` که «وابسته به تخفیف» را از «وفادار» جدا می‌کند."
    ),
    code(
        "df = build_features(bundle)\n",
        "\n",
        "if len(df) < 40:\n",
        "    print(f\"هشدار: فقط {len(df)} مشتریِ دارای خرید.\")\n",
        "    print('زیر حدود ۴۰ مشتری، هر خوشه‌بندی‌ای بیشتر نویز است تا الگو.')\n",
        "else:\n",
        "    print(f\"{len(df):,} مشتری با دست‌کم یک خرید\")\n",
        "\n",
        "df[FEATURES].describe().T[['mean', '50%', 'min', 'max']].round(2)"
    ),
    code(
        "# توزیع هر ویژگی. دنباله بلند طبیعی است و برای همین مقیاس‌دهی لگاریتمی داریم.\n",
        "fig, axes = plt.subplots(3, 3, figsize=(14, 9))\n",
        "for ax, name in zip(axes.ravel(), FEATURES):\n",
        "    ax.hist(df[name], bins=40, color='#7c5cff', edgecolor='white', linewidth=0.4)\n",
        "    ax.set_title(name, fontsize=10)\n",
        "    ax.tick_params(labelsize=8)\n",
        "fig.suptitle('Feature distributions', fontsize=13)\n",
        "fig.tight_layout()\n",
        "plt.show()"
    ),

    md(
        "## ۴ — مقایسه الگوریتم‌ها\n",
        "\n",
        "سه الگوریتم با تنظیم‌های مختلف اجرا و با شاخص یکسان داوری می‌شوند.\n",
        "\n",
        "**چرا accuracy و F1 اینجا نیست؟** چون خوشه‌بندی برچسب درست ندارد — هیچ‌کس\n",
        "نگفته مشتری شماره ۷ «باید» در کدام بخش باشد. آن متریک‌ها برای طبقه‌بندی\n",
        "نظارت‌شده‌اند. آنچه اینجا معنا دارد:\n",
        "\n",
        "| شاخص | جهت | چه می‌گوید |\n",
        "|---|---|---|\n",
        "| سیلوئت | بیشتر بهتر | هر نقطه به خوشه خودش نزدیک‌تر است یا به خوشه بغلی |\n",
        "| کالینسکی-هاراباز | بیشتر بهتر | نسبت پراکندگی بین‌خوشه‌ای به درون‌خوشه‌ای |\n",
        "| دیویس-بولدین | **کمتر** بهتر | شباهت هر خوشه به نزدیک‌ترین رقیبش |\n",
        "\n",
        "به اضافه دو جریمه که آماری نیستند، عملیاتی‌اند: بخشی که بیش از نیمی از\n",
        "فروشگاه را دارد بخش نیست، و دو خوشه‌ای که به یک نام می‌رسند تفکیکی‌اند که\n",
        "واژگان کسب‌وکار نمی‌تواند بیانش کند."
    ),
    code(
        "X = prepare_matrix(df)\n",
        "winner, table = compare_algorithms(X, df)\n",
        "\n",
        "print(f\"برنده: {winner.algorithm} با {winner.params}\\n\")\n",
        "table"
    ),

    md(
        "## ۵ — بخش‌ها با نام فارسی\n",
        "\n",
        "نام‌ها از روی **رفتار** گروه ساخته می‌شوند، نه از شماره خوشه. پس اگر\n",
        "الگوریتم عوض شود ولی گروه‌ها همان باشند، نام‌ها هم همان می‌مانند."
    ),
    code(
        "payload = build_payload(winner, df, table)\n",
        "\n",
        "segments = pd.DataFrame(payload['segments'])[[\n",
        "    'label', 'segment_key', 'customer_count', 'percentage',\n",
        "    'average_recency', 'average_frequency', 'average_aov', 'average_discount_share',\n",
        "]]\n",
        "segments.columns = ['بخش', 'کلید', 'تعداد', 'درصد', 'تازگی (روز)', 'تکرار', 'میانگین سبد', 'سهم تخفیف']\n",
        "segments"
    ),
    code(
        "for s in payload['segments']:\n",
        "    print(f\"■ {s['label']}  ({s['customer_count']} نفر، {s['percentage']}٪)\")\n",
        "    print(f\"   {s['characteristics']}\\n\")"
    ),
    code(
        "# نمودارها با کلید انگلیسی برچسب می‌خورند: فونت فارسی در کولب نصب نیست و\n",
        "# متن فارسی در نمودار وارونه و بدون اتصال حروف درمی‌آید. جدول بالا فارسی است.\n",
        "keys = [s['segment_key'] for s in payload['segments']]\n",
        "counts = [s['customer_count'] for s in payload['segments']]\n",
        "revenue = [s['total_revenue'] for s in payload['segments']]\n",
        "\n",
        "fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))\n",
        "palette = ['#7c5cff', '#41d6c3', '#34d399', '#fbbf24', '#fb7185', '#38bdf8', '#9d86ff', '#8b94ad']\n",
        "\n",
        "ax1.barh(keys, counts, color=palette[:len(keys)])\n",
        "ax1.set_title('Customers per segment')\n",
        "ax1.invert_yaxis()\n",
        "\n",
        "ax2.barh(keys, revenue, color=palette[:len(keys)])\n",
        "ax2.set_title('Historic revenue per segment')\n",
        "ax2.invert_yaxis()\n",
        "fig.tight_layout()\n",
        "plt.show()"
    ),
    code(
        "# هر مشتری یک نقطه: تازگی در برابر مبلغ، رنگ بر اساس بخش.\n",
        "assigned = {a['customer_key']: a['segment_key'] for a in payload['assignments']}\n",
        "plot_df = df[df['customer_key'].isin(assigned)].copy()\n",
        "plot_df['segment'] = plot_df['customer_key'].map(assigned)\n",
        "\n",
        "fig, ax = plt.subplots(figsize=(11, 6))\n",
        "for colour, (name, group) in zip(palette, plot_df.groupby('segment')):\n",
        "    ax.scatter(group['recency_days'], group['monetary'], s=22, alpha=0.65,\n",
        "               label=name, color=colour, edgecolors='none')\n",
        "ax.set_xlabel('Days since last order')\n",
        "ax.set_ylabel('Total spend')\n",
        "ax.set_yscale('log')\n",
        "ax.legend(fontsize=9)\n",
        "ax.set_title('Segments: recency vs spend')\n",
        "fig.tight_layout()\n",
        "plt.show()"
    ),

    md(
        "## ۶ — ساخت فایل نتیجه و دانلود"
    ),
    code(
        "OUT = 'bahoosh-segments-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M') + '.json'\n",
        "\n",
        "with open(OUT, 'w', encoding='utf-8') as fh:\n",
        "    json.dump(payload, fh, ensure_ascii=False)\n",
        "\n",
        "size = len(json.dumps(payload, ensure_ascii=False).encode())\n",
        "print(f\"{OUT}\")\n",
        "print(f\"{size:,} بایت  ({size / 1048576:.2f} مگابایت از سقف ۱۲ مگابایت)\")\n",
        "print(f\"{len(payload['segments'])} بخش، {len(payload['assignments'])} مشتری\")\n",
        "\n",
        "if size > 12 * 1024 * 1024:\n",
        "    print('\\nهشدار: بزرگ‌تر از سقف آپلود افزونه است.')\n",
        "\n",
        "try:\n",
        "    from google.colab import files\n",
        "    files.download(OUT)\n",
        "except ImportError:\n",
        "    print('\\n(خارج از کولب — فایل کنار همین نوت‌بوک ساخته شد.)')"
    ),

    md(
        "## ۷ — بارگذاری در افزونه\n",
        "\n",
        "وردپرس ← باهوش ← بخش‌بندی مشتریان ← **«بارگذاری فایل نتیجه»** ← همین فایل.\n",
        "\n",
        "بعد از آپلود، کارت‌های بخش‌بندی با همان نام‌های فارسی بالا ظاهر می‌شوند و\n",
        "می‌توانید برای هر بخش کد تخفیف یا کمپین بسازید.\n",
        "\n",
        "---\n",
        "\n",
        "### اگر خطا گرفتید\n",
        "\n",
        "| پیام | علت |\n",
        "|---|---|\n",
        "| این فایل JSON معتبر نیست | فایل ورودی را آپلود کرده‌اید، نه فایل نتیجه |\n",
        "| نتیجه روی داده ساختگی ساخته شده | `is_synthetic` در بسته ورودی `true` بوده |\n",
        "| فایل بزرگ‌تر از ۱۲ مگابایت است | فروشگاه خیلی بزرگ است؛ `insights.candidates` را حذف کنید |\n",
        "| هیچ بخشی در آن نبود | هیچ خوشه‌ای به حد نصاب ۱۰ نفر نرسید |\n",
        "\n",
        "### هر چند وقت یک‌بار؟\n",
        "\n",
        "ماهی یکی دو بار کافی است. بخش‌بندی با چند سفارش جدید عوض نمی‌شود، و هر\n",
        "بارگذاری یک `run_id` تازه می‌سازد که اجرای قبلی را دست‌نخورده نگه می‌دارد.\n",
        "\n",
        "### وقتی این مسیر دستی خسته‌کننده شد\n",
        "\n",
        "همین منطق را می‌شود روی یک سرور ایرانی گذاشت تا هر شش ساعت خودکار اجرا شود.\n",
        "آن‌وقت دیگر نه دانلودی لازم است نه آپلودی."
    ),
]

notebook = {
    "nbformat": 4,
    "nbformat_minor": 0,
    "metadata": {
        "colab": {"provenance": [], "toc_visible": True, "name": "bahoosh-segmentation.ipynb"},
        "kernelspec": {"name": "python3", "display_name": "Python 3"},
        "language_info": {"name": "python"},
    },
    "cells": cells,
}

Path("bahoosh-segmentation.ipynb").write_text(
    json.dumps(notebook, ensure_ascii=False, indent=1), encoding="utf-8"
)
print(f"نوشته شد: {len(cells)} سلول")
