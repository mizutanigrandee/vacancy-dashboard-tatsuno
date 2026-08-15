#!/usr/bin/env python
"""
楽天トラベル「姫路・相生・赤穂 (nannansei)」市場検証。

確認内容:
- SimpleHotelSearch で地区所属ホテル一覧を取得
- VacantHotelSearch で30日後の1名1室・1泊の空室ホテル一覧を取得
- 429対策として指数バックオフ＋リクエスト間隔を入れる
- 本番JSONは一切変更しない
"""

import datetime as dt
import json
import os
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

HEADERS = {
    "Authorization": f"Bearer {ACCESS_KEY}",
    "Referer": REFERER,
    "Origin": ORIGIN,
    "User-Agent": "vacancy-dashboard-tatsuno/nannansei-market-test",
}

SIMPLE_URL = (
    "https://openapi.rakuten.co.jp/"
    "engine/api/Travel/SimpleHotelSearch/20260731"
)

VACANT_URL = (
    "https://openapi.rakuten.co.jp/"
    "engine/api/Travel/VacantHotelSearch/20170426"
)

AREA = {
    "largeClassCode": "japan",
    "middleClassCode": "hyogo",
    "smallClassCode": "nannansei",
}

MAX_RETRIES = 6
REQUEST_INTERVAL = 1.5
_session = requests.Session()


def api_get(url, params):
    merged = {
        "applicationId": APP_ID,
        "accessKey": ACCESS_KEY,
        "format": "json",
        "formatVersion": 2,
        **params,
    }

    last_error = None

    for attempt in range(MAX_RETRIES):
        try:
            r = _session.get(
                url,
                params=merged,
                headers=HEADERS,
                timeout=30,
            )

            print(
                f"HTTP {r.status_code} | "
                f"{url.rsplit('/', 1)[-1]} | "
                f"page={merged.get('page', 1)}"
            )

            if r.status_code == 200:
                time.sleep(REQUEST_INTERVAL)
                return r.json()

            if r.status_code == 429:
                retry_after = r.headers.get("Retry-After")
                if retry_after and retry_after.isdigit():
                    wait = int(retry_after)
                else:
                    wait = min(2 ** (attempt + 1), 30)

                print(
                    f"⚠️ 429 Rate limit. "
                    f"{wait}秒待機して再試行 "
                    f"({attempt + 1}/{MAX_RETRIES})"
                )
                time.sleep(wait)
                continue

            if r.status_code in (500, 502, 503, 504):
                wait = min(2 ** (attempt + 1), 30)
                print(
                    f"⚠️ HTTP {r.status_code}. "
                    f"{wait}秒待機して再試行 "
                    f"({attempt + 1}/{MAX_RETRIES})"
                )
                time.sleep(wait)
                continue

            last_error = f"HTTP {r.status_code}: {r.text[:800]}"
            break

        except Exception as e:
            last_error = repr(e)
            wait = min(2 ** (attempt + 1), 30)
            print(
                f"⚠️ request exception: {e} / "
                f"{wait}秒後に再試行"
            )
            time.sleep(wait)

    raise RuntimeError(last_error or "API request failed")


def collect_hotels(obj, found=None):
    if found is None:
        found = {}

    if isinstance(obj, dict):
        if obj.get("hotelNo") is not None and obj.get("hotelName"):
            hotel_no = str(obj["hotelNo"])
            current = found.setdefault(
                hotel_no,
                {
                    "hotelNo": hotel_no,
                    "hotelName": str(obj.get("hotelName", "")),
                    "address1": str(obj.get("address1", "")),
                    "address2": str(obj.get("address2", "")),
                    "hotelMinCharge": obj.get("hotelMinCharge"),
                },
            )

            for key in (
                "hotelName",
                "address1",
                "address2",
                "hotelMinCharge",
            ):
                value = obj.get(key)
                if value not in (None, ""):
                    current[key] = value

        for value in obj.values():
            collect_hotels(value, found)

    elif isinstance(obj, list):
        for item in obj:
            collect_hotels(item, found)

    return found


def fetch_all_simple():
    hotels = {}
    page = 1
    record_count = None
    page_count = 1

    while page <= page_count:
        data = api_get(
            SIMPLE_URL,
            {
                **AREA,
                "hits": 30,
                "page": page,
                "responseType": "middle",
            },
        )

        paging = data.get("pagingInfo") or {}

        if record_count is None:
            record_count = paging.get("recordCount")

        page_count = int(paging.get("pageCount") or 1)
        collect_hotels(data, hotels)

        print(
            f"SimpleHotelSearch page {page}/{page_count}: "
            f"累計 {len(hotels)}施設"
        )

        page += 1

    return record_count, list(hotels.values())


def fetch_all_vacant(checkin, checkout):
    hotels = {}
    page = 1
    record_count = None
    page_count = 1

    while page <= page_count:
        data = api_get(
            VACANT_URL,
            {
                **AREA,
                "checkinDate": checkin.isoformat(),
                "checkoutDate": checkout.isoformat(),
                "adultNum": 1,
                "roomNum": 1,
                "hits": 30,
                "page": page,
            },
        )

        paging = data.get("pagingInfo") or {}

        if record_count is None:
            record_count = paging.get("recordCount")

        page_count = int(paging.get("pageCount") or 1)
        collect_hotels(data, hotels)

        print(
            f"VacantHotelSearch page {page}/{page_count}: "
            f"累計 {len(hotels)}施設"
        )

        page += 1

    return record_count, list(hotels.values())


def print_hotels(title, hotels):
    print()
    print("=" * 90)
    print(title)
    print("=" * 90)

    for i, hotel in enumerate(
        sorted(hotels, key=lambda x: x.get("hotelName", "")),
        1,
    ):
        address = (
            str(hotel.get("address1", ""))
            + str(hotel.get("address2", ""))
        ).strip()

        print(
            f"{i:03d}. "
            f"{hotel.get('hotelNo')} | "
            f"{hotel.get('hotelName')} | "
            f"{address} | "
            f"min={hotel.get('hotelMinCharge')}"
        )


def main():
    print("=" * 90)
    print("NANNANSEI MARKET TEST")
    print("Area: japan > hyogo > nannansei (姫路・相生・赤穂)")
    print("本番ファイルは変更しません。")
    print("=" * 90)

    print("\n[1] SimpleHotelSearch: 地区所属ホテル一覧")
    simple_record_count, simple_hotels = fetch_all_simple()

    print(
        f"\n✅ SimpleHotelSearch 完了: "
        f"recordCount={simple_record_count}, "
        f"抽出施設数={len(simple_hotels)}"
    )

    print_hotels("地区所属ホテル一覧", simple_hotels)

    checkin = dt.date.today() + dt.timedelta(
        days=int(os.environ.get("TEST_STAY_DAYS_AHEAD", "30"))
    )
    checkout = checkin + dt.timedelta(days=1)

    print(
        f"\n[2] VacantHotelSearch: "
        f"{checkin} → {checkout}, adultNum=1"
    )

    vacant_record_count, vacant_hotels = fetch_all_vacant(
        checkin,
        checkout,
    )

    print(
        f"\n✅ VacantHotelSearch 完了: "
        f"recordCount={vacant_record_count}, "
        f"抽出施設数={len(vacant_hotels)}"
    )

    print_hotels(
        f"空室ありホテル一覧 ({checkin})",
        vacant_hotels,
    )

    report = {
        "area": AREA,
        "testedAt": dt.datetime.now().isoformat(timespec="seconds"),
        "checkinDate": checkin.isoformat(),
        "checkoutDate": checkout.isoformat(),
        "simpleHotelSearch": {
            "recordCount": simple_record_count,
            "hotels": simple_hotels,
        },
        "vacantHotelSearch": {
            "recordCount": vacant_record_count,
            "hotels": vacant_hotels,
        },
    }

    Path("nannansei_market_test_result.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print()
    print("=" * 90)
    print("✅ TEST FINISHED")
    print("結果JSON: nannansei_market_test_result.json")
    print("=" * 90)

    return 0


if __name__ == "__main__":
    sys.exit(main())
