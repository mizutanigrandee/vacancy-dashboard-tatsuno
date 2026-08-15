#!/usr/bin/env python
"""
update_cache.py — たつの・相生版

楽天トラベル空室検索APIを使い、固定市場マスタ
`hotel_master_tatsuno.json` の有効施設だけを対象に、未来日の
「空室あり施設数」と「各施設の当日最安値の平均」を取得する。

出力:
  2名: vacancy_price_cache_2p.json / historical_data_2p.json / finalized_daily_data_2p.json
  共通: demand_spike_history.json / last_updated.json

たつの版は旅館・リゾート中心で1名販売を行わない施設が多いため、
2026-08-15以降は2名1室を標準指標として運用する。

重要:
- 市場は `hotel_master_tatsuno.json` の enabled=true 施設群。自社比較は行わない。
- 楽天APIの hotelNo は1リクエスト最大15施設なので、マスタを15件ずつ分割して取得する。
- どれか1バッチでも取得失敗した日は部分値を採用せず、0/0扱いとして既存値を保持する。
- 『平均価格』は、空室が取得できた各施設の当日最安値の単純平均。
- 差分は「同じ宿泊日 × 前回巡回時点」の値との差分。
"""

import calendar
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path

import requests
from dateutil.relativedelta import relativedelta

# ============================================================
# Rakuten API credentials (V2)
# ============================================================
APP_ID_V2 = os.environ.get("RAKUTEN_APP_ID_V2", "").strip()
ACCESS_KEY_V2 = os.environ.get("RAKUTEN_ACCESS_KEY_V2", "").strip()

if not APP_ID_V2 or not ACCESS_KEY_V2:
    raise ValueError(
        "❌ RAKUTEN_APP_ID_V2 / RAKUTEN_ACCESS_KEY_V2 が未設定です。"
        " GitHub Secrets に登録してください。"
    )

RAKUTEN_API_URL = (
    "https://openapi.rakuten.co.jp/engine/api/Travel/VacantHotelSearch/20170426"
)
HTTP_REFERER = os.environ.get(
    "RAKUTEN_HTTP_REFERER", "https://mizutanigrandee.github.io/"
).strip()
HTTP_ORIGIN = os.environ.get(
    "RAKUTEN_HTTP_ORIGIN", "https://mizutanigrandee.github.io"
).strip()

RAKUTEN_HEADERS = {
    "Authorization": f"Bearer {ACCESS_KEY_V2}",
    "Referer": HTTP_REFERER,
    "Origin": HTTP_ORIGIN,
    "User-Agent": "vacancy-dashboard-tatsuno/update_cache",
}

print("🧩 Rakuten API mode: V2", file=sys.stderr)

# ============================================================
# Files / market settings
# ============================================================
MARKET_MASTER_FILE = "hotel_master_tatsuno.json"
HOTEL_BATCH_SIZE = 15  # 楽天公式仕様上の hotelNo 最大指定数

CACHE_FILE_2P = "vacancy_price_cache_2p.json"
PREV_CACHE_FILE_2P = "vacancy_price_cache_2p_previous.json"
HISTORICAL_FILE_2P = "historical_data_2p.json"

SPIKE_HISTORY_FILE = "demand_spike_history.json"
LAST_UPDATED_FILE = "last_updated.json"

FINAL_ARCHIVE_FILE_2P = "finalized_daily_data_2p.json"

# ============================================================
# 429対策
# ============================================================
THROTTLE_SEC = float(os.environ.get("RAKUTEN_THROTTLE_SEC", "0.55"))
MAX_RETRIES = int(os.environ.get("RAKUTEN_MAX_RETRIES", "6"))
_session = requests.Session()


def rakuten_get_json(url: str, params: dict, timeout: int = 15) -> dict:
    """429/5xxを指数バックオフで再試行してJSONを返す。"""
    last_err = None

    for attempt in range(MAX_RETRIES):
        try:
            r = _session.get(
                url,
                params=params,
                headers=RAKUTEN_HEADERS,
                timeout=timeout,
            )

            if r.status_code == 200:
                if THROTTLE_SEC > 0:
                    time.sleep(THROTTLE_SEC)
                return r.json()

            if r.status_code == 429:
                retry_after = r.headers.get("Retry-After")
                base = int(retry_after) if (retry_after and retry_after.isdigit()) else 2
                wait = min(base * (2 ** attempt), 30)
                print(
                    f"  ⚠️ 429 Too Many Requests: retry in {wait}s "
                    f"(attempt {attempt + 1}/{MAX_RETRIES})",
                    file=sys.stderr,
                )
                time.sleep(wait)
                continue

            if r.status_code in (500, 502, 503, 504):
                wait = min(2 * (2 ** attempt), 30)
                print(
                    f"  ⚠️ HTTP {r.status_code}: retry in {wait}s "
                    f"(attempt {attempt + 1}/{MAX_RETRIES})",
                    file=sys.stderr,
                )
                time.sleep(wait)
                continue

            last_err = f"HTTP {r.status_code}: {r.text[:300]}"
            break

        except Exception as exc:
            last_err = f"exception: {exc}"
            wait = min(2 * (2 ** attempt), 30)
            print(
                f"  ⚠️ request exception: retry in {wait}s "
                f"(attempt {attempt + 1}/{MAX_RETRIES})",
                file=sys.stderr,
            )
            time.sleep(wait)

    raise RuntimeError(f"rakuten_get_json failed: {last_err or 'unknown error'}")


# ============================================================
# JSON helpers
# ============================================================
def _load_json_file(path: str) -> dict:
    p = Path(path)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_json_file(path: str, data: dict):
    Path(path).write_text(
        json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )


def _is_date_string(value: str) -> bool:
    try:
        dt.date.fromisoformat(value)
        return True
    except (TypeError, ValueError):
        return False


# ============================================================
# Market master
# ============================================================
def load_market_master() -> tuple[dict, list[str]]:
    master = _load_json_file(MARKET_MASTER_FILE)
    hotels = master.get("hotels") or []

    hotel_nos = []
    seen = set()

    for hotel in hotels:
        if hotel.get("enabled", True) is False:
            continue
        hotel_no = str(hotel.get("hotelNo", "")).strip()
        if not hotel_no.isdigit() or hotel_no in seen:
            continue
        seen.add(hotel_no)
        hotel_nos.append(hotel_no)

    if not hotel_nos:
        raise ValueError(f"❌ {MARKET_MASTER_FILE} に有効な施設番号がありません。")

    expected = master.get("hotelCount")
    if isinstance(expected, int) and expected != len(hotel_nos):
        print(
            f"⚠️ master hotelCount={expected} / enabled={len(hotel_nos)}",
            file=sys.stderr,
        )

    print(
        f"🏨 market master: {master.get('marketName', 'たつの中心・西播磨沿岸')} "
        f"/ {len(hotel_nos)} facilities / version={master.get('marketVersion', 1)}",
        file=sys.stderr,
    )
    return master, hotel_nos


def chunked(values: list[str], size: int):
    for i in range(0, len(values), size):
        yield values[i : i + size]


MARKET_MASTER_DATA, MARKET_HOTEL_NOS = load_market_master()
MARKET_BATCHES = list(chunked(MARKET_HOTEL_NOS, HOTEL_BATCH_SIZE))
MARKET_VERSION = int(MARKET_MASTER_DATA.get("marketVersion", 1) or 1)
MARKET_NAME = MARKET_MASTER_DATA.get("marketName", "たつの中心・西播磨沿岸")

# 市場マスタを変更した初回巡回は、施設追加/削除による見かけ上の差分を0扱いにする。
_previous_update_meta = _load_json_file(LAST_UPDATED_FILE)
BASELINE_RESET = int(_previous_update_meta.get("market_version", 0) or 0) != MARKET_VERSION
if BASELINE_RESET:
    print(
        f"🔄 market version changed: {_previous_update_meta.get('market_version')} -> {MARKET_VERSION}; diff baseline reset",
        file=sys.stderr,
    )

# ============================================================
# Response parser
# ============================================================
def _extract_hotel_min_price(hotel_obj):
    """1施設分のレスポンスから利用可能な部屋の最安 total を返す。"""
    try:
        blocks = hotel_obj.get("hotel", [])
        min_price = None

        for block in blocks:
            for room_info in block.get("roomInfo", []) or []:
                daily_charge = room_info.get("dailyCharge") or {}
                total = daily_charge.get("total")
                if isinstance(total, (int, float)) and total > 0:
                    if min_price is None or total < min_price:
                        min_price = total

        return min_price
    except Exception:
        return None


# ============================================================
# Market fetch
# ============================================================
def fetch_market_avg(date: dt.date, adult_num: int) -> dict:
    """
    市場マスタの enabled 施設を15件単位で検索し、
    空室あり施設数と各施設最安値の平均を返す。

    1バッチでもAPI取得に失敗した場合は部分値を返さず、
    ok=False / 0 / 0 として呼び出し元で既存値を保持する。
    """
    print(f"🔍 market({adult_num}p) {date}", file=sys.stderr)

    vacancy_total = 0
    hotel_mins = []

    for batch_index, hotel_nos in enumerate(MARKET_BATCHES, start=1):
        params = {
            "applicationId": APP_ID_V2,
            "accessKey": ACCESS_KEY_V2,
            "format": "json",
            "checkinDate": date.strftime("%Y-%m-%d"),
            "checkoutDate": (date + dt.timedelta(days=1)).strftime("%Y-%m-%d"),
            "adultNum": adult_num,
            "roomNum": 1,
            "hotelNo": ",".join(hotel_nos),
            "hits": 30,
            "page": 1,
        }

        try:
            data = rakuten_get_json(RAKUTEN_API_URL, params=params, timeout=15)
        except Exception as exc:
            print(
                f"  ❌ batch fetch failed {date} ({adult_num}p) "
                f"batch={batch_index}/{len(MARKET_BATCHES)}: {exc}",
                file=sys.stderr,
            )
            return {"vacancy": 0, "avg_price": 0.0, "ok": False}

        paging = data.get("pagingInfo") or {}
        batch_count = paging.get("recordCount", 0) or 0
        try:
            vacancy_total += int(batch_count)
        except (TypeError, ValueError):
            pass

        batch_prices = []
        for hotel in data.get("hotels", []) or []:
            min_price = _extract_hotel_min_price(hotel)
            if isinstance(min_price, (int, float)) and min_price > 0:
                batch_prices.append(float(min_price))

        hotel_mins.extend(batch_prices)
        print(
            f"   batch {batch_index}/{len(MARKET_BATCHES)}: "
            f"available={batch_count}, priced={len(batch_prices)}",
            file=sys.stderr,
        )

    avg_price = round(sum(hotel_mins) / len(hotel_mins), 0) if hotel_mins else 0.0

    print(
        f"   → market({adult_num}p) avg(min)={avg_price} "
        f"vacancy={vacancy_total}/{len(MARKET_HOTEL_NOS)} "
        f"priced={len(hotel_mins)}",
        file=sys.stderr,
    )

    return {
        "vacancy": vacancy_total,
        "avg_price": avg_price,
        "ok": True,
    }


# ============================================================
# Finalized archive
# ============================================================
def archive_finalized_past_data(cache: dict, archive_file: str, today: dt.date):
    archive = _load_json_file(archive_file)

    for iso, value in cache.items():
        if not _is_date_string(iso):
            continue

        stay_date = dt.date.fromisoformat(iso)
        if stay_date >= today:
            continue

        archive[iso] = {
            "vacancy": int(value.get("vacancy", 0) or 0),
            "avg_price": int(value.get("avg_price", 0) or 0),
        }

    archive = dict(sorted(archive.items()))
    _save_json_file(archive_file, archive)
    print(f"🗂 archived finalized past data: {archive_file}", file=sys.stderr)


# ============================================================
# Cache update (2p)
# ============================================================
def update_cache_mode(
    start_date: dt.date,
    months: int,
    adult_num: int,
    cache_file: str,
    prev_file: str,
    final_archive_file: str,
) -> dict:
    today = dt.date.today()
    three_months_ago = today - relativedelta(months=3)
    cal = calendar.Calendar(firstweekday=calendar.SUNDAY)

    cache = _load_json_file(cache_file)
    old_cache = _load_json_file(prev_file)

    archive_finalized_past_data(cache, final_archive_file, today)

    # 過去3か月より前は現行キャッシュから除外
    cache = {
        key: value
        for key, value in cache.items()
        if _is_date_string(key) and dt.date.fromisoformat(key) >= three_months_ago
    }

    for month_offset in range(months):
        month_start = (start_date + relativedelta(months=month_offset)).replace(day=1)

        for week in cal.monthdatescalendar(month_start.year, month_start.month):
            for day in week:
                if day.month != month_start.month or day <= today:
                    continue

                iso = day.isoformat()
                market = fetch_market_avg(day, adult_num=adult_num)

                # API失敗、または0件/0円は既存値保持
                if (
                    not market.get("ok")
                    or (
                        market.get("vacancy", 0) == 0
                        and float(market.get("avg_price", 0) or 0) == 0.0
                    )
                ):
                    print(
                        f"⏩ keep existing {iso} ({adult_num}p): invalid/empty fetch",
                        file=sys.stderr,
                    )
                    continue

                previous = {} if BASELINE_RESET else old_cache.get(iso, {})
                last_vacancy = previous.get("vacancy", market["vacancy"])
                last_avg_price = previous.get("avg_price", market["avg_price"])

                cache[iso] = {
                    "vacancy": int(market["vacancy"]),
                    "avg_price": float(market["avg_price"]),
                    "last_vacancy": int(last_vacancy),
                    "last_avg_price": float(last_avg_price),
                    "vacancy_diff": int(market["vacancy"] - last_vacancy),
                    "avg_price_diff": float(market["avg_price"] - last_avg_price),
                }

    cache = dict(sorted(cache.items()))
    _save_json_file(cache_file, cache)
    _save_json_file(prev_file, cache)
    print(f"✅ cache updated: {cache_file}", file=sys.stderr)
    return cache


# ============================================================
# Historical snapshots
# ============================================================
def update_history_mode(cache: dict, historical_file: str):
    today = dt.date.today()
    today_str = today.isoformat()
    hist_data = _load_json_file(historical_file)

    for iso, value in cache.items():
        if _is_date_string(iso) and dt.date.fromisoformat(iso) >= today:
            hist_data.setdefault(iso, {})
            hist_data[iso][today_str] = {
                "vacancy": value.get("vacancy", 0),
                "avg_price": value.get("avg_price", 0),
            }

    # 各宿泊日の追跡履歴は、その宿泊日から遡って3か月分だけ保持
    for date_key in list(hist_data.keys()):
        if not _is_date_string(date_key):
            del hist_data[date_key]
            continue

        stay_date = dt.date.fromisoformat(date_key)
        limit = stay_date - relativedelta(months=3)

        for hist_key in list(hist_data[date_key].keys()):
            if not _is_date_string(hist_key):
                del hist_data[date_key][hist_key]
                continue
            if dt.date.fromisoformat(hist_key) < limit:
                del hist_data[date_key][hist_key]

        if not hist_data[date_key]:
            del hist_data[date_key]

    _save_json_file(historical_file, hist_data)
    print(f"📁 {historical_file} updated", file=sys.stderr)


# ============================================================
# Demand spike detection (2p)
# ============================================================
def detect_demand_spikes(cache_data, price_up_pct=0.05, vac_down_pct=0.05):
    today = dt.date.today()
    results = []

    for date_key in sorted(cache_data.keys()):
        try:
            stay_date = dt.date.fromisoformat(date_key)
        except Exception:
            continue

        if stay_date < today:
            continue

        rec = cache_data[date_key]
        last_price = rec.get("last_avg_price", 0)
        last_vacancy = rec.get("last_vacancy", 0)
        cur_price = rec.get("avg_price", 0)
        cur_vacancy = rec.get("vacancy", 0)

        if not (last_price and last_vacancy):
            continue

        price_diff = cur_price - last_price
        vacancy_diff = cur_vacancy - last_vacancy
        price_ratio = price_diff / last_price if last_price else 0.0
        vacancy_ratio = vacancy_diff / last_vacancy if last_vacancy else 0.0

        if vacancy_ratio <= -vac_down_pct and price_ratio >= price_up_pct:
            results.append(
                {
                    "spike_date": date_key,
                    "price": cur_price,
                    "last_price": last_price,
                    "price_diff": price_diff,
                    "price_ratio": round(float(price_ratio), 4),
                    "vacancy": cur_vacancy,
                    "last_vac": last_vacancy,
                    "vacancy_diff": vacancy_diff,
                    "vacancy_ratio": round(float(vacancy_ratio), 4),
                }
            )

    print(
        f"📊 Demand Spikes Detected (price↑ & vac↓): {len(results)} 件",
        file=sys.stderr,
    )
    return results


def save_demand_spike_history(demand_spikes, history_file=SPIKE_HISTORY_FILE):
    today = dt.date.today()
    today_iso = today.isoformat()
    history = _load_json_file(history_file)

    history[today_iso] = demand_spikes or []

    limit = (today - dt.timedelta(days=90)).isoformat()
    history = {key: value for key, value in history.items() if key >= limit}

    cleaned = {}
    for update_date, items in history.items():
        valid_items = []
        for item in items or []:
            spike_date = item.get("spike_date")
            try:
                if spike_date and dt.date.fromisoformat(spike_date) < today:
                    continue
            except Exception:
                pass

            price_diff = item.get("price_diff", 0)
            vacancy_diff = item.get("vacancy_diff", 0)

            if not (
                isinstance(price_diff, (int, float))
                and isinstance(vacancy_diff, (int, float))
                and price_diff > 0
                and vacancy_diff < 0
            ):
                continue

            valid_items.append(item)

        cleaned[update_date] = valid_items

    _save_json_file(history_file, cleaned)
    print(f"📁 {history_file} cleaned & updated", file=sys.stderr)


# ============================================================
# Last updated
# ============================================================
def write_last_updated():
    jst = dt.timezone(dt.timedelta(hours=9))
    now = dt.datetime.now(jst)

    payload = {
        "last_updated_iso": now.isoformat(timespec="seconds"),
        "last_updated_jst": now.strftime("%Y-%m-%d %H:%M:%S JST"),
        "source": "github-actions",
        "git_sha": os.environ.get("GITHUB_SHA", "")[:7],
        "market": MARKET_NAME,
        "market_version": MARKET_VERSION,
        "market_hotel_count": len(MARKET_HOTEL_NOS),
        "note": "vacancy/price crawl finished",
    }

    _save_json_file(LAST_UPDATED_FILE, payload)
    print(
        f"🕒 {LAST_UPDATED_FILE} written: {payload['last_updated_jst']}",
        file=sys.stderr,
    )


# ============================================================
# Entrypoint
# ============================================================
if __name__ == "__main__":
    print(f"📡 update_cache.py start ({MARKET_NAME} / 2名基準)", file=sys.stderr)

    # たつの版は2名1室のみ取得。
    cache_2p = update_cache_mode(
        start_date=dt.date.today(),
        months=9,
        adult_num=2,
        cache_file=CACHE_FILE_2P,
        prev_file=PREV_CACHE_FILE_2P,
        final_archive_file=FINAL_ARCHIVE_FILE_2P,
    )
    update_history_mode(cache_2p, HISTORICAL_FILE_2P)

    # 需要急騰履歴も2名データで判定。
    demand_spikes = detect_demand_spikes(
        cache_data=cache_2p,
        price_up_pct=0.05,
        vac_down_pct=0.05,
    )
    save_demand_spike_history(demand_spikes)

    write_last_updated()
    print("✨ all done (2p only)", file=sys.stderr)
