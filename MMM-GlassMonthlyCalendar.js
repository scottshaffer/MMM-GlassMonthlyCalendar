/* MMM-GlassMonthlyCalendar.js
 * A month (or multi-week) calendar for MagicMirror², drawn as a large liquid-glass "main window"
 * that belongs to the same family as MMM-GlassClock and MMM-GlassTempest.
 *
 * Feature-compatible with kolbyjack/MMM-MonthlyCalendar (MIT): it reads the CALENDAR_EVENTS
 * broadcast by MagicMirror's default calendar module, and supports the same modes and options.
 * No npm dependencies (dates and names come from the browser's Intl).
 */
/* global config */

Module.register("MMM-GlassMonthlyCalendar", {
  defaults: {
    // ---- Options carried over from MMM-MonthlyCalendar (same names, same defaults) ----
    mode: "currentMonth", // lastMonth | currentMonth | nextMonth | currentWeek | oneWeek | twoWeeks | threeWeeks | fourWeeks
    firstDayOfWeek: "sunday", // any weekday name, or "today"
    showWeekNumber: false,
    displaySymbol: false,
    wrapTitles: false,
    hideCalendars: [],
    luminanceThreshold: 110, // eventStyle "solid": above this, all-day text is drawn black
    multiDayEndingTimeSeparator: " until ",
    hideDuplicateEvents: true,

    // ---- Main-window look ----
    showHeader: true, // title bar with the month and year (or the date range in week modes)
    showLegend: true, // calendar names and colors in the title bar (only when 2+ calendars)
    weekdayFormat: "short", // "long" | "short" | "narrow"
    highlightWeekends: true,
    dimPastEvents: true,
    eventStyle: "glass", // "glass" (tinted glass pills, color dots) | "solid" (original look)
    rowHeight: 128, // minimum height of a week row, px
    maxEventLanes: 0, // event rows per week before "+N more"; 0 = no limit
    width: "calc(100vw - 540px)", // CSS width; leaves room for 380 px Glass cards in top_right. "100%" in bar regions
    maxWidth: 1480, // px; 0 = no limit

    // ---- Touch navigation (the title-bar arrows) ----
    touchNavigation: true,
    navigationResetSeconds: 120, // return to the current period after this long; 0 = never

    // ---- Behaviour ----
    updateDelay: 5, // seconds to wait for the calendar module to finish broadcasting
    animationSpeed: 600, // MagicMirror cross-fade when the grid redraws, ms
    locale: null, // null follows MagicMirror's language
    timeFormat: null, // 12 | 24; null follows MagicMirror's global timeFormat
    performanceProfile: "auto", // auto | pi | full (same meaning as the other Glass modules)
    reduceMotion: false,

    // ---- Day mode (light glass) ----
    dayMode: "none", // "none" (only follow a theme's body.mm-day) | "day" | "night" | "auto"
    dayModeScope: "calendar", // "calendar" (this window only) | "page" (sets body.mm-day for every module)
    latitude: null, // for dayMode "auto": light from sunrise to sunset at this location
    longitude: null,
    dayStart: "07:00", // for dayMode "auto" when latitude/longitude are not set
    dayEnd: "19:00"
  },

  WEEKDAYS: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
  WEEK_MODES: { currentweek: 1, oneweek: 1, nextoneweek: 1, twoweeks: 2, threeweeks: 3, fourweeks: 4, nextfourweeks: 4 },
  MONTH_MODES: { lastmonth: -1, currentmonth: 0, nextmonth: 1 },

  getStyles() {
    return ["font-awesome.css", this.file("MMM-GlassMonthlyCalendar.css")];
  },

  start() {
    Log.info(`[${this.name}] Starting module`);
    this.sourceEvents = {};
    this.events = [];
    this.eventsKey = "";
    this.displayedDay = this._ordinal(new Date());
    this.navOffset = 0;
    this.updateTimer = null;
    this.midnightTimer = null;
    this.navTimer = null;
    this.performanceProfile = this._resolvePerformanceProfile();
    this.reduceMotion =
      this.config.reduceMotion === true ||
      this.performanceProfile === "pi" ||
      (typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    this._scheduleMidnight();
    this.isDay = this._computeIsDay(new Date());
    this._applyDayMode();
    if (String(this.config.dayMode).toLowerCase() === "auto") {
      this.dayTimer = setInterval(() => {
        const isDay = this._computeIsDay(new Date());
        if (isDay !== this.isDay) {
          this.isDay = isDay;
          this._applyDayMode();
        }
      }, 60 * 1000);
    }
  },

  suspend() {
    this._clear("midnightTimer");
  },

  resume() {
    if (this._ordinal(new Date()) !== this.displayedDay) this._redraw();
    this._scheduleMidnight();
  },

  /* ---------- calendar events ---------- */

  notificationReceived(notification, payload, sender) {
    if (notification !== "CALENDAR_EVENTS") return;
    if (!Array.isArray(payload)) {
      Log.error(`[${this.name}] CALENDAR_EVENTS payload is not an array`, payload);
      return;
    }
    const key = (sender && sender.identifier) || "unknown";
    this.sourceEvents[key] = this._normalizeEvents(payload);

    // The calendar module broadcasts once per feed; wait until it goes quiet, then draw once.
    this._clear("updateTimer");
    const delay = Math.max(0, Number(this.config.updateDelay) || 0) * 1000;
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      const merged = this._mergeEvents(this.sourceEvents);
      const eventsKey = this._eventsKey(merged);
      const today = this._ordinal(new Date());
      if (eventsKey !== this.eventsKey || today !== this.displayedDay) {
        this.events = merged;
        this.eventsKey = eventsKey;
        this._redraw();
      }
    }, delay);
  },

  // Dates arrive as millisecond strings; all-day events end at an exclusive midnight.
  _normalizeEvents(payload) {
    const hidden = Array.isArray(this.config.hideCalendars) ? this.config.hideCalendars : [];
    const out = [];
    for (const raw of payload) {
      if (!raw || hidden.includes(raw.calendarName)) continue;
      const e = Object.assign({}, raw);
      e.title = e.title == null ? "" : String(e.title);
      e.startDate = new Date(+raw.startDate);
      e.endDate = new Date(+raw.endDate);
      if (isNaN(e.startDate) || isNaN(e.endDate)) continue;
      if (e.endDate < e.startDate) e.endDate = new Date(e.startDate);

      if (e.fullDayEvent) {
        const end = e.endDate;
        if (end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0 && end.getMilliseconds() === 0) {
          // Move the exclusive midnight back to the end of the last included day.
          e.endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1, 23, 59, 59, 999);
          if (e.endDate < e.startDate) e.endDate = new Date(e.startDate);
        } else {
          e.endDate = new Date(end.getTime() - 1000);
        }
      }
      // Different calendar dates means multi-day, even for less than 24 hours.
      e.multiDayEvent = e.startDate.toDateString() !== e.endDate.toDateString();
      if (typeof e.symbol === "string") e.symbol = [e.symbol];
      out.push(e);
    }
    return out;
  },

  _mergeEvents(sources) {
    let events = Object.values(sources)
      .flat()
      .sort((a, b) =>
        a.startDate - b.startDate || a.endDate - b.endDate || a.title.localeCompare(b.title));
    if (this.config.hideDuplicateEvents) {
      const seen = new Set();
      events = events.filter((e) => {
        const k = `${e.title}|${e.startDate.valueOf()}|${e.endDate.valueOf()}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    return events;
  },

  _eventsKey(events) {
    return events
      .map((e) => [e.title, +e.startDate, +e.endDate, e.fullDayEvent ? 1 : 0, e.color || "",
        e.calendarName || "", (e.symbol || []).join(",")].join("\u0001"))
      .join("\u0002");
  },

  /* ---------- timers and navigation ---------- */

  _clear(name) {
    if (this[name]) clearTimeout(this[name]);
    this[name] = null;
  },

  _scheduleMidnight() {
    this._clear("midnightTimer");
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
    this.midnightTimer = setTimeout(() => {
      this._redraw();
      this._scheduleMidnight();
    }, next - now);
  },

  _redraw(speed) {
    this.displayedDay = this._ordinal(new Date());
    this.updateDom(speed == null ? this.config.animationSpeed : speed);
  },

  _navigate(step) {
    this.navOffset = step === 0 ? 0 : this.navOffset + step;
    this._clear("navTimer");
    const reset = Number(this.config.navigationResetSeconds) || 0;
    if (this.navOffset !== 0 && reset > 0) {
      this.navTimer = setTimeout(() => {
        this.navTimer = null;
        this.navOffset = 0;
        this._redraw();
      }, reset * 1000);
    }
    this._redraw(0);
  },

  /* ---------- day mode ---------- */

  _dayScope() {
    return String(this.config.dayMode).toLowerCase() === "none" ? null
      : String(this.config.dayModeScope).toLowerCase() === "page" ? "page" : "calendar";
  },

  // true = light, false = dark, null = leave it to the theme (dayMode "none").
  _computeIsDay(now) {
    const mode = String(this.config.dayMode || "none").toLowerCase();
    if (mode === "day") return true;
    if (mode === "night") return false;
    if (mode !== "auto") return null;
    const lat = Number(this.config.latitude);
    const lon = Number(this.config.longitude);
    if (this.config.latitude != null && this.config.longitude != null && isFinite(lat) && isFinite(lon)) {
      const sun = this._sunTimes(now, lat, lon);
      if (sun.rise && sun.set) return now >= sun.rise && now < sun.set;
      if (sun.polar) return sun.polar === "day";
    }
    const mins = (hhmm) => {
      const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
      return m ? +m[1] * 60 + +m[2] : null;
    };
    const start = mins(this.config.dayStart) ?? 420;
    const end = mins(this.config.dayEnd) ?? 1140;
    const t = now.getHours() * 60 + now.getMinutes();
    return start <= end ? t >= start && t < end : t >= start || t < end;
  },

  _applyDayMode() {
    const scope = this._dayScope();
    if (!scope || this.isDay == null) return;
    if (scope === "page") {
      if (typeof document !== "undefined" && document.body && document.body.classList) {
        if (this.isDay) document.body.classList.add("mm-day");
        else document.body.classList.remove("mm-day");
      }
    } else if (this.windowEl && this.windowEl.classList) {
      if (this.isDay) this.windowEl.classList.add("gmc-light");
      else this.windowEl.classList.remove("gmc-light");
    }
  },

  // Sunrise and sunset for the local date of "now" (standard NOAA/suncalc approximation, ±1-2 min).
  _sunTimes(now, lat, lon) {
    const rad = Math.PI / 180;
    const J1970 = 2440588;
    const J2000 = 2451545;
    const J0 = 0.0009;
    const noonLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const d = noonLocal.valueOf() / 86400000 - 0.5 + J1970 - J2000;
    const lw = rad * -lon;
    const phi = rad * lat;
    const n = Math.round(d - J0 - lw / (2 * Math.PI));
    const ds = J0 + lw / (2 * Math.PI) + n;
    const M = rad * (357.5291 + 0.98560028 * ds);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + rad * 102.9372 + Math.PI;
    const dec = Math.asin(Math.sin(rad * 23.4397) * Math.sin(L));
    const jNoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const cosH = (Math.sin(rad * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    if (cosH < -1) return { polar: "day" };
    if (cosH > 1) return { polar: "night" };
    const w = Math.acos(cosH);
    const jSet = J2000 + (J0 + (w + lw) / (2 * Math.PI) + n) + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const jRise = jNoon - (jSet - jNoon);
    const fromJ = (j) => new Date((j + 0.5 - J1970) * 86400000);
    return { rise: fromJ(jRise), set: fromJ(jSet) };
  },

  /* ---------- settings ---------- */

  _locale() {
    const raw = this.config.locale || (typeof config !== "undefined" && (config.locale || config.language)) || undefined;
    try {
      return raw ? Intl.getCanonicalLocales(raw)[0] : undefined;
    } catch (e) {
      return undefined;
    }
  },

  _use24h() {
    const tf = this.config.timeFormat ?? (typeof config !== "undefined" ? config.timeFormat : null);
    return Number(tf) !== 12;
  },

  _resolvePerformanceProfile() {
    const requested = (this.config.performanceProfile || "auto").toLowerCase();
    if (requested === "pi" || requested === "full") return requested;
    const ua = typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent.toLowerCase() : "";
    return ua.includes("raspberry") || ua.includes("armv7") || ua.includes("aarch64") || ua.includes("linux arm")
      ? "pi" : "full";
  },

  /* ---------- date helpers (pure, tested) ---------- */

  // Whole-day number that ignores DST and time of day.
  _ordinal(d) {
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  },

  _addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  },

  _firstDowIndex(now) {
    const want = String(this.config.firstDayOfWeek || "sunday").toLowerCase();
    if (want === "today") return now.getDay();
    const i = this.WEEKDAYS.indexOf(want);
    return i < 0 ? 0 : i;
  },

  _startOfWeek(d, firstDow) {
    return this._addDays(d, -((d.getDay() - firstDow + 7) % 7));
  },

  // ISO 8601 week number; a row is labelled by the week that holds most of its days.
  _weekNumber(rowStart) {
    const mid = this._addDays(rowStart, 3);
    const d = new Date(Date.UTC(mid.getFullYear(), mid.getMonth(), mid.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  },

  // What the grid shows for "now" and the current navigation offset.
  _range(now) {
    const mode = String(this.config.mode || "currentMonth").toLowerCase();
    const firstDow = this._firstDowIndex(now);
    if (mode in this.WEEK_MODES) {
      const weeks = this.WEEK_MODES[mode];
      const start = this._addDays(this._startOfWeek(now, firstDow), this.navOffset * weeks * 7);
      return { kind: "weeks", start, weeks, month: null, firstDow };
    }
    const delta = (mode in this.MONTH_MODES ? this.MONTH_MODES[mode] : 0) + this.navOffset;
    const month = new Date(now.getFullYear(), now.getMonth() + delta, 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const start = this._startOfWeek(month, firstDow);
    const weeks = Math.min(6, Math.ceil((this._ordinal(last) - this._ordinal(start) + 1) / 7));
    return { kind: "month", start, weeks, month, firstDow };
  },

  // Event segments for one week, packed into lanes (greedy interval partitioning).
  _layoutWeek(weekStart, events) {
    const ws = this._ordinal(weekStart);
    const we = ws + 6;
    const segments = [];
    for (const e of events) {
      const s = this._ordinal(e.startDate);
      const t = this._ordinal(e.endDate);
      if (t < ws || s > we) continue;
      segments.push({
        event: e,
        first: Math.max(0, s - ws),
        last: Math.min(6, t - ws),
        startsHere: s >= ws,
        endsHere: t <= we,
        spans: e.fullDayEvent || e.multiDayEvent
      });
    }
    // Bars first (longest first) so they sit above timed events, then by time.
    segments.sort((a, b) =>
      a.first - b.first ||
      (b.spans ? 1 : 0) - (a.spans ? 1 : 0) ||
      (b.last - b.first) - (a.last - a.first) ||
      a.event.startDate - b.event.startDate ||
      a.event.title.localeCompare(b.event.title));
    const laneEnds = [];
    for (const seg of segments) {
      let lane = 0;
      while (lane < laneEnds.length && laneEnds[lane] >= seg.first) lane++;
      laneEnds[lane] = seg.last;
      seg.lane = lane;
    }
    return { segments, lanes: laneEnds.length };
  },

  _formatTime(d) {
    const h = d.getHours();
    const m = d.getMinutes();
    const mm = String(m).padStart(2, "0");
    if (!this._use24h()) return `${h % 12 || 12}${m > 0 ? `:${mm}` : ""}${h < 12 ? "am" : "pm"}`;
    return `${h}:${mm}`;
  },

  // Perceived brightness 0-255 of a CSS color (hex, rgb()/rgba(), or anything the browser parses).
  _luminance(color) {
    let c = String(color || "").trim();
    let rgb = null;
    const hex = c.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      let h = hex[1];
      if (h.length <= 4) h = h.split("").map((x) => x + x).join("");
      rgb = [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
    } else {
      if (!/^rgb/i.test(c) && typeof document !== "undefined" && document.body && window.getComputedStyle) {
        const probe = document.createElement("span");
        probe.style.color = c;
        document.body.appendChild(probe);
        c = window.getComputedStyle(probe).color || c;
        probe.remove();
      }
      const m = c.match(/([0-9.]+)/g);
      if (m && m.length >= 3) rgb = m.slice(0, 3).map(Number);
    }
    if (!rgb) return 0;
    return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  },

  /* ---------- DOM ---------- */

  _el(tag, className, parent, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  },

  _title(range, locale) {
    if (range.kind === "month") {
      return {
        main: new Intl.DateTimeFormat(locale, { month: "long" }).format(range.month),
        sub: new Intl.DateTimeFormat(locale, { year: "numeric" }).format(range.month)
      };
    }
    const end = this._addDays(range.start, range.weeks * 7 - 1);
    const sameYear = end.getFullYear() === range.start.getFullYear();
    const f = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
    return {
      main: `${f.format(range.start)} – ${f.format(end)}`,
      sub: sameYear ? String(range.start.getFullYear()) : `${range.start.getFullYear()} – ${end.getFullYear()}`
    };
  },

  _legend(events) {
    const seen = new Map();
    for (const e of events) {
      const name = e.calendarName;
      if (name && !seen.has(name)) seen.set(name, e.color || "");
    }
    return [...seen.entries()];
  },

  _button(parent, icon, label, step) {
    const b = this._el("button", "gmc-nav-btn", parent);
    b.type = "button";
    b.setAttribute("aria-label", label);
    if (icon) this._el("i", `fa fa-${icon}`, b);
    else b.textContent = label;
    b.addEventListener("click", (ev) => {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      this._navigate(step);
    });
    return b;
  },

  getDom() {
    const c = this.config;
    const now = new Date();
    const locale = this._locale();
    const range = this._range(now);
    const todayOrd = this._ordinal(now);
    const glass = c.eventStyle !== "solid";
    const weekCol = c.showWeekNumber ? 1 : 0;
    const columns = `${c.showWeekNumber ? "3.2ch " : ""}repeat(7, minmax(0, 1fr))`;
    const visibleEvents = this.events;

    const win = this._el("div", "gmc-window");
    this.windowEl = win;
    if (this._dayScope() === "calendar" && this.isDay) win.classList.add("gmc-light");
    win.classList.add(glass ? "gmc-glass-events" : "gmc-solid-events");
    if (this.reduceMotion) win.classList.add("gmc-reduced");
    if (c.wrapTitles) win.classList.add("gmc-wrap");
    win.style.width = c.width || "calc(100vw - 540px)";
    if (Number(c.maxWidth) > 0) win.style.maxWidth = `${Number(c.maxWidth)}px`;
    win.style.setProperty("--gmc-columns", columns);
    win.style.setProperty("--gmc-row-height", `${Number(c.rowHeight) || 128}px`);

    // ---- title bar ----
    if (c.showHeader) {
      const bar = this._el("div", "gmc-titlebar", win);
      const t = this._title(range, locale);
      const heading = this._el("div", "gmc-heading", bar);
      this._el("span", "gmc-heading-main", heading, t.main);
      this._el("span", "gmc-heading-sub", heading, t.sub);

      const right = this._el("div", "gmc-titlebar-right", bar);
      const legend = this._legend(visibleEvents);
      if (c.showLegend && legend.length > 1) {
        const lg = this._el("div", "gmc-legend", right);
        for (const [name, color] of legend) {
          const item = this._el("span", "gmc-legend-item", lg);
          const dot = this._el("span", "gmc-dot", item);
          if (color) dot.style.setProperty("--gmc-ev", color);
          this._el("span", "gmc-legend-name", item, name);
        }
      }
      if (c.touchNavigation) {
        const nav = this._el("div", "gmc-nav", right);
        this._button(nav, "chevron-left", "Previous", -1);
        const todayBtn = this._button(nav, null, "Today", 0);
        todayBtn.classList.add("gmc-nav-today");
        if (this.navOffset === 0) todayBtn.classList.add("gmc-nav-current");
        this._button(nav, "chevron-right", "Next", 1);
      }
    }

    // ---- grid ----
    const sheet = this._el("div", "gmc-sheet", win);
    const head = this._el("div", "gmc-weekdays", sheet);
    if (weekCol) this._el("div", "gmc-weeknum-head", head, "#");
    const wdFmt = new Intl.DateTimeFormat(locale, { weekday: ["long", "short", "narrow"].includes(c.weekdayFormat) ? c.weekdayFormat : "short" });
    for (let d = 0; d < 7; d++) {
      const day = this._addDays(range.start, d);
      const h = this._el("div", "gmc-weekday", head, wdFmt.format(day));
      if (c.highlightWeekends && (day.getDay() === 0 || day.getDay() === 6)) h.classList.add("gmc-weekend");
    }

    const labelFmt = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
    const maxLanes = Math.max(0, Number(c.maxEventLanes) || 0);

    for (let w = 0; w < range.weeks; w++) {
      const weekStart = this._addDays(range.start, w * 7);
      const { segments, lanes } = this._layoutWeek(weekStart, visibleEvents);
      const shownLanes = maxLanes > 0 ? Math.min(lanes, maxLanes) : lanes;
      const hiddenPerDay = [0, 0, 0, 0, 0, 0, 0];
      for (const s of segments) {
        if (maxLanes > 0 && s.lane >= maxLanes) for (let d = s.first; d <= s.last; d++) hiddenPerDay[d]++;
      }
      const hasMore = hiddenPerDay.some((n) => n > 0);
      const rows = 1 + shownLanes + (hasMore ? 1 : 0);

      const row = this._el("div", "gmc-week", sheet);
      if (w === range.weeks - 1) row.classList.add("gmc-week-last");
      // label row, one row per lane, optional "+N more" row, then a filler that takes the rest.
      row.style.gridTemplateRows = `var(--gmc-label-height) ${"auto ".repeat(rows - 1)}1fr`;
      const spanAll = `1 / ${rows + 2}`;

      if (weekCol) {
        const wn = this._el("div", "gmc-weeknum", row, String(this._weekNumber(weekStart)));
        wn.style.gridRow = spanAll;
      }

      for (let d = 0; d < 7; d++) {
        const date = this._addDays(weekStart, d);
        const ord = this._ordinal(date);
        const cell = this._el("div", "gmc-day", row);
        cell.style.gridColumn = String(d + 1 + weekCol);
        cell.style.gridRow = spanAll;
        if (ord === todayOrd) cell.classList.add("gmc-today");
        else if (ord < todayOrd) cell.classList.add("gmc-past");
        if (range.kind === "month" && date.getMonth() !== range.month.getMonth()) cell.classList.add("gmc-other-month");
        if (c.highlightWeekends && (date.getDay() === 0 || date.getDay() === 6)) cell.classList.add("gmc-weekend");
        if (d === 6) cell.classList.add("gmc-day-last");
        const label = d === 0 || date.getDate() === 1 ? labelFmt.format(date) : String(date.getDate());
        const lbl = this._el("div", "gmc-date", cell);
        this._el("span", "gmc-date-num", lbl, label);
      }

      for (const seg of segments) {
        if (maxLanes > 0 && seg.lane >= maxLanes) continue;
        row.appendChild(this._eventEl(seg, weekCol, todayOrd, glass));
      }

      if (hasMore) {
        for (let d = 0; d < 7; d++) {
          if (!hiddenPerDay[d]) continue;
          const more = this._el("div", "gmc-more", row, `+${hiddenPerDay[d]} more`);
          more.style.gridColumn = String(d + 1 + weekCol);
          more.style.gridRow = String(shownLanes + 2);
        }
      }
    }

    if (!this.events.length && this.eventsKey === "" && Object.keys(this.sourceEvents).length === 0) {
      this._el("div", "gmc-waiting", win, "Waiting for calendar events…");
    }
    return win;
  },

  _eventEl(seg, weekCol, todayOrd, glass) {
    const c = this.config;
    const e = seg.event;
    const bar = this._el("div", "gmc-event");
    bar.style.gridColumn = `${seg.first + 1 + weekCol} / span ${seg.last - seg.first + 1}`;
    bar.style.gridRow = String(seg.lane + 2);
    if (!c.wrapTitles) bar.classList.add("gmc-nowrap");
    bar.classList.add(seg.spans ? "gmc-event-bar" : "gmc-event-timed");
    if (seg.spans && !seg.startsHere) bar.classList.add("gmc-continues-left");
    if (seg.spans && !seg.endsHere) bar.classList.add("gmc-continues-right");
    if (c.dimPastEvents && this._ordinal(e.endDate) < todayOrd) bar.classList.add("gmc-event-past");
    if (e.color) bar.style.setProperty("--gmc-ev", e.color);

    // Same label rules as MMM-MonthlyCalendar: start time for timed events (on their first day
    // when they span days), "until <time>" on the last day of a timed multi-day event.
    if (!seg.spans && glass) this._el("span", "gmc-dot", bar);
    if (!e.fullDayEvent && (!e.multiDayEvent || seg.startsHere)) {
      this._el("span", "gmc-event-time", bar, this._formatTime(e.startDate));
    }
    if (c.displaySymbol && Array.isArray(e.symbol)) {
      for (const s of e.symbol) if (s) this._el("span", `gmc-event-symbol fa fa-${s}`, bar);
    }
    this._el("span", "gmc-event-title", bar, e.title);
    if (!e.fullDayEvent && e.multiDayEvent && seg.endsHere) {
      this._el("span", "gmc-event-time gmc-event-until", bar, `${c.multiDayEndingTimeSeparator}${this._formatTime(e.endDate)}`);
    }

    if (!glass && e.color) {
      if (seg.spans) {
        bar.style.backgroundColor = e.color;
        bar.classList.add(this._luminance(e.color) >= c.luminanceThreshold ? "gmc-light-bg" : "gmc-dark-bg");
      } else {
        bar.style.color = e.color;
      }
    }
    return bar;
  }
});
