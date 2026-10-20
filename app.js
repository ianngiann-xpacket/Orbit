(function () {
  "use strict";

  var STORAGE_KEY = "orbit.v3";
  var SORT_KEY = "orbit.sort";
  var DAY_MS = 24 * 60 * 60 * 1000;
  var ATTENTION_DAYS = 30; // 30–89일: 관심 필요
  var COLD_DAYS = 90; // 90일 이상 또는 기록 없음: 연락 끊김
  var WIDE = window.matchMedia("(min-width: 1024px)");

  document.documentElement.lang = "ko";

  // ---------- Dates ----------

  function toISO(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function parseISO(iso) {
    var p = iso.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function today() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function todayISO() {
    return toISO(today());
  }

  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  // Weeks run Monday to Sunday.
  function endOfWeekISO() {
    var t = today();
    return toISO(addDays(t, (7 - t.getDay()) % 7));
  }

  function daysBetween(fromISO, toISOValue) {
    return Math.round((parseISO(toISOValue) - parseISO(fromISO)) / DAY_MS);
  }

  function relative(iso) {
    var days = Math.max(0, daysBetween(iso, todayISO()));
    if (days === 0) return "오늘";
    if (days === 1) return "어제";
    if (days < 7) return days + "일 전";
    if (days < 30) return Math.floor(days / 7) + "주 전";
    if (days < 365) return Math.floor(days / 30) + "개월 전";
    return Math.floor(days / 365) + "년 전";
  }

  function upcoming(iso) {
    var days = daysBetween(todayISO(), iso);
    if (days === 0) return "오늘";
    if (days === 1) return "내일";
    if (days < 0) return -days + "일 지남";
    return days + "일 후";
  }

  function formatDate(iso) {
    var d = parseISO(iso);
    var md = d.getMonth() + 1 + "월 " + d.getDate() + "일";
    return d.getFullYear() === today().getFullYear() ? md : d.getFullYear() + "년 " + md;
  }

  function formatLongToday() {
    var d = today();
    var days = ["일", "월", "화", "수", "목", "금", "토"];
    return d.getFullYear() + "년 " + (d.getMonth() + 1) + "월 " + d.getDate() + "일 " + days[d.getDay()] + "요일";
  }

  // ---------- Data ----------
  // category: { id, name }
  // person:   { id, name, company, categoryId, followUp: "YYYY-MM-DD" | "", sample, log: [{ id, date, text }] }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function makeSamples() {
    var src = window.ORBIT_SAMPLE || { categories: [], people: [] };
    var t = today();
    var categories = src.categories.map(function (name) { return { id: newId(), name: name }; });
    function categoryId(name) {
      var c = categories.find(function (x) { return x.name === name; });
      return c ? c.id : "";
    }
    var people = src.people.map(function (s) {
      return {
        id: newId(),
        name: s.name,
        company: s.company,
        categoryId: categoryId(s.category),
        followUp: s.followUpIn == null ? "" : toISO(addDays(t, s.followUpIn)),
        sample: true,
        log: s.log.map(function (e) {
          return { id: newId(), date: toISO(addDays(t, -e.daysAgo)), text: e.text };
        })
      };
    });
    return { categories: categories, people: people };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && Array.isArray(data.people) && Array.isArray(data.categories)) return data;
      }
    } catch (e) {}
    return makeSamples();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ categories: state.categories, people: state.people }));
    } catch (e) {}
  }

  function loadSort() {
    try {
      var s = localStorage.getItem(SORT_KEY);
      if (s === "recent" || s === "oldest" || s === "name") return s;
    } catch (e) {}
    return "recent";
  }

  var initial = load();
  var state = {
    categories: initial.categories,
    people: initial.people,
    category: "all",
    filter: null,
    query: "",
    sort: loadSort(),
    openId: null,
    editingEntry: null,
    confirming: null,
    addingCategory: false,
    confirmingClear: false
  };

  function find(id) {
    return state.people.find(function (p) { return p.id === id; });
  }

  function categoryName(id) {
    var c = state.categories.find(function (x) { return x.id === id; });
    return c ? c.name : "";
  }

  // Newest first; entries on the same day keep the order they were added in, newest on top.
  function sortedLog(p) {
    return p.log
      .map(function (e, i) { return { e: e, i: i }; })
      .sort(function (a, b) { return b.e.date.localeCompare(a.e.date) || b.i - a.i; })
      .map(function (x) { return x.e; });
  }

  function latest(p) {
    return p.log.length ? sortedLog(p)[0] : null;
  }

  function daysSinceLast(p) {
    var last = latest(p);
    return last ? Math.max(0, daysBetween(last.date, todayISO())) : null;
  }

  var FILTERS = {
    attention: function (p) {
      var d = daysSinceLast(p);
      return d !== null && d >= ATTENTION_DAYS && d < COLD_DAYS;
    },
    cold: function (p) {
      var d = daysSinceLast(p);
      return d === null || d >= COLD_DAYS;
    },
    follow: function (p) {
      return !!p.followUp && p.followUp <= endOfWeekISO();
    }
  };

  // ---------- Helpers ----------

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function initials(name) {
    var n = (name || "").trim();
    if (!n) return "?";
    if (/^[A-Za-z]/.test(n)) {
      return n.split(/\s+/).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join("");
    }
    return n[0];
  }

  function autoGrow(el) {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + 2 + "px";
  }

  // ---------- Icons ----------

  function svg(body, viewBox) {
    return '<svg viewBox="' + (viewBox || "0 0 20 20") + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + "</svg>";
  }

  var ICON = {
    orbit:
      '<svg viewBox="0 0 26 26" fill="none" aria-hidden="true">' +
      '<circle cx="13" cy="13" r="3.2" fill="currentColor"/>' +
      '<ellipse cx="13" cy="13" rx="11" ry="5.2" transform="rotate(-24 13 13)" stroke="currentColor" stroke-width="1.4" opacity="0.55"/>' +
      '<circle cx="22.4" cy="9" r="1.8" fill="currentColor"/></svg>',
    people: svg('<circle cx="7.5" cy="7" r="2.8"/><path d="M2.5 16c.6-2.8 2.6-4.2 5-4.2s4.4 1.4 5 4.2"/><circle cx="14" cy="7.5" r="2.2"/><path d="M14 11.8c1.9 0 3.3 1.1 3.7 3.4"/>'),
    tag: svg('<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="2" fill="currentColor" stroke="none"/>'),
    plus: svg('<path d="M10 4.5v11M4.5 10h11"/>'),
    compose: svg('<path d="M10 4.5v11M4.5 10h11"/>'),
    search: svg('<circle cx="8.5" cy="8.5" r="5"/><path d="M12.5 12.5l4 4"/>'),
    clock: svg('<circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 2"/>'),
    cold: svg('<path d="M10 2.5v15M3.5 6.25l13 7.5M3.5 13.75l13-7.5"/><path d="M8 4l2 1.5L12 4M8 16l2-1.5 2 1.5"/>'),
    calendar: svg('<rect x="3" y="4.5" width="14" height="12.5" rx="2.5"/><path d="M3 8.5h14M7 2.75v3.5M13 2.75v3.5"/>'),
    close: svg('<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>'),
    back: svg('<path d="M12.5 4.5L7 10l5.5 5.5"/>'),
    person: svg('<circle cx="10" cy="7" r="3.2"/><path d="M3.8 17c.8-3.3 3.2-5 6.2-5s5.4 1.7 6.2 5"/>')
  };

  var CARDS = [
    { key: "attention", cls: "attention", icon: ICON.clock, label: "관심 필요", cap: "마지막 연락이 " + ATTENTION_DAYS + "–" + (COLD_DAYS - 1) + "일 전" },
    { key: "cold", cls: "cold", icon: ICON.cold, label: "연락 끊김", cap: COLD_DAYS + "일 넘게 연락이 없거나 기록 없음" },
    { key: "follow", cls: "follow", icon: ICON.calendar, label: "이번 주 후속 연락", cap: "다음 연락 예정일이 이번 주 일요일까지" }
  ];

  // ---------- Shell ----------

  document.getElementById("app").innerHTML =
    '<div class="shell">' +
    '  <aside class="sidebar" aria-label="카테고리">' +
    '    <h1 class="wordmark">' + ICON.orbit + "Orbit</h1>" +
    '    <nav class="nav">' +
    '      <div class="nav-title">카테고리</div>' +
    '      <ul class="nav-list" id="nav"></ul>' +
    "    </nav>" +
    '    <div class="sidebar-foot" id="sidebar-foot"></div>' +
    "  </aside>" +
    '  <div class="main">' +
    '    <header class="main-head">' +
    '      <p class="eyebrow" id="today"></p>' +
    '      <h2 class="main-title" id="main-title"></h2>' +
    '      <div class="cards" id="cards"></div>' +
    "    </header>" +
    '    <div class="split">' +
    '      <section class="listpane" aria-label="사람 목록">' +
    '        <div class="list-head">' +
    '          <div class="list-title-row">' +
    '            <h3 class="list-title" id="list-title"></h3>' +
    '            <button type="button" class="icon-btn" id="add-person" title="사람 추가" aria-label="사람 추가">' + ICON.plus + "</button>" +
    "          </div>" +
    '          <div id="filter-chip-slot"></div>' +
    '          <label class="search">' + ICON.search +
    '            <input type="search" id="search" placeholder="검색" autocomplete="off" aria-label="이름, 회사, 기록 검색">' +
    "          </label>" +
    '          <div class="sort-row"><label for="sort">정렬</label>' +
    '            <select id="sort">' +
    '              <option value="recent">최근 연락 순</option>' +
    '              <option value="oldest">오래된 순</option>' +
    '              <option value="name">이름 순</option>' +
    "            </select></div>" +
    "        </div>" +
    '        <div class="list-scroll" id="list"></div>' +
    "      </section>" +
    '      <section class="profile" id="profile" aria-label="프로필">' +
    '        <div class="profile-empty" id="profile-empty">' + ICON.person +
    "          <strong>사람을 선택하세요</strong>" +
    "          <span>목록에서 이름을 누르면 프로필과 연락 기록이 여기에 열립니다.</span>" +
    "        </div>" +
    '        <div id="profile-content" hidden>' +
    '          <div class="profile-bar"><button type="button" class="back" id="back">' + ICON.back + "목록</button></div>" +
    '          <div class="profile-inner">' +
    '            <div class="identity">' +
    '              <div class="avatar" id="p-avatar"></div>' +
    '              <div class="identity-fields">' +
    '                <input class="field-input field-name" id="f-name" placeholder="이름" autocomplete="off" aria-label="이름">' +
    '                <input class="field-input field-company" id="f-company" placeholder="회사 · 직함" autocomplete="off" aria-label="회사">' +
    '                <p class="last-line" id="p-last"></p>' +
    "              </div>" +
    "            </div>" +
    '            <ul class="details">' +
    '              <li class="detail"><label for="f-category">카테고리</label>' +
    '                <span class="detail-value"><select id="f-category"></select></span></li>' +
    '              <li class="detail"><label for="f-follow">다음 연락 예정</label>' +
    '                <span class="detail-value"><span class="label" id="follow-rel"></span>' +
    '                  <input type="date" id="f-follow">' +
    '                  <button type="button" class="btn-link muted" id="follow-clear">지우기</button></span></li>' +
    "            </ul>" +
    '            <form class="composer" id="composer">' +
    '              <label class="label" for="new-text">새 연락 기록</label>' +
    '              <textarea id="new-text" rows="2" placeholder="어떤 이야기를 나눴나요?"></textarea>' +
    '              <div class="composer-row">' +
    '                <input type="date" id="new-date" aria-label="연락한 날짜">' +
    '                <button type="submit" class="btn btn-primary">기록 추가</button>' +
    "              </div>" +
    "            </form>" +
    '            <section class="history">' +
    '              <h4 class="label" id="history-title"></h4>' +
    '              <ol class="timeline" id="timeline"></ol>' +
    "            </section>" +
    '            <div class="danger-zone" id="danger-zone"></div>' +
    "          </div>" +
    "        </div>" +
    "      </section>" +
    "    </div>" +
    "  </div>" +
    "</div>";

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    nav: $("nav"),
    foot: $("sidebar-foot"),
    today: $("today"),
    mainTitle: $("main-title"),
    cards: $("cards"),
    listTitle: $("list-title"),
    chipSlot: $("filter-chip-slot"),
    search: $("search"),
    sort: $("sort"),
    list: $("list"),
    profile: $("profile"),
    empty: $("profile-empty"),
    content: $("profile-content"),
    avatar: $("p-avatar"),
    name: $("f-name"),
    company: $("f-company"),
    last: $("p-last"),
    category: $("f-category"),
    follow: $("f-follow"),
    followRel: $("follow-rel"),
    followClear: $("follow-clear"),
    composer: $("composer"),
    newText: $("new-text"),
    newDate: $("new-date"),
    historyTitle: $("history-title"),
    timeline: $("timeline"),
    danger: $("danger-zone")
  };

  // ---------- Views ----------

  function inCategory(p) {
    return state.category === "all" || p.categoryId === state.category;
  }

  function currentCategoryName() {
    return state.category === "all" ? "모든 사람" : categoryName(state.category) || "모든 사람";
  }

  function renderSidebar() {
    var items = [{ id: "all", name: "모든 사람", icon: ICON.people, count: state.people.length }].concat(
      state.categories.map(function (c) {
        return {
          id: c.id,
          name: c.name,
          icon: ICON.tag,
          count: state.people.filter(function (p) { return p.categoryId === c.id; }).length
        };
      })
    );
    var html = items.map(function (it) {
      return (
        '<li><button type="button" class="nav-item" data-category="' + esc(it.id) + '" aria-current="' + (state.category === it.id) + '">' +
        it.icon + '<span class="nav-name">' + esc(it.name) + '</span><span class="nav-count">' + it.count + "</span></button></li>"
      );
    }).join("");
    html += state.addingCategory
      ? '<li><input class="nav-input" id="new-category" placeholder="카테고리 이름" aria-label="새 카테고리 이름" maxlength="24"></li>'
      : '<li><button type="button" class="nav-add" data-action="add-category">' + ICON.plus + "새 카테고리</button></li>";
    els.nav.innerHTML = html;

    var hasSamples = state.people.some(function (p) { return p.sample; });
    els.foot.innerHTML = !hasSamples
      ? ""
      : state.confirmingClear
        ? "<span>예시 인물을 모두 지울까요?</span>" +
          '<span class="row-actions"><button type="button" class="btn-link danger" data-action="clear-confirm">지우기</button>' +
          '<button type="button" class="btn-link" data-action="clear-cancel">취소</button></span>'
        : "<span>지금 보이는 사람들은 예시입니다.</span>" +
          '<span class="row-actions"><button type="button" class="btn-link" data-action="clear-ask">예시 지우고 시작하기</button></span>';

    var input = $("new-category");
    if (input) input.focus();
  }

  function renderHead() {
    els.today.textContent = formatLongToday();
    els.mainTitle.textContent = currentCategoryName();
    var pool = state.people.filter(inCategory);
    els.cards.innerHTML = CARDS.map(function (c) {
      var n = pool.filter(FILTERS[c.key]).length;
      return (
        '<button type="button" class="card ' + c.cls + '" data-filter="' + c.key + '" aria-pressed="' + (state.filter === c.key) + '">' +
        '<span class="card-top"><span class="card-icon">' + c.icon + '</span><span class="card-label">' + c.label + "</span></span>" +
        '<span class="card-num">' + n + '<span class="unit">명</span></span>' +
        '<span class="card-cap">' + c.cap + "</span></button>"
      );
    }).join("");
  }

  function compare(a, b) {
    var la = latest(a), lb = latest(b);
    var da = la ? la.date : "", db = lb ? lb.date : "";
    var byName = (a.name || "").localeCompare(b.name || "", "ko");
    if (state.sort === "name") return byName;
    if (state.sort === "oldest") return da.localeCompare(db) || byName;
    return db.localeCompare(da) || byName;
  }

  function visiblePeople() {
    var q = state.query.trim().toLowerCase();
    return state.people
      .filter(inCategory)
      .filter(function (p) { return !state.filter || FILTERS[state.filter](p); })
      .filter(function (p) {
        if (!q) return true;
        var hay = [p.name, p.company].concat(p.log.map(function (e) { return e.text; })).join(" ").toLowerCase();
        return hay.indexOf(q) !== -1;
      })
      .sort(compare);
  }

  function rowHTML(p) {
    var last = latest(p);
    var preview = last ? last.text.replace(/\s+/g, " ").trim() : "";
    return (
      '<li><button type="button" class="row" data-id="' + esc(p.id) + '" aria-current="' + (state.openId === p.id) + '">' +
      '<span class="avatar" aria-hidden="true">' + esc(initials(p.name)) + "</span>" +
      '<span class="row-body">' +
      '<span class="row-top"><span class="name">' + esc(p.name || "이름 없음") + "</span>" +
      '<span class="when">' + (last ? relative(last.date) : "기록 없음") + "</span></span>" +
      '<span class="company">' + esc(p.company || "회사 정보 없음") + "</span>" +
      '<span class="preview' + (preview ? "" : " empty") + '">' + esc(preview || "아직 연락 기록이 없어요") + "</span>" +
      "</span></button></li>"
    );
  }

  function renderList() {
    var people = visiblePeople();
    els.listTitle.innerHTML = esc(currentCategoryName()) + '<span class="count">' + people.length + "</span>";

    var card = CARDS.find(function (c) { return c.key === state.filter; });
    els.chipSlot.innerHTML = card
      ? '<button type="button" class="filter-chip" data-action="clear-filter" aria-label="' + card.label + ' 필터 해제">' +
        card.label + ICON.close + "</button>"
      : "";

    if (!state.people.length) {
      els.list.innerHTML =
        '<div class="list-empty"><strong>아직 아무도 없어요</strong>위의 ＋ 버튼을 눌러 첫 번째 사람을 추가해 보세요.</div>';
    } else if (!people.length) {
      var why = state.query.trim()
        ? "‘" + esc(state.query.trim()) + "’와 일치하는 사람이 없어요"
        : card
          ? "‘" + card.label + "’에 해당하는 사람이 없어요"
          : "이 카테고리에 아직 아무도 없어요";
      els.list.innerHTML = '<div class="list-empty"><strong>' + why + "</strong>필터나 검색어를 바꿔 보세요.</div>";
    } else {
      els.list.innerHTML = '<ul class="list">' + people.map(rowHTML).join("") + "</ul>";
    }
  }

  function renderAll() {
    renderSidebar();
    renderHead();
    renderList();
    renderProfile();
  }

  // ---------- Profile ----------

  function renderProfileStatus(p) {
    var last = latest(p);
    els.avatar.textContent = initials(p.name);
    els.last.innerHTML = last
      ? "마지막 연락 <strong>" + relative(last.date) + "</strong> · " + formatDate(last.date)
      : "아직 연락 기록이 없어요";
    els.followRel.textContent = p.followUp ? upcoming(p.followUp) : "";
    els.followClear.hidden = !p.followUp;
  }

  function entryHTML(e) {
    if (state.editingEntry === e.id) {
      return (
        '<li class="entry editing" data-entry="' + esc(e.id) + '">' +
        '<textarea class="edit-text" rows="3" aria-label="기록 내용">' + esc(e.text) + "</textarea>" +
        '<div class="composer-row">' +
        '<input type="date" class="edit-date" value="' + esc(e.date) + '" max="' + todayISO() + '" aria-label="날짜">' +
        '<span class="entry-actions">' +
        '<button type="button" class="btn btn-quiet" data-action="edit-cancel">취소</button>' +
        '<button type="button" class="btn btn-primary" data-action="edit-save">저장</button>' +
        "</span></div></li>"
      );
    }
    var confirming = state.confirming === "entry:" + e.id;
    return (
      '<li class="entry" data-entry="' + esc(e.id) + '">' +
      '<div class="entry-head"><span class="entry-date">' + formatDate(e.date) +
      ' <span class="entry-rel">· ' + relative(e.date) + "</span></span>" +
      '<span class="entry-actions' + (confirming ? " show" : "") + '">' +
      (confirming
        ? '<span class="entry-ask">이 기록을 삭제할까요?</span>' +
          '<button type="button" class="btn-link danger" data-action="entry-delete-confirm">삭제</button>' +
          '<button type="button" class="btn-link" data-action="entry-delete-cancel">취소</button>'
        : '<button type="button" class="btn-link" data-action="edit">수정</button>' +
          '<button type="button" class="btn-link muted" data-action="entry-delete-ask">삭제</button>') +
      "</span></div>" +
      '<p class="entry-text">' + esc(e.text) + "</p></li>"
    );
  }

  function renderTimeline(p) {
    var log = sortedLog(p);
    els.historyTitle.textContent = log.length ? "연락 기록 " + log.length + "건" : "연락 기록";
    els.timeline.innerHTML = log.length
      ? log.map(entryHTML).join("")
      : '<li class="timeline-empty">위에 첫 기록을 남겨보세요. 언제 연락했고 어떤 이야기를 나눴는지 적어두면 됩니다.</li>';
    var editing = els.timeline.querySelector(".edit-text");
    if (editing) {
      autoGrow(editing);
      editing.focus();
      editing.setSelectionRange(editing.value.length, editing.value.length);
    }
  }

  function renderDanger() {
    els.danger.innerHTML = state.confirming === "person"
      ? '<div class="confirm"><span>이 사람과 모든 연락 기록을 삭제합니다. 되돌릴 수 없어요.</span>' +
        '<button type="button" class="btn btn-danger" data-action="delete-confirm">삭제</button>' +
        '<button type="button" class="btn btn-quiet" data-action="delete-cancel">취소</button></div>'
      : '<button type="button" class="btn-link danger" data-action="delete-ask">이 사람 삭제</button>';
  }

  function renderCategoryOptions(p) {
    els.category.innerHTML =
      '<option value="">없음</option>' +
      state.categories.map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>";
      }).join("");
    els.category.value = p.categoryId || "";
  }

  function renderProfile() {
    var p = find(state.openId);
    els.empty.hidden = !!p;
    els.content.hidden = !p;
    els.profile.classList.toggle("open", !!p);
    if (!p) return;
    renderProfileStatus(p);
    renderTimeline(p);
    renderDanger();
  }

  // Fills the editable fields; only called when a different person is opened so typing isn't interrupted.
  function fillProfile(p) {
    els.name.value = p.name || "";
    els.company.value = p.company || "";
    renderCategoryOptions(p);
    els.follow.value = p.followUp || "";
    els.newText.value = "";
    els.newText.style.height = "";
    els.newDate.value = todayISO();
    els.newDate.max = todayISO();
  }

  var lastFocus = null;

  function discardIfBlank(id) {
    var p = find(id);
    if (p && !p.name.trim() && !p.company.trim() && !p.log.length) {
      state.people = state.people.filter(function (x) { return x !== p; });
      save();
    }
  }

  function openPerson(id, isNew) {
    var p = find(id);
    if (!p) return;
    if (state.openId && state.openId !== id) discardIfBlank(state.openId);
    lastFocus = document.activeElement;
    state.openId = id;
    state.editingEntry = null;
    state.confirming = null;
    fillProfile(p);
    renderAll();
    els.profile.scrollTop = 0;
    if (isNew) {
      setTimeout(function () { els.name.focus(); }, 60);
    } else if (!WIDE.matches) {
      setTimeout(function () { $("back").focus(); }, 60);
    }
  }

  function closePerson() {
    if (!state.openId) return;
    discardIfBlank(state.openId);
    state.openId = null;
    state.editingEntry = null;
    state.confirming = null;
    renderAll();
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  function changed() {
    save();
    renderAll();
  }

  // ---------- Events ----------

  els.nav.addEventListener("click", function (e) {
    var item = e.target.closest("[data-category]");
    if (item) {
      state.category = item.getAttribute("data-category");
      renderAll();
      return;
    }
    if (e.target.closest('[data-action="add-category"]')) {
      state.addingCategory = true;
      renderSidebar();
    }
  });

  function commitCategory(input) {
    var name = input.value.trim();
    state.addingCategory = false;
    if (name && !state.categories.some(function (c) { return c.name === name; })) {
      var c = { id: newId(), name: name };
      state.categories.push(c);
      state.category = c.id;
      save();
    }
    renderAll();
  }

  els.nav.addEventListener("keydown", function (e) {
    if (e.target.id !== "new-category") return;
    if (e.key === "Enter") {
      e.preventDefault();
      commitCategory(e.target);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      state.addingCategory = false;
      renderSidebar();
    }
  });

  els.nav.addEventListener("focusout", function (e) {
    if (e.target.id === "new-category" && state.addingCategory) commitCategory(e.target);
  });

  els.foot.addEventListener("click", function (e) {
    var action = e.target.getAttribute("data-action");
    if (action === "clear-ask") state.confirmingClear = true;
    if (action === "clear-cancel") state.confirmingClear = false;
    if (action === "clear-confirm") {
      state.confirmingClear = false;
      state.people = state.people.filter(function (p) { return !p.sample; });
      if (state.openId && !find(state.openId)) state.openId = null;
      save();
    }
    if (action) renderAll();
  });

  els.cards.addEventListener("click", function (e) {
    var card = e.target.closest("[data-filter]");
    if (!card) return;
    var key = card.getAttribute("data-filter");
    state.filter = state.filter === key ? null : key;
    renderAll();
  });

  els.chipSlot.addEventListener("click", function (e) {
    if (e.target.closest('[data-action="clear-filter"]')) {
      state.filter = null;
      renderAll();
    }
  });

  els.search.addEventListener("input", function () {
    state.query = els.search.value;
    renderList();
  });

  els.sort.value = state.sort;
  els.sort.addEventListener("change", function () {
    state.sort = els.sort.value;
    try { localStorage.setItem(SORT_KEY, state.sort); } catch (err) {}
    renderList();
  });

  els.list.addEventListener("click", function (e) {
    var row = e.target.closest("[data-id]");
    if (row) openPerson(row.getAttribute("data-id"), false);
  });

  $("add-person").addEventListener("click", function () {
    var p = {
      id: newId(),
      name: "",
      company: "",
      categoryId: state.category === "all" ? "" : state.category,
      followUp: "",
      sample: false,
      log: []
    };
    state.people.push(p);
    state.filter = null;
    state.query = "";
    els.search.value = "";
    save();
    openPerson(p.id, true);
  });

  $("back").addEventListener("click", closePerson);

  els.name.addEventListener("input", function () {
    var p = find(state.openId);
    if (!p) return;
    p.name = els.name.value;
    save();
    renderProfileStatus(p);
    renderList();
  });

  els.company.addEventListener("input", function () {
    var p = find(state.openId);
    if (!p) return;
    p.company = els.company.value;
    save();
    renderList();
  });

  els.category.addEventListener("change", function () {
    var p = find(state.openId);
    if (!p) return;
    p.categoryId = els.category.value;
    changed();
  });

  els.follow.addEventListener("change", function () {
    var p = find(state.openId);
    if (!p) return;
    p.followUp = els.follow.value || "";
    changed();
  });

  els.followClear.addEventListener("click", function () {
    var p = find(state.openId);
    if (!p) return;
    p.followUp = "";
    els.follow.value = "";
    changed();
  });

  els.newText.addEventListener("input", function () { autoGrow(els.newText); });
  els.newText.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      els.composer.requestSubmit();
    }
  });

  els.composer.addEventListener("submit", function (e) {
    e.preventDefault();
    var p = find(state.openId);
    var text = els.newText.value.trim();
    if (!p) return;
    if (!text) {
      els.newText.focus();
      return;
    }
    var date = els.newDate.value || todayISO();
    if (date > todayISO()) date = todayISO();
    p.log.push({ id: newId(), date: date, text: text });
    // Logging contact on or after the planned follow-up date completes that follow-up.
    if (p.followUp && p.followUp <= date) {
      p.followUp = "";
      els.follow.value = "";
    }
    els.newText.value = "";
    els.newText.style.height = "";
    els.newDate.value = todayISO();
    state.editingEntry = null;
    state.confirming = null;
    changed();
  });

  els.timeline.addEventListener("click", function (e) {
    var action = e.target.getAttribute("data-action");
    var li = e.target.closest("[data-entry]");
    var p = find(state.openId);
    if (!action || !li || !p) return;
    var id = li.getAttribute("data-entry");
    var entry = p.log.find(function (x) { return x.id === id; });
    if (!entry) return;

    if (action === "edit") {
      state.editingEntry = id;
      state.confirming = null;
    } else if (action === "edit-cancel") {
      state.editingEntry = null;
    } else if (action === "edit-save") {
      var text = li.querySelector(".edit-text").value.trim();
      var date = li.querySelector(".edit-date").value || entry.date;
      if (date > todayISO()) date = todayISO();
      if (!text) {
        li.querySelector(".edit-text").focus();
        return;
      }
      entry.text = text;
      entry.date = date;
      state.editingEntry = null;
      changed();
      return;
    } else if (action === "entry-delete-ask") {
      state.confirming = "entry:" + id;
    } else if (action === "entry-delete-cancel") {
      state.confirming = null;
    } else if (action === "entry-delete-confirm") {
      p.log = p.log.filter(function (x) { return x.id !== id; });
      state.confirming = null;
      changed();
      return;
    }
    renderProfile();
  });

  els.timeline.addEventListener("input", function (e) {
    if (e.target.classList.contains("edit-text")) autoGrow(e.target);
  });

  els.danger.addEventListener("click", function (e) {
    var action = e.target.getAttribute("data-action");
    if (action === "delete-ask") state.confirming = "person";
    if (action === "delete-cancel") state.confirming = null;
    if (action === "delete-confirm") {
      var id = state.openId;
      state.people = state.people.filter(function (p) { return p.id !== id; });
      state.openId = null;
      state.confirming = null;
      lastFocus = null;
      changed();
      return;
    }
    renderDanger();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || !state.openId) return;
    if (state.editingEntry || state.confirming) {
      state.editingEntry = null;
      state.confirming = null;
      renderProfile();
    } else {
      closePerson();
    }
  });

  // Open the person at the top of the list on wide screens so the profile pane isn't empty on first load.
  var first = visiblePeople()[0];
  if (WIDE.matches && first) {
    state.openId = first.id;
    fillProfile(first);
  }
  renderAll();
})();
