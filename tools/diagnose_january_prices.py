#!/usr/bin/env python
"""
diagnose_january_prices.py

目的:
- たつの版43施設について、2026-12-31 / 2027-01-01 / 01-08 / 01-15 の
  2名1室・1泊のホテル別最安値を取得する。
- 平均価格を押し上げている外れ値候補を特定する。
- 本番JSONは一切変更しない。
"""

import json
import os
import statistics
import sys
import time
from pathlib import Path

import requests

APP_ID = os.environ.get("RAKUTEN_APP_ID_V2", "").strip()
ACCESS_KEY = os.environ.get("RAKUTEN_ACCESS_KEY_V2", "").strip()

if not APP_ID or not ACCESS_KEY:
    raise SystemExit("❌ RAKUTEN_APP_ID_V2 / RAKUTEN_ACCESS_KEY_V2 が未設定です。")

REFERER = os.environ.get(
    "RAKUTEN_HTTP_REFERER",
    "https://mizutanigrandee.github.io/",
).strip()
ORIGIN = os.environ.get(
    "RAKUTEN_HTTP_ORIGIN",
    "https://mizutanigrandee.github.io",
).strip()

API_URL = (
    "https://openapi.rakuten.co.jp/"
    "engine/api/Travel/VacantHotelSearch/20170426"
)

HEADERS = {
    "Authorization": f"Bearer {ACCESS_KEY}",
    "Referer": REFERER,
    "Origin": ORIGIN,
    "User-Agent": "vacancy-dashboard-tatsuno/january-price-diagnosis",
}

MASTER_FILE = "hotel_master_tatsuno.json"
BATCH_SIZE = 15
THROTTLE_SEC = 1.0
MAX_RETRIES = 6

TARGET_DATES = [
    "2026-12-31",
    "2027-01-01",
    "2027-01-08",
    "2027-01-15",
]

_session = requests.Session()


def chunked(values, size):
    for i in range(0, len(values), size):
        yield values[i:i + size]


def api_get(params):
    merged = {
        "applicationId": APP_ID,
        "accessKey": ACCESS_KEY,
        "format": "json",
        **params,
    }

    last_error = None

    for attempt in range(MAX_RETRIES):
        try:
            r = _session.get(
                API_URL,
                params=merged,
                headers=HEADERS,
                timeout=30,
            )

            if r.status_code == 200:
                time.sleep(THROTTLE_SEC)
                return r.json()

            if r.status_code == 429:
                retry_after = r.headers.get("Retry-After")
                if retry_after and retry_after.isdigit():
                    wait = max(1, int(retry_after))
                else:
                    wait = min(2 ** (attempt + 1), 30)

                print(
                    f"⚠️ 429: {wait}秒待機して再試行 "
                    f"({attempt + 1}/{MAX_RETRIES})",
                    file=sys.stderr,
                )
                time.sleep(wait)
                continue

            if r.status_code in (500, 502, 503, 504):
                wait = min(2 ** (attempt + 1), 30)
                print(
                    f"⚠️ HTTP {r.status_code}: {wait}秒待機して再試行",
                    file=sys.stderr,
                )
                time.sleep(wait)
                continue

            last_error = f"HTTP {r.status_code}: {r.text[:800]}"
            break

        except Exception as exc:
            last_error = repr(exc)
            wait = min(2 ** (attempt + 1), 30)
            print(
                f"⚠️ request exception: {exc} / {wait}秒後に再試行",
                file=sys.stderr,
            )
            time.sleep(wait)

    raise RuntimeError(last_error or "Rakuten API request failed")


def find_first_value(obj, key):
    if isinstance(obj, dict):
        if key in obj and obj[key] not in (None, ""):
            return obj[key]
        for value in obj.values():
            found = find_first_value(value, key)
            if found not in (None, ""):
                return found

    elif isinstance(obj, list):
        for item in obj:
            found = find_first_value(item, key)
            if found not in (None, ""):
                return found

    return None


def extract_min_price(hotel_obj):
    """
    update_cache.py と同じ考え方で、
    1施設の roomInfo.dailyCharge.total の最安値を返す。
    """
    minimum = None

    def walk(obj):
        nonlocal minimum

        if isinstance(obj, dict):
            daily = obj.get("dailyCharge")
            if isinstance(daily, dict):
                total = daily.get("total")
                if isinstance(total, (int, float)) and total > 0:
                    value = float(total)
                    if minimum is None or value < minimum:
                        minimum = value

            for value in obj.values():
                walk(value)

        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    walk(hotel_obj)
    return minimum


def load_master():
    master = json.loads(Path(MASTER_FILE).read_text(encoding="utf-8"))

    hotels = []
    for item in master.get("hotels", []):
        if item.get("enabled", True) is False:
            continue

        hotel_no = str(item.get("hotelNo", "")).strip()
        if not hotel_no:
            continue

        hotels.append({
            "hotelNo": hotel_no,
            "hotelName": item.get("hotelName", ""),
            "city": item.get("city", ""),
            "zone": item.get("zone", ""),
            "segment": item.get("segment", ""),
        })

    if not hotels:
        raise RuntimeError("hotel_master_tatsuno.json に有効施設がありません。")

    return master, hotels


def stats_for(prices):
    if not prices:
        return {
            "count": 0,
            "mean": None,
            "median": None,
            "max": None,
            "min": None,
            "trimmed_mean_excluding_max": None,
        }

    values = sorted(float(x) for x in prices)
    trimmed = values[:-1] if len(values) >= 2 else values

    return {
        "count": len(values),
        "mean": round(sum(values) / len(values), 0),
        "median": round(statistics.median(values), 0),
        "max": round(max(values), 0),
        "min": round(min(values), 0),
        "trimmed_mean_excluding_max": round(
            sum(trimmed) / len(trimmed), 0
        ) if trimmed else None,
    }


def diagnose_date(date_iso, master_hotels):
    master_by_no = {h["hotelNo"]: h for h in master_hotels}
    hotel_nos = [h["hotelNo"] for h in master_hotels]
    batches = list(chunked(hotel_nos, BATCH_SIZE))

    results = []

    year, month, day = map(int, date_iso.split("-"))

    import datetime as dt
    checkin = dt.date(year, month, day)
    checkout = checkin + dt.timedelta(days=1)

    print()
    print("=" * 100)
    print(f"診断日: {date_iso} / 2名1室")
    print("=" * 100)

    for batch_index, batch in enumerate(batches, 1):
        print(
            f"batch {batch_index}/{len(batches)} "
            f"({len(batch)}施設) ...",
            file=sys.stderr,
        )

        data = api_get({
            "checkinDate": checkin.isoformat(),
            "checkoutDate": checkout.isoformat(),
            "adultNum": 2,
            "roomNum": 1,
            "hotelNo": ",".join(batch),
            "hits": 30,
            "page": 1,
        })

        for hotel_obj in data.get("hotels", []) or []:
            raw_no = find_first_value(hotel_obj, "hotelNo")
            hotel_no = str(raw_no) if raw_no is not None else ""

            master = master_by_no.get(hotel_no, {})
            raw_name = find_first_value(hotel_obj, "hotelName")

            min_price = extract_min_price(hotel_obj)
            if min_price is None:
                continue

            results.append({
                "hotelNo": hotel_no,
                "hotelName": master.get("hotelName") or raw_name or "(unknown)",
                "city": master.get("city", ""),
                "zone": master.get("zone", ""),
                "segment": master.get("segment", ""),
                "minPrice": round(float(min_price), 0),
            })

    results.sort(key=lambda x: x["minPrice"], reverse=True)

    prices = [r["minPrice"] for r in results]
    summary = stats_for(prices)

    median = summary["median"] or 0
    for r in results:
        price = r["minPrice"]
        r["outlierCandidate"] = bool(
            price >= 100000
            or (median > 0 and price >= median * 3)
        )

    print(
        f"\n販売施設数={summary['count']} / "
        f"平均={summary['mean']:,.0f}円 / "
        f"中央値={summary['median']:,.0f}円 / "
        f"最高={summary['max']:,.0f}円 / "
        f"最高値1件除外平均={summary['trimmed_mean_excluding_max']:,.0f}円"
    )

    print()
    print("▼ 高い順")
    print("-" * 100)

    for idx, r in enumerate(results, 1):
        mark = " 🚨" if r["outlierCandidate"] else ""
        print(
            f"{idx:02d}. ¥{r['minPrice']:>10,.0f} | "
            f"{r['hotelNo']:<7} | "
            f"{r['hotelName']} | "
            f"{r['city']} | {r['zone']}{mark}"
        )

    return {
        "date": date_iso,
        "adultNum": 2,
        "summary": summary,
        "hotels": results,
    }


def main():
    master, hotels = load_master()

    print(
        f"市場: {master.get('marketName')} / "
        f"追跡 {len(hotels)}施設"
    )
    print("本番キャッシュは変更しません。")

    report = {
        "marketName": master.get("marketName"),
        "marketVersion": master.get("marketVersion"),
        "trackedHotelCount": len(hotels),
        "dates": [],
    }

    for date_iso in TARGET_DATES:
        report["dates"].append(
            diagnose_date(date_iso, hotels)
        )

    out = Path("january_price_diagnosis.json")
    out.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )

    print()
    print("=" * 100)
    print("✅ DIAGNOSIS FINISHED")
    print("Artifact: january_price_diagnosis.json")
    print("=" * 100)


if __name__ == "__main__":
    main()
