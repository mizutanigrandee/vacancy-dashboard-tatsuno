// ========== データ & 祝日設定 ==========

// ========= たつの版：2名1室を標準指標として固定 =========
// 旅館・リゾート中心の市場特性上、1名販売を行わない施設が多いため、
// カレンダー・グラフ・需要シンボル・需要急騰履歴はすべて2名基準とする。
const DATA_PATH = "./vacancy_price_cache_2p.json";
const PREV_PATH = "./vacancy_price_cache_2p_previous.json";
const HIST_PATH = "./historical_data_2p.json";
const ARCHIVE_PATH = "./finalized_daily_data_2p.json";

const EVENT_PATH = "./event_data.json";
const SPIKE_PATH = "./demand_spike_history.json";   // 需要急騰も2名基準
const LASTUPDATED_PATH = "./last_updated.json";
const MARKET_MASTER_PATH = "./hotel_master_tatsuno.json";

function modeLabel() {
  return "2名平均";
}

// グローバル状態
let calendarData    = {},
    prevData        = {},
    eventData       = {},
    historicalData  = {},
    spikeData       = {},
    finalArchiveData = {};
let currentYM = [], selectedDate = null;
let demandBase2pData = {}; // 🔥判定は2名データを使う
let marketMasterData = {};
let marketHotelCount = 42;


// ========== 祝日判定（ローカルjs方式） ==========
function isHoliday(date) {
  if (!window.JapaneseHolidays) return null;
  return window.JapaneseHolidays.isHoliday(date);
}

// ========== ヘルパー ==========
const todayIso = () => new Date().toISOString().slice(0,10);


function getDisplayData(dateStr) {
  return calendarData[dateStr] || finalArchiveData[dateStr] || {};
}

function getDemandBaseData(dateStr) {
  return demandBase2pData[dateStr] || getDisplayData(dateStr) || {};
}

// 汎用ロード
async function loadJson(path) {
  try {
    const res = await fetch(path + "?cb=" + Date.now()); // no-cache
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}
async function loadAll() {
  calendarData     = await loadJson(DATA_PATH);
  prevData         = await loadJson(PREV_PATH);
  eventData        = await loadJson(EVENT_PATH);
  historicalData   = await loadJson(HIST_PATH);
  spikeData        = await loadJson(SPIKE_PATH);
  finalArchiveData = await loadJson(ARCHIVE_PATH);
  marketMasterData = await loadJson(MARKET_MASTER_PATH);

  const enabledHotels = (marketMasterData.hotels || []).filter(h => h.enabled !== false);
  marketHotelCount = enabledHotels.length || Number(marketMasterData.hotelCount) || 42;

  // カレンダー表示・🔥判定ともに2名データを共通利用
  demandBase2pData = { ...finalArchiveData, ...calendarData };

  updateMarketMeta();
}

function updateMarketMeta() {
  const countEl = document.getElementById("market-count");
  const noteEl = document.getElementById("market-note");
  const summaryEl = document.getElementById("market-summary");

  if (countEl) {
    countEl.textContent = `追跡市場 ${marketHotelCount}施設`;
    countEl.classList.add("market-count-button");
    countEl.setAttribute("role", "button");
    countEl.setAttribute("tabindex", "0");
    countEl.setAttribute("aria-haspopup", "dialog");
    countEl.setAttribute(
      "title",
      "クリックすると追跡中の施設一覧を表示します"
    );

    countEl.onclick = openMarketHotelModal;

    countEl.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMarketHotelModal();
      }
    };
  }

  if (noteEl && marketMasterData.uiNote) {
    noteEl.textContent = marketMasterData.uiNote;
  }

  if (summaryEl) {
    summaryEl.textContent =
      marketMasterData.summary ||
      `有効追跡施設 ${marketHotelCount}施設`;
  }

  ensureMarketHotelModal();
}


// ========================================
// 追跡市場42施設 一覧モーダル
// ========================================

function ensureMarketHotelModal() {
  if (document.getElementById("market-hotel-modal")) return;

  const style = document.createElement("style");
  style.id = "market-hotel-modal-style";

  style.textContent = `
    .market-count-button {
      cursor: pointer;
      user-select: none;
      transition:
        background-color .15s ease,
        border-color .15s ease,
        box-shadow .15s ease;
    }

    .market-count-button:hover,
    .market-count-button:focus-visible {
      background: #eaf5ff !important;
      border-color: #7eb8e8 !important;
      box-shadow: 0 0 0 2px rgba(52, 152, 219, .12);
      outline: none;
    }

    .market-modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 22px;
      background: rgba(15, 23, 42, .52);
      box-sizing: border-box;
    }

    .market-modal-backdrop.is-open {
      display: flex;
    }

    .market-modal-panel {
      width: min(980px, 96vw);
      max-height: 88vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 24px 70px rgba(0, 0, 0, .28);
    }

    .market-modal-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      padding: 18px 20px 14px;
      border-bottom: 1px solid #e5e7eb;
    }

    .market-modal-title {
      margin: 0;
      color: #163b64;
      font-size: 19px;
      line-height: 1.4;
    }

    .market-modal-subtitle {
      margin: 5px 0 0;
      color: #64748b;
      font-size: 12px;
      line-height: 1.65;
    }

    .market-modal-close {
      flex: 0 0 auto;
      border: 1px solid #cbd5e1;
      background: #fff;
      border-radius: 8px;
      padding: 7px 11px;
      font-size: 13px;
      cursor: pointer;
    }

    .market-modal-close:hover {
      background: #f8fafc;
    }

    .market-modal-body {
      overflow-y: auto;
      padding: 16px 20px 20px;
    }

    .market-modal-summary {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-bottom: 15px;
    }

    .market-modal-summary span {
      padding: 5px 9px;
      border-radius: 999px;
      background: #eef6fd;
      border: 1px solid #d5e8f8;
      color: #285f8f;
      font-size: 12px;
      white-space: nowrap;
    }

    .market-city-group + .market-city-group {
      margin-top: 20px;
    }

    .market-city-title {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin: 0 0 9px;
      padding-bottom: 6px;
      border-bottom: 2px solid #e7f0f8;
      color: #1e5f96;
      font-size: 16px;
    }

    .market-city-count {
      color: #64748b;
      font-size: 11px;
      font-weight: 400;
    }

    .market-hotel-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .market-hotel-item {
      min-width: 0;
      padding: 10px 11px;
      border: 1px solid #e2e8f0;
      border-radius: 9px;
      background: #fbfdff;
    }

    .market-hotel-name {
      margin: 0 0 4px;
      color: #172033;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.45;
    }

    .market-hotel-meta {
      color: #64748b;
      font-size: 10px;
      line-height: 1.55;
      overflow-wrap: anywhere;
    }

    .market-hotel-zone {
      display: inline-block;
      margin-right: 5px;
      color: #3b6f99;
    }

    .market-modal-note {
      margin: 18px 0 0;
      padding: 10px 12px;
      border-radius: 8px;
      background: #fff8e8;
      color: #76591c;
      font-size: 11px;
      line-height: 1.7;
    }

    @media (max-width: 700px) {
      .market-modal-backdrop {
        padding: 10px;
      }

      .market-modal-panel {
        width: 100%;
        max-height: 92vh;
        border-radius: 11px;
      }

      .market-modal-header {
        padding: 15px 14px 12px;
      }

      .market-modal-body {
        padding: 13px 14px 16px;
      }

      .market-hotel-list {
        grid-template-columns: 1fr;
      }

      .market-modal-title {
        font-size: 17px;
      }
    }
  `;

  document.head.appendChild(style);

  const backdrop = document.createElement("div");

  backdrop.id = "market-hotel-modal";
  backdrop.className = "market-modal-backdrop";
  backdrop.setAttribute("aria-hidden", "true");

  backdrop.innerHTML = `
    <section
      class="market-modal-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="market-modal-title"
    >
      <header class="market-modal-header">

        <div>
          <h2
            id="market-modal-title"
            class="market-modal-title"
          >
            追跡市場の施設一覧
          </h2>

          <p class="market-modal-subtitle">
            hotel_master_tatsuno.json に登録されている追跡対象です。
            カレンダーの「○件」は、この一覧のうち対象日に
            楽天トラベルで2名1室の販売が確認できた施設数です。
          </p>
        </div>

        <button
          type="button"
          class="market-modal-close"
          aria-label="施設一覧を閉じる"
        >
          閉じる
        </button>

      </header>

      <div
        class="market-modal-body"
        id="market-hotel-modal-body"
      ></div>

    </section>
  `;

  document.body.appendChild(backdrop);

  backdrop
    .querySelector(".market-modal-close")
    .addEventListener(
      "click",
      closeMarketHotelModal
    );

  backdrop.addEventListener(
    "click",
    (event) => {
      if (event.target === backdrop) {
        closeMarketHotelModal();
      }
    }
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        backdrop.classList.contains("is-open")
      ) {
        closeMarketHotelModal();
      }
    }
  );
}


function renderMarketHotelModal() {
  const body =
    document.getElementById(
      "market-hotel-modal-body"
    );

  if (!body) return;

  const hotels =
    (marketMasterData.hotels || [])
      .filter(
        hotel => hotel.enabled !== false
      );

  if (!hotels.length) {
    body.innerHTML =
      "<p>追跡施設データを読み込めませんでした。</p>";

    return;
  }

  const cityOrder = [
    "たつの市",
    "相生市",
    "赤穂市",
    "姫路市"
  ];

  const cityLabel = {
    "たつの市": "たつの市",
    "相生市": "相生市",
    "赤穂市": "赤穂市",
    "姫路市": "姫路市（家島・坊勢）"
  };

  const grouped = new Map();

  hotels.forEach(
    (hotel) => {
      const city =
        hotel.city || "その他";

      if (!grouped.has(city)) {
        grouped.set(city, []);
      }

      grouped
        .get(city)
        .push(hotel);
    }
  );

  const orderedCities = [
    ...cityOrder.filter(
      city => grouped.has(city)
    ),

    ...[...grouped.keys()]
      .filter(
        city =>
          !cityOrder.includes(city)
      )
  ];

  const summaryHtml =
    orderedCities
      .map(
        (city) => {
          const count =
            grouped.get(city).length;

          return `
            <span>
              ${escapeHtml(
                cityLabel[city] || city
              )}
              ${count}施設
            </span>
          `;
        }
      )
      .join("");

  const groupsHtml =
    orderedCities
      .map(
        (city) => {

          const items =
            grouped.get(city);

          const hotelHtml =
            items
              .map(
                (hotel, index) => {

                  const zone =
                    hotel.zone
                      ? `
                        <span class="market-hotel-zone">
                          ${escapeHtml(
                            hotel.zone
                          )}
                        </span>
                      `
                      : "";

                  const hotelNo =
                    hotel.hotelNo
                      ? `
                        楽天施設No.
                        ${escapeHtml(
                          String(
                            hotel.hotelNo
                          )
                        )}
                      `
                      : "";

                  const address =
                    hotel.address
                      ? escapeHtml(
                          hotel.address
                        )
                      : "";

                  return `
                    <div class="market-hotel-item">

                      <p class="market-hotel-name">
                        ${index + 1}.
                        ${escapeHtml(
                          hotel.hotelName ||
                          "名称未登録"
                        )}
                      </p>

                      <div class="market-hotel-meta">
                        ${zone}
                        ${hotelNo}
                      </div>

                      ${
                        address
                          ? `
                            <div class="market-hotel-meta">
                              ${address}
                            </div>
                          `
                          : ""
                      }

                    </div>
                  `;
                }
              )
              .join("");

          return `
            <section class="market-city-group">

              <h3 class="market-city-title">

                ${escapeHtml(
                  cityLabel[city] ||
                  city
                )}

                <span class="market-city-count">
                  ${items.length}施設
                </span>

              </h3>

              <div class="market-hotel-list">
                ${hotelHtml}
              </div>

            </section>
          `;
        }
      )
      .join("");

  body.innerHTML = `
    <div class="market-modal-summary">
      ${summaryHtml}
    </div>

    ${groupsHtml}

    <p class="market-modal-note">
      ※ この追跡施設は現時点の市場候補です。
      今後、楽天トラベル上の販売状況や競合性を確認しながら、
      hotel_master_tatsuno.json の追加・除外を行えば、
      この一覧にも自動で反映されます。
    </p>
  `;
}


function openMarketHotelModal() {
  ensureMarketHotelModal();
  renderMarketHotelModal();

  const modal =
    document.getElementById(
      "market-hotel-modal"
    );

  if (!modal) return;

  modal.classList.add("is-open");
  modal.setAttribute(
    "aria-hidden",
    "false"
  );

  document.body.style.overflow =
    "hidden";

  const closeButton =
    modal.querySelector(
      ".market-modal-close"
    );

  if (closeButton) {
    closeButton.focus();
  }
}


function closeMarketHotelModal() {
  const modal =
    document.getElementById(
      "market-hotel-modal"
    );

  if (!modal) return;

  modal.classList.remove("is-open");

  modal.setAttribute(
    "aria-hidden",
    "true"
  );

  document.body.style.overflow =
    "";

  const countEl =
    document.getElementById(
      "market-count"
    );

  if (countEl) {
    countEl.focus();
  }
}


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


// 需要シンボル：2名基準の「残在庫 OR 平均単価」絶対値判定。
// 追跡42施設のうち、実際に楽天で販売中の施設数と2名1室平均価格で判定する。
// 大阪版と同じ思想で、相対比較ではなく「絶対的に強い日」を目立たせる。
function getAbsoluteDemandLevel(dateStr) {
  const base = getDemandBaseData(dateStr);
  const vacancy = Number(base.vacancy);
  const avgPrice = Number(base.avg_price);

  if (!(vacancy > 0) || !(avgPrice > 0)) return 0;

  if (vacancy <= 8  || avgPrice >= 60000) return 5;
  if (vacancy <= 10 || avgPrice >= 55000) return 4;
  if (vacancy <= 12 || avgPrice >= 50000) return 3;
  if (vacancy <= 14 || avgPrice >= 45000) return 2;
  if (vacancy <= 16 || avgPrice >= 40000) return 1;

  return 0;
}

// たつの版では1名/2名切替を廃止し、2名平均に固定する。=
// ========== 需要スパイク履歴バナー ==========
// サマリー：直近3日分×最大10件（※当日〜3日先は除外）
function renderSpikeBanner() {
  const bannerDiv = document.getElementById("spike-banner");
  if (!bannerDiv) return;

  if (!spikeData || Object.keys(spikeData).length === 0) {
    bannerDiv.innerHTML = "";
    return;
  }

  const EXCLUDE_NEAR_DAYS = 3; // 当日(0)〜3日先を除外
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  // JSTの「今日 00:00」
  const now = new Date();
  const jstNow = new Date(now.getTime() + (9 - now.getTimezoneOffset() / 60) * 60 * 60 * 1000);
  const jstToday = new Date(Date.UTC(
    jstNow.getUTCFullYear(),
    jstNow.getUTCMonth(),
    jstNow.getUTCDate(), 0, 0, 0
  ));

  const parseYMD = (ymd) => {
    const [y, m, d] = String(ymd).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  };

  const sortedDates = Object.keys(spikeData)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 3);

  let chips = [];

  for (const up_date of sortedDates) {
    for (const spike of spikeData[up_date]) {
      const spikeDate = spike.spike_date || "";
      if (!spikeDate) continue;

      const target = parseYMD(spikeDate);
      const daysAhead = Math.floor((target - jstToday) / MS_PER_DAY);
      if (daysAhead <= EXCLUDE_NEAR_DAYS) continue;

      const priceDiff = spike.price_diff || 0;
      const priceRatio = spike.price_ratio ? (spike.price_ratio * 100).toFixed(1) : "0";
      const price = spike.price ? spike.price.toLocaleString() : "-";
      const vacancyDiff = spike.vacancy_diff || 0;
      const vacancyRatio = spike.vacancy_ratio ? (spike.vacancy_ratio * 100).toFixed(1) : "0";
      const vacancy = spike.vacancy ? spike.vacancy.toLocaleString() : "-";

      const priceTxt = `<span class='spike-price ${priceDiff > 0 ? "up" : "down"}'>単価${priceDiff > 0 ? "↑" : "↓"} ${Math.abs(priceDiff).toLocaleString()}円</span>（${priceRatio}%）`;
      const vacTxt   = `<span class='spike-vacancy ${vacancyDiff < 0 ? "dec" : "inc"}'>客室${vacancyDiff < 0 ? "減" : "増"} ${Math.abs(vacancyDiff)}</span>（${vacancyRatio}%）`;

      chips.push(
        `<div class="spike-chip">
          <span class="spike-date">[${up_date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$2/$3 UP")}]</span>
          <span class="spike-main"><b>該当日 ${spikeDate}</b> ${priceTxt} ${vacTxt} <span class="spike-avg">平均￥${price}／残${vacancy}</span></span>
        </div>`
      );

      if (chips.length >= 10) break;
    }
    if (chips.length >= 10) break;
  }

  bannerDiv.innerHTML = chips.length
    ? `<div class="spike-banner-box">
         <span class="spike-banner-header">🚀 需要急騰検知日</span>
         <span class="spike-banner-meta">（直近3日・最大10件）</span>
         <div class="spike-chip-row">${chips.join("")}</div>
       </div>`
    : "";
}


// ========== 月送りボタン設定 ==========
function setupMonthButtons() {
  const prevBtn = document.getElementById("prevMonthBtn");
  const curBtn  = document.getElementById("currentMonthBtn");
  const nextBtn = document.getElementById("nextMonthBtn");
  if (prevBtn) prevBtn.onclick = () => { shiftMonth(-1); renderPage(); };
  if (curBtn)  curBtn.onclick  = () => { initMonth();   renderPage(); };
  if (nextBtn) nextBtn.onclick = () => { shiftMonth(1);  renderPage(); };
}
function initMonth() {
  const t = new Date(),
        y = t.getFullYear(),
        m = t.getMonth() + 1;
  currentYM = [[y, m], m === 12 ? [y+1,1] : [y, m+1]];
}
function shiftMonth(diff) {
  let [y,m] = currentYM[0];
  m += diff;
  if (m < 1)      { y--; m = 12; }
  else if (m > 12){ y++; m = 1;  }
  currentYM = [[y,m], m === 12 ? [y+1,1] : [y, m+1]];
}

// ========== ページ全体再描画 ==========
function renderPage() {
  const main = document.querySelector(".calendar-main");
  if (!main) return;

  const isMobile = window.innerWidth <= 700;
  if (isMobile) {
    main.innerHTML =
      '<div class="main-flexbox">' +
        '<div class="calendar-container" id="calendar-container"></div>' +
        '<div class="graph-side" id="graph-container"></div>' +
      '</div>';
  } else {
    main.innerHTML =
      '<div class="main-flexbox">' +
        '<div class="graph-side" id="graph-container"></div>' +
        '<div class="calendar-container" id="calendar-container"></div>' +
      '</div>';
  }

  // ① バナー
  renderSpikeBanner();

  // ② カレンダー（ここで #calendar-container を作り直す＝中身が空になる）
  renderCalendars();

  // ③ グラフ
  renderGraph(selectedDate);
}




// ========== カレンダー描画 ==========
function renderCalendars() {
  const container = document.getElementById("calendar-container");
  if (!container) return;
  container.innerHTML = "";
  for (const [y,m] of currentYM) {
    container.appendChild(renderMonth(y,m));
  }
}

function renderMonth(y,m) {
  const wrap = document.createElement("div");
  wrap.className = "month-calendar";
  wrap.innerHTML = `<div class="month-header">${y}年${m}月</div>`;

  const grid = document.createElement("div");
  grid.className = "calendar-grid";

  // 曜日ヘッダー
  ["日","月","火","水","木","金","土"].forEach(d => {
    const c = document.createElement("div");
    c.className = "calendar-dow";
    c.textContent = d;
    grid.appendChild(c);
  });

  // 空セル
  const firstDay = new Date(y,m-1,1).getDay(),
        lastDate = new Date(y,m,0).getDate();
  for (let i=0; i<firstDay; i++){
    const e = document.createElement("div");
    e.className = "calendar-cell";
    grid.appendChild(e);
  }

  // 各日セル
  for (let d=1; d<=lastDate; d++){
    const iso = y + '-' + String(m).padStart(2,"0") + '-' + String(d).padStart(2,"0");
    const cell = document.createElement("div");
    cell.className = "calendar-cell";
    cell.dataset.date = iso;
    if (selectedDate === iso) cell.classList.add("selected");
  

    // 祝日判定
    let holidayName = isHoliday(iso);

    // 土日祝色分け
    const idx = (grid.children.length) % 7;
    if      (holidayName) cell.classList.add("holiday-bg");
    else if (idx === 0)   cell.classList.add("sunday-bg");
    else if (idx === 6)   cell.classList.add("saturday-bg");

    // 過去日付グレーアウト
    if (iso < todayIso()) cell.classList.add("past-date");

    // データ取得＆差分
    const cur = getDisplayData(iso);
    const prv = prevData[iso] || {};
    const isArchiveOnly = !calendarData[iso] && !!finalArchiveData[iso];

    const dv = isArchiveOnly
      ? 0
      : (typeof cur.vacancy_diff === "number"
          ? cur.vacancy_diff
          : (cur.vacancy || 0) - (prv.vacancy || 0));

    const dp = isArchiveOnly
      ? 0
      : (typeof cur.avg_price_diff === "number"
          ? cur.avg_price_diff
          : Math.round((cur.avg_price || 0) - (prv.avg_price || 0)));

    const stock = cur.vacancy != null ? `${cur.vacancy}件` : "-";
    const price = cur.avg_price != null ? Number(cur.avg_price).toLocaleString() : "-";

    // 括弧付き差分テキスト
    const dvText = dv > 0 ? `(+${dv})` : dv < 0 ? `(${dv})` : `(±0)`;

    // 需要シンボル（2名基準）。残在庫または平均単価の絶対値で判定。
    const lvl = getAbsoluteDemandLevel(iso);
    const badge = lvl ? `<div class="cell-demand-badge lv${lvl}">🔥${lvl}</div>` : "";

    // イベント
    const evs = (eventData[iso] || [])
      .map(ev => `<a href="https://www.google.com/search?q=${encodeURIComponent(ev.name)}" target="_blank" title="「${ev.name}」について調べる" class="event-link">
                    ${ev.icon}${ev.name}
                  </a>`)
      .join("");

    cell.innerHTML =
      `<div class="cell-date">${d}</div>` +
      `<div class="cell-main">
        <span class="cell-vacancy">${stock}</span>
        <span class="cell-vacancy-diff ${(dv>0?'plus':dv<0?'minus':'flat')}">${dvText}</span>
      </div>` +
      `<div class="cell-price">
        ￥${price}
        <span class="cell-price-diff ${(dp>0?'up':dp<0?'down':'flat')}">${dp>0?'↑':dp<0?'↓':'→'}</span>
      </div>` +
      badge +
      `<div class="cell-event-list">${evs}</div>`;

    cell.onclick = () => { selectedDate = iso; renderPage(); };
    grid.appendChild(cell);
  }

  wrap.appendChild(grid);
  return wrap;
}

// ========== グラフ描画 ==========
function renderGraph(dateStr){
  const gc = document.getElementById("graph-container");
  if (!gc) return;

  // 既存チャートの破棄
  if (window.sc) { try { window.sc.destroy(); } catch(e){} window.sc = null; }
  if (window.pc) { try { window.pc.destroy(); } catch(e){} window.pc = null; }

  if (!dateStr) { gc.innerHTML = ""; return; }

  // 前年同月・同曜日・第N週の比較対象日を計算
  function getComparisonDate(src) {
    try {
      const d = new Date(src);
      const year = d.getFullYear();
      const month = d.getMonth();
      const dayOfWeek = d.getDay();
      const date = d.getDate();
      const nth = Math.floor((date - 1) / 7);
      const prevYear = year - 1;
      let count = 0;
      let candidate = null;

      for (let i = 1; i <= 31; i++) {
        const dt = new Date(Date.UTC(prevYear, month, i));
        if (dt.getMonth() !== month) break;
        if (dt.getUTCDay() === dayOfWeek) {
          if (count === nth) {
            candidate = dt;
            break;
          }
          count++;
        }
      }

      if (!candidate) {
        const occurrences = [];
        for (let i = 1; i <= 31; i++) {
          const dt = new Date(Date.UTC(prevYear, month, i));
          if (dt.getMonth() !== month) break;
          if (dt.getUTCDay() === dayOfWeek) occurrences.push(dt);
        }
        if (occurrences.length) {
          candidate = occurrences[Math.min(nth, occurrences.length - 1)];
        }
      }

      if (!candidate) return null;
      const y = candidate.getUTCFullYear();
      const m = String(candidate.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(candidate.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${dd}`;
    } catch {
      return null;
    }
  }

  // 当日・比較日のデータ取得
  const compDate = getComparisonDate(dateStr);
  const curData = getDisplayData(dateStr) || {};
  const cmpData = compDate ? getDisplayData(compDate) || {} : {};
  const curVacancy = curData.vacancy != null ? Number(curData.vacancy) : null;
  const curPrice   = curData.avg_price != null ? Number(curData.avg_price)   : null;
  const cmpVacancy = cmpData.vacancy != null ? Number(cmpData.vacancy) : null;
  const cmpPrice   = cmpData.avg_price != null ? Number(cmpData.avg_price)   : null;

  // 差分計算
  const diffVacancy = (curVacancy != null && cmpVacancy != null) ? curVacancy - cmpVacancy : null;
  const diffPrice   = (curPrice   != null && cmpPrice   != null) ? curPrice   - cmpPrice   : null;

  const dow = ["日","月","火","水","木","金","土"];
  const curDow = dow[new Date(dateStr).getDay()];
  const cmpDow = compDate ? dow[new Date(compDate).getDay()] : null;

  // 比較情報HTML生成
  let compareHtml = '';
  if (curVacancy != null || curPrice != null) {
    compareHtml += `<div class="compare-info">`;
    compareHtml += `<h4>昨対比較</h4>`;
    compareHtml += `<div class="compare-row"><span class="label">対象日：</span><span>${dateStr}（${curDow}）</span></div>`;
    compareHtml += `<div class="compare-row"><span class="label">今年在庫数：</span><span>${curVacancy != null ? curVacancy.toLocaleString() : "-"}</span></div>`;
    compareHtml += `<div class="compare-row"><span class="label">今年平均価格：</span><span>${curPrice != null ? "￥" + curPrice.toLocaleString() : "-"}</span></div>`;
    compareHtml += `<div class="compare-row"><span class="label">比較対象：</span><span>${compDate ? `${compDate}（${cmpDow}）` : "—"}</span></div>`;

    // 昨年在庫
    let lastVacancyText = "—";
    if (cmpVacancy != null) {
      let gap = "";
      if (diffVacancy != null) {
        const cls = diffVacancy > 0 ? "diff-pos" : diffVacancy < 0 ? "diff-neg" : "";
        const val = `${diffVacancy > 0 ? "+" : diffVacancy < 0 ? "" : "±"}${Math.abs(diffVacancy).toLocaleString()}`;
        gap = ` <span class="${cls}">（${val}）</span>`;
      }
      lastVacancyText = `${cmpVacancy.toLocaleString()}${gap}`;
    }
    compareHtml += `<div class="compare-row"><span class="label">昨年最終在庫数：</span><span>${lastVacancyText}</span></div>`;

    // 昨年価格
    let lastPriceText = "—";
    if (cmpPrice != null) {
      let gap = "";
      if (diffPrice != null) {
        const cls = diffPrice > 0 ? "price-neg" : diffPrice < 0 ? "price-pos" : "";
        const val = `${diffPrice > 0 ? "-" : diffPrice < 0 ? "+" : "±"}￥${Math.abs(diffPrice).toLocaleString()}`;
        gap = ` <span class="${cls}">（${val}）</span>`;
      }
      lastPriceText = `￥${cmpPrice.toLocaleString()}${gap}`;
    }
    compareHtml += `<div class="compare-row"><span class="label">昨年最終価格：</span><span>${lastPriceText}</span></div>`;
    compareHtml += `</div>`;
  }

  // 全日付リストとインデックス
  const allDates = Object.keys(historicalData).sort();
  const idx = allDates.indexOf(dateStr);

  // HTML描画
  gc.innerHTML =
    (compareHtml || '') +
    '<div class="graph-btns">' +
      '<button onclick="closeGraph()"> 当日へ戻る</button>' +
      '<button onclick="nav(-1)">< 前日</button>' +
      '<button onclick="nav(1)">翌日 ></button>' +
    '</div>' +
    `<h3>${dateStr} の在庫・価格推移</h3>` +
    '<div class="chart-wrap"><canvas id="stockChart"></canvas></div>' +
    '<div class="chart-wrap"><canvas id="priceChart"></canvas></div>';

  // ナビゲーション関数
  window.nav = diff => {
    const ni = idx + diff;
    if (ni >= 0 && ni < allDates.length) {
      selectedDate = allDates[ni];
      renderPage();
    }
  };
  window.closeGraph = () => {
    selectedDate = todayIso();
    renderPage();
  };

  // 履歴データ取得
  const hist = historicalData[dateStr] || {};
  const labels = [];
  const sv = [];
  const pv = [];
  Object.keys(hist).sort().forEach(d => {
    labels.push(d);
    sv.push(hist[d].vacancy);
    pv.push(hist[d].avg_price);
  });

  // 履歴がない場合の表示
  if (!labels.length) {
    const archived = finalArchiveData[dateStr];
    if (archived) {
      gc.innerHTML =
        (compareHtml || '') +
        '<div class="graph-btns"><button onclick="closeGraph()"> 当日へ戻る</button></div>' +
        `<h3>${dateStr} の最終確定値</h3>` +
        `<div class="archive-summary-box">
          <div class="archive-summary-row"><b>残室数：</b>${Number(archived.vacancy || 0).toLocaleString()}件</div>
          <div class="archive-summary-row"><b>平均価格：</b>￥${Number(archived.avg_price || 0).toLocaleString()}</div>
          <div class="archive-summary-note">この日付は長期保存データのみのため、推移グラフは表示されません。</div>
        </div>`;
    } else {
      gc.innerHTML =
        (compareHtml || '') +
        '<div class="graph-btns"><button onclick="closeGraph()"> 当日へ戻る</button></div>' +
        `<h3>${dateStr} の昨対比較</h3>` +
        `<div class="archive-summary-box">
          <div class="archive-summary-note">この日付はまだ推移グラフの履歴データがないため、昨対比較のみ表示しています。</div>
        </div>`;
    }
    return;
  }

  // 在庫グラフ
// 在庫グラフ用の縦軸レンジを動的計算
const stockNums = sv.filter(v => typeof v === "number" && isFinite(v));
let stockMin = 50;
let stockMax = 350;
if (stockNums.length) {
  const minv = Math.min(...stockNums);
  const maxv = Math.max(...stockNums);
  const spread = maxv - minv;
  const pad = Math.max(8, Math.ceil(spread * 0.15));
  stockMin = Math.max(0, Math.floor((minv - pad) / 10) * 10);
  stockMax = Math.ceil((maxv + pad) / 10) * 10;

  if (stockMax - stockMin < 40) {
    const center = (minv + maxv) / 2;
    stockMin = Math.max(0, Math.floor((center - 20) / 10) * 10);
    stockMax = Math.ceil((center + 20) / 10) * 10;
  }
}

// 在庫グラフ
window.sc = new Chart(
  document.getElementById("stockChart").getContext("2d"),
  {
    type: "line",
    data: {
      labels,
      datasets: [{ data: sv, fill: false, borderColor: "#2196f3", pointRadius: 2, hitRadius: 12, hoverRadius: 6 }]
    },
    options: {
      interaction: {
        mode: "nearest",
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          padding: 14,
          caretPadding: 8,
          titleFont: { size: 15, weight: "bold" },
          bodyFont: { size: 14 },
          callbacks: {
            title: (ctx) => ctx[0]?.label || "",
            label: (ctx) => `在庫数：${Number(ctx.parsed.y).toLocaleString()}`
          }
        }
      },
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        y: {
          beginAtZero: false,
          min: stockMin,
          max: stockMax,
          title: { display: true, text: "在庫数" }
        },
        x: {
          title: { display: true, text: "日付" },
          ticks: {
            autoSkip: true,
            maxTicksLimit: 8,
            maxRotation: 0,
            minRotation: 0,
            callback: function(value) {
              const label = this.getLabelForValue(value);
              return typeof label === "string" ? label.slice(5) : label;
            }
          }
        }
      }
    }
  }
);

  // 価格グラフ（市場平均のみ）
  const nums = pv.filter(v => typeof v === "number" && isFinite(v) && v > 0);
  let ymin = 0, ymax = 30000;
  if (nums.length) {
    const minv = Math.min(...nums);
    const maxv = Math.max(...nums);
    const spread = maxv - minv;
    const pad = Math.max(2000, Math.ceil(spread * 0.15));
    ymin = Math.max(0, Math.floor((minv - pad) / 1000) * 1000);
    ymax = Math.ceil((maxv + pad) / 1000) * 1000;
    if (ymax - ymin < 10000) ymax = ymin + 10000;
  }
  const priceDatasets = [
    { label: "市場平均", data: pv, fill: false, borderColor: "#e91e63", pointRadius: 2, hitRadius: 12, hoverRadius: 6 }
  ];

  window.pc = new Chart(
    document.getElementById("priceChart").getContext("2d"),
    {
      type: "line",
      data: { labels, datasets: priceDatasets },
      options: {
        interaction: {
          mode: "nearest",
          intersect: false
        }, 
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            padding: 14,
            caretPadding: 8,
            titleFont: { size: 15, weight: "bold" },
            bodyFont: { size: 14 },
            callbacks: {
              title: (ctx) => ctx[0]?.label || "",
              label: (ctx) => {
                const datasetLabel = ctx.dataset.label || "";
                return `${datasetLabel}：￥${Number(ctx.parsed.y).toLocaleString()}`;
              }
            }
          }
        },
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        spanGaps: true,
        scales: {
          y: {
            beginAtZero: false,
            min: ymin,
            max: ymax,
            title: { display: true, text: "平均価格（円）" }
          },
          x: {
            title: { display: true, text: "日付" },
            ticks: {
              autoSkip: true,
              maxTicksLimit: 8,
              maxRotation: 0,
              minRotation: 0,
              callback: function(value) {
                const label = this.getLabelForValue(value);
                return typeof label === "string" ? label.slice(5) : label;
              }
            }
          }
        }
      }
    }
  );
}


// ========== 最終更新日時（Actions完了時刻を表示） ==========
function updateLastUpdate(){
  const el = document.getElementById("last-update");
  if (!el) return;

  fetch(LASTUPDATED_PATH + "?cb=" + Date.now())
    .then(r => r.ok ? r.json() : Promise.reject("fetch failed"))
    .then(meta => {
      const jst = meta.last_updated_jst || meta.last_updated_iso || "—";
      el.textContent = `最終更新日時：${jst}`;
      const tips = [];
      if (meta.last_updated_iso) tips.push(`ISO: ${meta.last_updated_iso}`);
      if (meta.git_sha)          tips.push(`SHA: ${meta.git_sha}`);
      if (meta.source)           tips.push(`src: ${meta.source}`);
      el.title = tips.join("\n");
    })
    .catch(() => {
      el.textContent = "最終更新日時：—";
      el.title = "last_updated.json の取得に失敗しました";
    });
}

// ========== 起動時初期化 ==========
window.onload = async () => {
  await loadAll();
  initMonth();
  if (!selectedDate) selectedDate = todayIso();
  renderPage();
  updateLastUpdate();
  setupMonthButtons();
  window.addEventListener('resize', () => { renderPage(); });
};
