"""
هسته تحلیل — همان کدی که در سلول‌های نوت‌بوک می‌نشیند.

اینجا جدا نگه داشته شده تا بشود آزمودش؛ نوت‌بوک نهایی همین توابع را دارد.
"""
from __future__ import annotations

import json
import math
import uuid
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN, AgglomerativeClustering, KMeans
from sklearn.metrics import (
    calinski_harabasz_score,
    davies_bouldin_score,
    silhouette_score,
)
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

MAX_NOISE_SHARE = 0.35
SILHOUETTE_SAMPLE = 5000


def min_segment_size(n: int) -> int:
    """
    کف اندازه یک بخش، متناسب با اندازه فروشگاه.

    کف ثابت ۱۰ روی فروشگاه کوچک نتیجه بدی می‌دهد: با ۵۴ مشتری، k=۲ یک خوشه
    ۵۰ نفره و یک خوشه ۴ نفره می‌سازد، خوشه کوچک حذف می‌شود و یک بخش ۹۳ درصدی
    می‌ماند که هیچ‌چیز به صاحب فروشگاه نمی‌گوید. کف باید با n حرکت کند.
    """
    return max(3, min(10, n // 12))

FEATURES = [
    "recency_days",       # چند روز از آخرین خرید
    "frequency",          # چند سفارش
    "monetary",           # مجموع پرداختی
    "avg_order_value",    # میانگین سبد
    "discount_share",     # چه سهمی از خریدش با تخفیف بوده
    "category_variety",   # از چند دسته خرید کرده
    "basket_size",        # میانگین تعداد قلم در سفارش
    "tenure_days",        # از اولین خرید تا امروز
    "order_regularity",   # نظم فاصله خریدها
]


# ------------------------------------------------------------------ خواندن

def load_bundle(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        bundle = json.load(fh)

    if bundle.get("format") != "bahoosh-ml-bundle":
        raise ValueError(
            "این فایل بسته خروجی باهوش نیست. از صفحه «بخش‌بندی مشتریان» "
            "دکمه «دانلود بسته داده» را بزنید."
        )
    if bundle.get("is_synthetic"):
        raise ValueError("این بسته ساختگی است و نتیجه‌اش روی فروشگاه واقعی پذیرفته نمی‌شود.")
    return bundle


# ---------------------------------------------------------------- ویژگی‌ها

def build_features(bundle: dict) -> pd.DataFrame:
    """
    از سفارش‌ها، یک ردیف ویژگی برای هر مشتری می‌سازد.

    فراتر از RFM کلاسیک می‌رود چون بسته باهوش داده‌اش را دارد و همین چند ستون
    اضافه است که «وابسته به تخفیف» را از «وفادار» جدا می‌کند — تمایزی که برای
    تصمیم بازاریابی حیاتی است و RFM چهارستونی نمی‌بیند.
    """
    now = datetime.now(timezone.utc)
    rows: dict[str, dict] = {}

    for order in bundle.get("orders", []):
        key = order.get("customer_key")
        created = order.get("created_at")
        if not key or not created:
            continue

        when = datetime.fromisoformat(created.replace("Z", "+00:00"))
        row = rows.setdefault(key, {
            "orders": 0, "paid": 0.0, "listed": 0.0, "discount": 0.0,
            "refund": 0.0, "lines": 0, "categories": set(), "dates": [],
        })

        row["orders"] += 1
        row["paid"] += float(order.get("total") or 0)
        row["listed"] += float(order.get("subtotal") or 0)
        row["discount"] += float(order.get("discount_total") or 0)
        row["refund"] += float(order.get("refund_total") or 0)
        row["dates"].append(when)

        for line in order.get("items", []):
            row["lines"] += 1
            for category in line.get("category_ids") or []:
                row["categories"].add(int(category))

    records = []
    for key, row in rows.items():
        dates = sorted(row["dates"])
        recency = (now - dates[-1]).days
        tenure = (now - dates[0]).days

        # نظم خرید: انحراف معیار فاصله‌ها نسبت به میانگینشان. صفر یعنی کاملاً
        # منظم. مشتری تک‌خریده نظمی ندارد و صفر می‌گیرد، نه مقدار جعلی.
        if len(dates) >= 3:
            gaps = [(b - a).days for a, b in zip(dates, dates[1:])]
            mean_gap = sum(gaps) / len(gaps)
            regularity = (np.std(gaps) / mean_gap) if mean_gap > 0 else 0.0
        else:
            regularity = 0.0

        records.append({
            "customer_key": key,
            "recency_days": float(recency),
            "frequency": float(row["orders"]),
            "monetary": float(row["paid"]),
            "avg_order_value": float(row["paid"] / row["orders"]),
            "discount_share": float(row["discount"] / row["listed"]) if row["listed"] > 0 else 0.0,
            "category_variety": float(len(row["categories"])),
            "basket_size": float(row["lines"] / row["orders"]),
            "tenure_days": float(max(tenure, recency)),
            "order_regularity": float(regularity),
        })

    return pd.DataFrame.from_records(records)


def prepare_matrix(df: pd.DataFrame) -> np.ndarray:
    """
    مقیاس‌دهی، با لگاریتم روی ستون‌های چوله.

    مبلغ و تعداد سفارش دنباله بلند دارند: یک مشتری با صد برابر خرج، بدون
    لگاریتم همه خوشه‌ها را به‌سمت خودش می‌کشد.
    """
    X = df[FEATURES].to_numpy(dtype=float).copy()
    for name in ("monetary", "avg_order_value", "frequency", "recency_days", "tenure_days"):
        i = FEATURES.index(name)
        X[:, i] = np.log1p(np.clip(X[:, i], 0, None))
    return StandardScaler().fit_transform(X)


# -------------------------------------------------------------- خوشه‌بندی

class Candidate:
    def __init__(self, algorithm: str, params: dict, labels: np.ndarray):
        self.algorithm = algorithm
        self.params = params
        self.labels = labels
        self.silhouette = 0.0
        self.calinski_harabasz = 0.0
        self.davies_bouldin = 0.0
        self.n_clusters = 0
        self.n_noise = 0
        self.dominance = 0.0
        self.name_collisions = 0
        self.rejected = ""

    @property
    def composite(self) -> float:
        if self.rejected:
            return float("-inf")
        ch = self.calinski_harabasz / (self.calinski_harabasz + 1000.0)
        score = self.silhouette + ch - self.davies_bouldin / 10.0
        score -= max(0.0, self.dominance - 0.50)   # بخشی که نصف فروشگاه است، بخش نیست
        score -= 0.08 * self.name_collisions       # خوشه‌ای که نام تازه نمی‌سازد
        return score

    def row(self) -> dict:
        return {
            "الگوریتم": self.algorithm,
            "تنظیم": json.dumps(self.params, ensure_ascii=False),
            "خوشه": self.n_clusters,
            "نویز": self.n_noise,
            "بزرگ‌ترین بخش": f"{100 * self.dominance:.0f}٪",
            "سیلوئت": round(self.silhouette, 3),
            "CH": round(self.calinski_harabasz, 0),
            "DB": round(self.davies_bouldin, 3),
            "نمره": round(self.composite, 3) if not self.rejected else None,
            "وضعیت": self.rejected or "قابل قبول",
        }


def _score(candidate: Candidate, X: np.ndarray) -> Candidate:
    labels = candidate.labels
    keep = labels != -1
    candidate.n_noise = int((~keep).sum())
    clusters = sorted(set(labels[keep].tolist()))
    candidate.n_clusters = len(clusters)

    if candidate.n_clusters < 2:
        candidate.rejected = "کمتر از دو خوشه"
        return candidate

    sizes = [int((labels == c).sum()) for c in clusters]
    floor = min_segment_size(len(labels))
    if all(s < floor for s in sizes):
        candidate.rejected = "همه خوشه‌ها خیلی کوچک"
        return candidate

    candidate.dominance = max(sizes) / max(1, int(keep.sum()))
    if candidate.n_noise / max(1, len(labels)) > MAX_NOISE_SHARE:
        candidate.rejected = f"{100 * candidate.n_noise / len(labels):.0f}٪ نویز"
        return candidate

    Xk, lk = X[keep], labels[keep]
    candidate.silhouette = float(silhouette_score(Xk, lk, sample_size=min(len(Xk), SILHOUETTE_SAMPLE), random_state=0))
    candidate.calinski_harabasz = float(calinski_harabasz_score(Xk, lk))
    candidate.davies_bouldin = float(davies_bouldin_score(Xk, lk))
    return candidate


def _name_collisions(labels: np.ndarray, df: pd.DataFrame) -> int:
    names = []
    for cluster in sorted(set(labels.tolist())):
        mask = labels == cluster
        if cluster == -1 or int(mask.sum()) < min_segment_size(len(labels)):
            continue
        names.append(_persian_name(df[mask], df)[0])
    return len(names) - len(set(names))


def compare_algorithms(X: np.ndarray, df: pd.DataFrame) -> tuple[Candidate, pd.DataFrame]:
    """سه الگوریتم را اجرا و با شاخص یکسان داوری می‌کند."""
    n = len(X)
    candidates: list[Candidate] = []
    floor = min_segment_size(n)
    max_k = max(2, min(8, n // floor))

    for k in range(2, max_k + 1):
        candidates.append(_score(Candidate("K-Means", {"k": k},
                          KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(X)), X))

    for k in range(2, max_k + 1):
        candidates.append(_score(Candidate("سلسله‌مراتبی", {"k": k},
                          AgglomerativeClustering(n_clusters=k, linkage="ward").fit_predict(X)), X))

    for min_samples in (floor, 2 * X.shape[1]):
        if min_samples >= n:
            continue
        kth = np.sort(NearestNeighbors(n_neighbors=min_samples).fit(X).kneighbors(X)[0][:, -1])
        for pct in (70, 80, 88, 94):
            eps = float(np.percentile(kth, pct))
            if eps <= 0:
                continue
            candidates.append(_score(Candidate("DBSCAN", {"eps": round(eps, 3), "min_samples": min_samples},
                              DBSCAN(eps=eps, min_samples=min_samples).fit_predict(X)), X))

    for c in candidates:
        if not c.rejected:
            c.name_collisions = _name_collisions(c.labels, df)

    viable = [c for c in candidates if not c.rejected]
    if not viable:
        raise RuntimeError("هیچ تنظیمی خوشه‌بندی قابل قبولی نداد. احتمالاً تعداد مشتری خیلی کم است.")

    winner = max(viable, key=lambda c: c.composite)
    table = pd.DataFrame([c.row() for c in candidates]).sort_values(
        "نمره", ascending=False, na_position="last"
    ).reset_index(drop=True)
    return winner, table


# ----------------------------------------------------------- نام‌گذاری فارسی

def _persian_name(group: pd.DataFrame, everyone: pd.DataFrame) -> tuple[str, str, str]:
    """(کلید انگلیسی، نام فارسی، توضیح) — از روی رفتار، نه شماره خوشه."""
    recency = group["recency_days"].mean()
    frequency = group["frequency"].mean()
    monetary = group["monetary"].mean()
    discount = group["discount_share"].mean()

    rich = monetary >= everyone["monetary"].median()
    discount_led = discount >= max(0.20, everyone["discount_share"].median() * 1.5)

    if recency > 180 and frequency >= 2:
        return ("lapsed_loyal", "وفادارانِ از‌دست‌رفته",
                "قبلاً مرتب می‌خریدند و مدت‌هاست نیامده‌اند. گران‌ترین گروهی که دارید از دست می‌دهید.")
    if recency > 180:
        return ("at_risk", "در خطر ریزش",
                "مدت‌هاست خریدی نکرده‌اند. کمپین بازگشت با پیشنهاد مشخص.")
    if discount_led:
        return ("discount_led", "وابسته به تخفیف",
                "تقریباً فقط با کد تخفیف می‌خرند. تخفیف بی‌هدف به اینها، حاشیه سود را می‌خورد.")
    if frequency >= 3 and rich:
        return ("champions", "مشتریان طلایی",
                "هم زیاد می‌خرند هم تازه. روی اینها تخفیف ندهید؛ دسترسی زودتر بدهید.")
    if frequency >= 3:
        return ("loyal", "مشتریان وفادار",
                "مرتب خرید می‌کنند. فروش مکمل و پکیج جواب می‌دهد.")
    if frequency <= 1 and recency <= 60:
        return ("new", "تازه‌واردها",
                "اولین خریدشان را کرده‌اند. تمام هدف، رساندن به خرید دوم است.")
    if rich:
        return ("big_spender", "خریداران پرمبلغ",
                "کم می‌آیند ولی گران می‌خرند. سبد بزرگ‌تر، نه ارزان‌تر.")
    return ("occasional", "خریداران گاه‌به‌گاه",
            "الگوی روشنی ندارند. بهترین گروه برای آزمایش قیمت.")


def build_payload(winner: Candidate, df: pd.DataFrame, table: pd.DataFrame) -> dict:
    """
    خروجی را دقیقاً به قالبی می‌سازد که صفحه «بخش‌بندی مشتریان» می‌خواند.

    کلیدهایی که صفحه واقعاً نمایش می‌دهد و اگر نباشند جایشان خالی می‌ماند:
        label                 ← نام فارسی، تیتر کارت
        segment_key           ← کلید ASCII (با sanitize_key پاک می‌شود)
        customer_count, total_revenue, percentage
        average_aov, average_recency, characteristics
    """
    labels = winner.labels
    df = df.copy()
    df["_cluster"] = labels

    floor = min_segment_size(len(labels))
    total = int((labels != -1).sum()) or 1
    segments, assignments, used = [], [], {}

    for cluster in sorted(set(labels.tolist())):
        group = df[df["_cluster"] == cluster]
        if len(group) < floor:
            continue

        if cluster == -1:
            key, label, description = ("outliers", "مشتریان خاص",
                "در هیچ الگوی مشترکی نمی‌گنجند. جداگانه نگاهشان کنید؛ اغلب ارزشمندند.")
        else:
            key, label, description = _persian_name(group, df)

        # The ordinal has to be read before `key` is reassigned, or the lookup
        # lands on a key that does not exist yet.
        seen = used.get(key, 0) + 1
        used[key] = seen
        if seen > 1:
            key = f"{key}_{seen}"
            label = f"{label} ({seen})"

        segments.append({
            "segment_key": key,
            "label": label,
            "characteristics": description,
            "customer_count": int(len(group)),
            "percentage": round(100.0 * len(group) / total, 1),
            "total_revenue": round(float(group["monetary"].sum()), 2),
            "average_aov": round(float(group["avg_order_value"].mean()), 2),
            "average_recency": round(float(group["recency_days"].mean()), 1),
            "average_frequency": round(float(group["frequency"].mean()), 2),
            "average_discount_share": round(float(group["discount_share"].mean()), 3),
        })
        assignments.extend(
            {"customer_key": k, "segment_key": key} for k in group["customer_key"]
        )

    quality = {
        "algorithm": winner.algorithm,
        "params": winner.params,
        "silhouette": round(winner.silhouette, 4),
        "calinski_harabasz": round(winner.calinski_harabasz, 2),
        "davies_bouldin": round(winner.davies_bouldin, 4),
        "composite": round(winner.composite, 4),
        "noise_customers": int(winner.n_noise),
        "largest_segment_share": round(winner.dominance, 3),
        "customers_clustered": int(len(df)),
        "customers_assigned": len(assignments),
        "features_used": FEATURES,
    }

    # `insights` فهرستی از کارت‌هاست که صفحه یکی‌یکی رندر می‌کند؛ متریک‌ها
    # جداگانه در `quality` می‌روند، وگرنه به‌شکل کارت‌های خالی درمی‌آیند.
    biggest = max(segments, key=lambda s: s["customer_count"])
    richest = max(segments, key=lambda s: s["total_revenue"])
    cards = [
        {"title": "بزرگ‌ترین گروه",
         "detail": f"{biggest['label']} با {biggest['customer_count']} مشتری "
                   f"({biggest['percentage']}٪ فروشگاه). {biggest['characteristics']}"},
        {"title": "ارزشمندترین گروه",
         "detail": f"{richest['label']} بیشترین درآمد تاریخی را ساخته است. "
                   f"{richest['characteristics']}"},
    ]
    at_risk = [s for s in segments if s["segment_key"].startswith(("at_risk", "lapsed"))]
    if at_risk:
        lost = sum(s["customer_count"] for s in at_risk)
        cards.append({
            "title": "در معرض از دست رفتن",
            "detail": f"{lost} مشتری بیش از شش ماه است خرید نکرده‌اند. "
                      f"کمپین بازگشت برای همین گروه بیشترین اثر را دارد.",
        })

    return {
        # قالب UUID اجباری است؛ افزونه با ^[a-f0-9\-]{36}$ اعتبارسنجی می‌کند.
        "run_id": str(uuid.uuid4()),
        "is_synthetic": False,
        "segments": segments,
        "assignments": assignments,
        "insights": cards,
        "quality": quality,
        "model_versions": {"segmentation": f"colab-{winner.algorithm}-1"},
        "actions": [],
    }
