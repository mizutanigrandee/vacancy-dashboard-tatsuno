#!/usr/bin/env python
"""
楽天トラベルAPIで「姫路・相生・赤穂 > 相生」の地区コードと取得施設を検証する一時テスト。

目的:
1) GetAreaClass から兵庫県 / 姫路・相生・赤穂 / 相生の正式コード階層を確認
2) 相生候補コードで SimpleHotelSearch を実行し、対象施設一覧を確認
3) 同じ候補コードで VacantHotelSearch を1泊分だけ実行し、空室検索が通るか確認

本番データや既存JSONは一切変更しない。標準出力へ結果を表示するだけ。
"""

import datetime as dt
import os
import sys
from typing import Any

import requests

APP_ID = os.environ.get("RAKUTEN_APP_ID_V2", "").strip()
ACCESS_KEY = os.environ.get("RAKUTEN_ACCESS_KEY_V2", "").strip()
REFERER = os.environ.get("RAKUTEN_HTTP_REFERER", "https://mizutanigrandee.github.io/").strip()
ORIGIN = os.environ.get("RAKUTEN_HTTP_ORIGIN", "https://mizutanigrandee.github.io").strip()

if not APP_ID or not ACCESS_KEY:
    raise SystemExit("RAKUTEN_APP_ID_V2 / RAKUTEN_ACCESS_KEY_V2 が未設定です。")

HEADERS = {
    "Authorization": f"Bearer {ACCESS_KEY}",
    "Referer": REFERER,
    "Origin": ORIGIN,
    "User-Agent": "vacancy-dashboard-tatsuno/area-test",
}

GET_AREA_URL = "https://openapi.rakuten.co.jp/engine/api/Travel/GetAreaClass/20140210"
SIMPLE_URL = "https://openapi.rakuten.co.jp/engine/api/Travel/SimpleHotelSearch/20260731"
VACANT_URL = "https://openapi.rakuten.co.jp/engine/api/Travel/VacantHotelSearch/20170426"

LEVELS = ("large", "middle", "small", "detail")
TARGET_WORDS = ("兵庫", "姫路", "相生", "赤穂", "たつの", "龍野")


def api_get(url: str, params: dict[str, Any]) -> dict[str, Any]:
    p = {
        "applicationId": APP_ID,
        "accessKey": ACCESS_KEY,
        "format": "json",
        "formatVersion": 2,
        **params,
    }
    r = requests.get(url, params=p, headers=HEADERS, timeout=30)
    print(f"HTTP {r.status_code}: {url}")
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:500]}")
    return r.json()


def walk_area_tree(obj: Any, context=None, out=None, seen=None):
    if context is None:
        context = {lv: {"code": "", "name": ""} for lv in LEVELS}
    if out is None:
        out = []
    if seen is None:
        seen = set()

    if isinstance(obj, dict):
        ctx = {lv: dict(context[lv]) for lv in LEVELS}
        changed = False

        for lv in LEVELS:
            ck, nk = f"{lv}ClassCode", f"{lv}ClassName"
            if ck in obj and obj.get(ck) is not None:
                ctx[lv]["code"] = str(obj.get(ck))
                changed = True
            if nk in obj and obj.get(nk) is not None:
                ctx[lv]["name"] = str(obj.get(nk))
                changed = True

        if changed:
            key = tuple((ctx[lv]["code"], ctx[lv]["name"]) for lv in LEVELS)
            if key not in seen:
                seen.add(key)
                out.append(ctx)

        for value in obj.values():
            walk_area_tree(value, ctx, out, seen)

    elif isinstance(obj, list):
        for item in obj:
            walk_area_tree(item, context, out, seen)

    return out


def path_text(ctx):
    parts = []
    for lv in LEVELS:
        code, name = ctx[lv]["code"], ctx[lv]["name"]
        if code or name:
            parts.append(f"{lv}={name or '-'}({code or '-'})")
    return " > ".join(parts)


def depth(ctx):
    return sum(bool(ctx[lv]["code"]) for lv in LEVELS)


def build_area_params(ctx):
    return {
        f"{lv}ClassCode": ctx[lv]["code"]
        for lv in LEVELS
        if ctx[lv]["code"]
    }


def collect_hotels(obj: Any, found=None):
    if found is None:
        found = {}

    if isinstance(obj, dict):
        if obj.get("hotelNo") is not None and obj.get("hotelName"):
            no = str(obj.get("hotelNo"))
            found.setdefault(
                no,
                {
                    "hotelNo": no,
                    "hotelName": str(obj.get("hotelName", "")),
                    "address1": str(obj.get("address1", "")),
                    "address2": str(obj.get("address2", "")),
                    "hotelMinCharge": obj.get("hotelMinCharge"),
                },
            )

        for value in obj.values():
            collect_hotels(value, found)

    elif isinstance(obj, list):
        for item in obj:
            collect_hotels(item, found)

    return list(found.values())


def main():
    print("=" * 78)
    print("TATSUNO / AIOI AREA TEST")
    print("本番ファイルは変更しません。")
    print("=" * 78)

    print("\n[1] GetAreaClass")
    area_data = api_get(GET_AREA_URL, {})
    rows = walk_area_tree(area_data)

    relevant = [
        ctx for ctx in rows
        if any(word in path_text(ctx) for word in TARGET_WORDS)
    ]
    relevant.sort(key=lambda ctx: (depth(ctx), path_text(ctx)))

    print(f"関連階層候補: {len(relevant)}件")
    for ctx in relevant:
        print("  -", path_text(ctx))

    candidates = []
    seen_params = set()

    for ctx in rows:
        text = path_text(ctx)
        names = [ctx[lv]["name"] for lv in LEVELS]

        if "兵庫" not in text or not any("相生" in n for n in names if n):
            continue

        key = tuple(sorted(build_area_params(ctx).items()))
        if key and key not in seen_params:
            seen_params.add(key)
            candidates.append(ctx)

    if not candidates:
        print("\n❌ 『兵庫 × 相生』候補を自動抽出できませんでした。")
        return 2

    candidates.sort(key=lambda ctx: (-depth(ctx), path_text(ctx)))
    max_depth = depth(candidates[0])
    candidates = [ctx for ctx in candidates if depth(ctx) == max_depth][:3]

    print("\n[2] 相生候補（最深階層）")
    for i, ctx in enumerate(candidates, 1):
        print(f"  Candidate {i}: {path_text(ctx)}")
        print(f"    params={build_area_params(ctx)}")

    checkin = dt.date.today() + dt.timedelta(
        days=int(os.environ.get("TEST_STAY_DAYS_AHEAD", "30"))
    )
    checkout = checkin + dt.timedelta(days=1)

    for i, ctx in enumerate(candidates, 1):
        area_params = build_area_params(ctx)

        print("\n" + "-" * 78)
        print(f"Candidate {i}: {path_text(ctx)}")

        print("\n[3] SimpleHotelSearch")
        try:
            simple = api_get(
                SIMPLE_URL,
                {
                    "hits": 30,
                    "responseType": "middle",
                    **area_params,
                },
            )

            hotels = collect_hotels(simple)
            print(
                f"  recordCount={(simple.get('pagingInfo') or {}).get('recordCount')}"
                f" / 抽出={len(hotels)}施設"
            )

            for h in hotels:
                address = (h["address1"] + h["address2"]).strip()
                print(
                    f"  - {h['hotelNo']} | {h['hotelName']} | "
                    f"{address} | min={h.get('hotelMinCharge')}"
                )

        except Exception as e:
            print(f"  ❌ SimpleHotelSearch失敗: {e}")
            continue

        print(f"\n[4] VacantHotelSearch: {checkin} → {checkout} / adultNum=1")
        try:
            vacant = api_get(
                VACANT_URL,
                {
                    "checkinDate": checkin.isoformat(),
                    "checkoutDate": checkout.isoformat(),
                    "adultNum": 1,
                    "hits": 30,
                    **area_params,
                },
            )

            hotels = collect_hotels(vacant)
            print(
                f"  ✅ recordCount={(vacant.get('pagingInfo') or {}).get('recordCount')}"
                f" / 抽出={len(hotels)}施設"
            )

            for h in hotels:
                address = (h["address1"] + h["address2"]).strip()
                print(f"  - {h['hotelNo']} | {h['hotelName']} | {address}")

        except Exception as e:
            print(f"  ❌ VacantHotelSearch失敗: {e}")

    print("\nテスト終了")
    return 0


if __name__ == "__main__":
    sys.exit(main())
