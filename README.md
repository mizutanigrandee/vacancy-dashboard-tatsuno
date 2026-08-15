# vacancy-dashboard-tatsuno

「めちゃいいツール」空室＆平均価格カレンダーの **たつの・相生版** です。

## 対象市場

楽天トラベルの「姫路・相生・赤穂」登録施設から、住所が以下の施設だけを固定市場として追跡します。

- たつの市：19施設
- 相生市：5施設
- 合計：24施設

対象施設は `hotel_master_tatsuno.json` で管理します。`enabled: false` にした施設は次回巡回から市場集計対象外になります。

## 取得指標

- 1名1室 / 2名1室の切替
- 空室あり施設数
- 各施設の当日最安価格の平均
- 同じ宿泊日に対する前回巡回値との差分
- 過去3か月の推移履歴
- 過去日の最終確定値アーカイブ
- 需要急騰検知（1名データ基準）
- イベント表示
- 最終更新日時

自社ホテルは未開業のため、初期版では自社価格・自社比較モードを実装していません。

## 楽天API取得方式

`VacantHotelSearch` の `hotelNo` は最大15施設まで指定できるため、24施設を以下の2バッチに分けて検索します。

- Batch 1: 15施設
- Batch 2: 9施設

どちらか1バッチでもAPI取得に失敗した日は部分値を採用せず、その宿泊日の既存値を保持します。

## GitHub Secrets

`Settings > Secrets and variables > Actions` に以下を登録してください。

- `RAKUTEN_APP_ID_V2`
- `RAKUTEN_ACCESS_KEY_V2`

`RAKUTEN_MY_HOTEL_NO` は不要です。

## 自動更新

`.github/workflows/daily_update.yml`

- 毎日 JST 09:00
- 手動実行にも対応
- 1名 → 需要急騰判定 → 2名 の順で取得
- JSON構文と NaN / Infinity 混入を検証してからコミット

## イベント

`event_data.xlsx` の列は以下です。

| date | icon | name |
|---|---|---|
| 2026-10-01 | 🔴 | イベント名 |

目安として、`🔴` はたつの市、`🔵` は相生市、`★` は周辺・その他イベントに利用できます。

`event_data.xlsx` を更新すると `.github/workflows/convert_event_data.yml` が `event_data.json` へ変換します。

## 主なファイル

- `index.html` — Web UI
- `app.js` — カレンダー / グラフ / 需要表示
- `style.css` — UIスタイル
- `update_cache.py` — 楽天API巡回・履歴更新
- `hotel_master_tatsuno.json` — 固定24施設マスタ
- `vacancy_price_cache*.json` — 最新 / 前回値
- `historical_data*.json` — 推移履歴
- `finalized_daily_data*.json` — 過去日最終値
- `demand_spike_history.json` — 需要急騰履歴
- `last_updated.json` — 最終更新時刻

## 初回セットアップ

1. 必要ファイル一式を `main` ブランチへ配置
2. GitHub Secrets 2件を確認
3. `Actions > Daily Update > Run workflow` を手動実行
4. Actions成功後、生成されたJSONを確認
5. GitHub Pagesを `main / root` から公開

## 注意

「空室数」は客室総在庫数ではなく、追跡市場42施設のうち **楽天トラベルでその日に空室販売が確認できた施設数** です。


## Market v2 (2026-08-15)
- 追跡市場を43施設へ拡張（たつの19 / 相生5 / 赤穂15 / 家島・坊勢4）
- 新舞子を中心とした西播磨〜瀬戸内沿岸の市場把握を目的とする
- 🔥需要シンボルは追跡総施設数ではなく、同曜日・前後6週間の通常水準との相対比較で判定
- marketVersion変更時は初回差分をリセットし、施設追加による見かけ上の増減を表示しない


## Market v3 (2026-08-15)
- 赤穂温泉 赤穂パークホテル（hotelNo: 823）を追跡市場から除外
- 理由：通常価格帯が比較用途として低めで、2027年1月以降に約200万円の異常高値も確認されたため
- 追跡市場は42施設（たつの19 / 相生5 / 赤穂14 / 家島・坊勢4）
- marketVersionを3へ更新し、構成変更直後の見かけ上の差分をリセット
