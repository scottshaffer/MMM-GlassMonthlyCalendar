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
    calendarColors: "auto", // "auto": calendars with no color of their own (MagicMirror sends white) get one from colorPalette; "off": use the colors as sent
    colorPalette: ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#22d3ee", "#fb923c"],

    // ---- Main-window look ----
    showHeader: true, // title bar with the month and year (or the date range in week modes)
    showLegend: true, // calendar names and colors in the title bar (only when 2+ calendars)
    weekdayFormat: "short", // "long" | "short" | "narrow"
    highlightWeekends: true,
    dimPastEvents: true,
    eventStyle: "glass", // "glass" (tinted glass pills, color dots) | "solid" (original look)
    eventLayout: "cards", // "cards" (Skylight-style: title, time range, location) | "compact" (one line per event)
    showEndTime: true, // cards: "9:45 – 11am" instead of "9:45am"
    showLocation: true, // cards: the event's location on its own line
    titleLines: 2, // cards: long titles wrap to this many lines (1 or 2)
    height: "fill", // "fill" (all of the screen's height) | "auto" (rowHeight per week) | a number of px
    width: "fill", // "fill" (screen width minus reserveWidth) | any CSS width such as "1400px" or "100%"
    reserveWidth: 380, // width: "fill" leaves this many px for the Glass cards beside the calendar
    reserveGap: 30, // ... plus this gap between them
    rowHeight: 128, // height: "auto": minimum height of a week row, px
    maxEventLanes: 0, // rows of bars (compact: of events) per week before "+N more"; 0 = as many as fit
    maxWidth: 0, // px; 0 = no limit

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
    sunNotification: "AMBIENT_WEATHER_DATA", // dayMode "auto" uses sunrise/sunset from MMM-GlassTempest's broadcast
    dayModeScope: "calendar", // "calendar" (this window only) | "page" (sets body.mm-day for every module)
    latitude: null, // for dayMode "auto" when no weather broadcast has arrived: sunrise/sunset here
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
    if (typeof window !== "undefined" && window.addEventListener) {
      // height/width "fill" depend on the screen size
      window.addEventListener("resize", () => {
        this._clear("resizeTimer");
        this.resizeTimer = setTimeout(() => this._redraw(0), 400);
      });
    }
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
    if (this.config.sunNotification && notification === this.config.sunNotification) {
      this._receiveSunTimes(payload);
      return;
    }
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

  // White (the calendar module's default when a calendar has no color) or no color at all.
  _isUnsetColor(color) {
    const c = String(color || "").replace(/\s+/g, "").toLowerCase();
    return !c || c === "#fff" || c === "#ffffff" || c === "white" || c === "rgb(255,255,255)";
  },

  // Give every calendar without its own color a different color from the palette. Calendars are
  // told apart by their name (the calendar module's "name" option) and get their color in name
  // order, so a calendar keeps its color from one update to the next.
  _assignCalendarColors(events) {
    if (String(this.config.calendarColors).toLowerCase() === "off") return;
    const palette = Array.isArray(this.config.colorPalette) && this.config.colorPalette.length
      ? this.config.colorPalette : this.defaults.colorPalette;
    const needs = (e) => e._gmcAutoColor || this._isUnsetColor(e.color);
    const taken = new Set(events.filter((e) => !needs(e)).map((e) => String(e.color).toLowerCase()));
    const free = palette.filter((c) => !taken.has(String(c).toLowerCase()));
    const pool = free.length ? free : palette;
    const names = [...new Set(events.filter(needs).map((e) => e.calendarName || ""))].sort();
    const colorFor = new Map(names.map((n, i) => [n, pool[i % pool.length]]));
    for (const e of events) {
      if (!needs(e)) continue;
      e.color = colorFor.get(e.calendarName || "");
      e._gmcAutoColor = true;
    }
  },

  _mergeEvents(sources) {
    let events = Object.values(sources).flat();
    this._assignCalendarColors(events);
    events.sort((a, b) =>
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
    const fromWeather = this._weatherSunToday(now);
    if (fromWeather) return now >= fromWeather.rise && now < fromWeather.set;
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

  // Sunrise/sunset from MMM-GlassTempest (ISO strings or timestamps for today).
  _receiveSunTimes(payload) {
    if (!payload || payload.sunrise == null || payload.sunset == null) return;
    const toDate = (v) => new Date(typeof v === "number" && v < 1e12 ? v * 1000 : v);
    const rise = toDate(payload.sunrise);
    const set = toDate(payload.sunset);
    if (isNaN(rise) || isNaN(set) || set <= rise) return;
    this.weatherSun = { rise, set };
    if (String(this.config.dayMode).toLowerCase() !== "auto") return;
    const isDay = this._computeIsDay(new Date());
    if (isDay !== this.isDay) {
      this.isDay = isDay;
      this._applyDayMode();
    }
  },

  // Today's sunrise/sunset from the weather broadcast. Times up to 3 days old are moved to
  // today (they shift by only a minute or two a day), e.g. just after midnight.
  _weatherSunToday(now) {
    if (!this.weatherSun) return null;
    const shift = this._ordinal(now) - this._ordinal(this.weatherSun.rise);
    if (shift < 0 || shift > 3) return null;
    const move = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + shift, d.getHours(), d.getMinutes(), d.getSeconds());
    return { rise: move(this.weatherSun.rise), set: move(this.weatherSun.set) };
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

  /* ---------- sizing ---------- */

  // Fixed pixel sizes from the CSS, so the module can work out how many events fit in a day
  // before the browser lays anything out. Keep in step with MMM-GlassMonthlyCalendar.css.
  METRICS: {
    titlebar: 78, // .gmc-titlebar height
    sheetMargin: 12 + 14, // .gmc-sheet top + bottom margin
    weekdays: 40, // .gmc-weekdays height (incl. border)
    frame: 3, // window border
    label: 30, // --gmc-label-height
    rowPad: 6, // empty space kept at the bottom of each week row (incl. one grid gap)
    rowBorder: 1,
    bar: 24, // an all-day / multi-day bar (and a compact event)
    barGap: 3,
    card: 10, // card padding + border
    cardTitle: 18, // one title line
    cardLine: 16, // one detail line (time, location)
    cardGap: 4,
    more: 20 // the "+N more" line
  },

  // The usable area inside MagicMirror's body margins, or null outside a browser.
  _viewport() {
    if (typeof window === "undefined" || !window.innerHeight || typeof document === "undefined" || !document.body) return null;
    let m = { top: 0, right: 0, bottom: 0, left: 0 };
    try {
      const cs = window.getComputedStyle(document.body);
      m = { top: parseFloat(cs.marginTop) || 0, right: parseFloat(cs.marginRight) || 0,
        bottom: parseFloat(cs.marginBottom) || 0, left: parseFloat(cs.marginLeft) || 0 };
    } catch (e) { /* keep zero margins */ }
    return { width: window.innerWidth - m.left - m.right, height: window.innerHeight - m.top - m.bottom };
  },

  _windowWidth(vp) {
    const w = this.config.width;
    if (w === "fill" || w == null || w === "") {
      const reserve = (Number(this.config.reserveWidth) || 0) + (Number(this.config.reserveGap) || 0);
      return vp ? `${Math.max(480, Math.floor(vp.width - reserve))}px`
        : `calc(100vw - ${120 + reserve}px)`;
    }
    return typeof w === "number" ? `${w}px` : String(w);
  },

  // Height of one week row in px, or null for "auto" (CSS min-height).
  _rowHeight(weeks, vp) {
    const h = this.config.height;
    let total = null;
    if (typeof h === "number" || /^\d+$/.test(String(h))) total = Number(h);
    else if (h === "fill" && vp) total = vp.height;
    if (!total) return null;
    const M = this.METRICS;
    const chrome = (this.config.showHeader ? M.titlebar : 0) + M.sheetMargin + M.weekdays + M.frame;
    return Math.max(60, Math.floor((total - chrome) / weeks));
  },

  // Height of an event card with the given number of title and detail lines.
  _cardHeight(lines, titleLines = 1) {
    const M = this.METRICS;
    return M.card + M.cardTitle * titleLines + M.cardLine * lines;
  },

  // How many lines a card title needs (1 or 2), estimated from the column width.
  _titleLines(title, ctx) {
    const max = this.config.wrapTitles ? 2 : Math.max(1, Math.min(2, Number(this.config.titleLines) || 1));
    if (max === 1 || !ctx.colWidth) return 1;
    const symbols = this.config.displaySymbol ? 20 : 0;
    const charsPerLine = Math.max(6, Math.floor((ctx.colWidth - symbols) / 7.4));
    return String(title).length > charsPerLine ? 2 : 1;
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

  // Touch buttons. Pressing one darkens it at once; the calendar changes a moment later (so the
  // press can be seen), and the same button in the redrawn title bar flashes to confirm it.
  _button(parent, icon, label, step) {
    const b = this._el("button", "gmc-nav-btn", parent);
    b.type = "button";
    b.setAttribute("aria-label", label);
    if (icon) this._el("i", `fa fa-${icon}`, b);
    else b.textContent = label;
    if (this.flashButton === label) {
      b.classList.add("gmc-nav-flash");
      this.flashButton = null;
    }
    const press = () => b.classList.add("gmc-pressed");
    const release = () => b.classList.remove("gmc-pressed");
    b.addEventListener("pointerdown", press);
    b.addEventListener("touchstart", press);
    for (const t of ["pointerup", "pointercancel", "pointerleave", "touchcancel"]) b.addEventListener(t, release);
    b.addEventListener("click", (ev) => {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      const now = Date.now();
      if (this.lastPress && now - this.lastPress < 300) return; // ignore a double tap
      this.lastPress = now;
      press();
      this.flashButton = label;
      this._clear("pressTimer");
      this.pressTimer = setTimeout(() => {
        this.pressTimer = null;
        this._navigate(step);
      }, 140);
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
    const vp = this._viewport();
    const rowPx = this._rowHeight(range.weeks, vp);
    const cards = c.eventLayout !== "compact";
    win.classList.add(cards ? "gmc-layout-cards" : "gmc-layout-compact");
    win.style.width = this._windowWidth(vp);
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

    const winPx = parseFloat(win.style.width);
    const ctx = {
      range, todayOrd, glass, weekCol, rowPx, now,
      // usable text width inside a card: sheet margins, week-number column, card margin + padding
      colWidth: /px$/.test(win.style.width) && winPx > 0 ? (winPx - 35 - (weekCol ? 34 : 0)) / 7 - 10 - 18 : 0,
      labelFmt: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" })
    };
    for (let w = 0; w < range.weeks; w++) {
      const weekStart = this._addDays(range.start, w * 7);
      const row = this._el("div", "gmc-week", sheet);
      if (w === range.weeks - 1) row.classList.add("gmc-week-last");
      if (rowPx) {
        row.style.height = `${rowPx}px`;
        row.style.minHeight = "0";
      }
      if (cards) this._renderWeekCards(row, weekStart, ctx);
      else this._renderWeekCompact(row, weekStart, ctx);
    }

    if (!this.events.length && this.eventsKey === "" && Object.keys(this.sourceEvents).length === 0) {
      this._el("div", "gmc-waiting", win, "Waiting for calendar events…");
    }
    return win;
  },

  // Day cells (background, date label) that span every row of the week grid.
  _renderDayCells(row, weekStart, spanAll, ctx) {
    const c = this.config;
    if (ctx.weekCol) {
      const wn = this._el("div", "gmc-weeknum", row, String(this._weekNumber(weekStart)));
      wn.style.gridRow = spanAll;
    }
    for (let d = 0; d < 7; d++) {
      const date = this._addDays(weekStart, d);
      const ord = this._ordinal(date);
      const cell = this._el("div", "gmc-day", row);
      cell.style.gridColumn = String(d + 1 + ctx.weekCol);
      cell.style.gridRow = spanAll;
      if (ord === ctx.todayOrd) cell.classList.add("gmc-today");
      else if (ord < ctx.todayOrd) cell.classList.add("gmc-past");
      if (ctx.range.kind === "month" && date.getMonth() !== ctx.range.month.getMonth()) cell.classList.add("gmc-other-month");
      if (c.highlightWeekends && (date.getDay() === 0 || date.getDay() === 6)) cell.classList.add("gmc-weekend");
      if (d === 6) cell.classList.add("gmc-day-last");
      const label = d === 0 || date.getDate() === 1 ? ctx.labelFmt.format(date) : String(date.getDate());
      const lbl = this._el("div", "gmc-date", cell);
      this._el("span", "gmc-date-num", lbl, label);
    }
  },

  _moreEl(parent, n) {
    return this._el("div", "gmc-more", parent, `+${n} more`);
  },

  // Compact layout (the original): every event is a one-line entry packed into lanes.
  _renderWeekCompact(row, weekStart, ctx) {
    const M = this.METRICS;
    const { segments, lanes } = this._layoutWeek(weekStart, this.events);
    let maxLanes = Math.max(0, Number(this.config.maxEventLanes) || 0);
    if (!maxLanes && ctx.rowPx) {
      const room = ctx.rowPx - M.label - M.rowPad - M.rowBorder;
      const fit = Math.max(1, Math.floor((room + M.barGap) / (M.bar + M.barGap)));
      maxLanes = lanes > fit ? Math.max(1, fit - 1) : fit; // keep a line for "+N more"
    }
    const shownLanes = maxLanes > 0 ? Math.min(lanes, maxLanes) : lanes;
    const hiddenPerDay = [0, 0, 0, 0, 0, 0, 0];
    for (const s of segments) {
      if (maxLanes > 0 && s.lane >= maxLanes) for (let d = s.first; d <= s.last; d++) hiddenPerDay[d]++;
    }
    const hasMore = hiddenPerDay.some((n) => n > 0);
    const rows = 1 + shownLanes + (hasMore ? 1 : 0);
    // label row, one row per lane, optional "+N more" row, then a filler that takes the rest.
    row.style.gridTemplateRows = `var(--gmc-label-height) ${"auto ".repeat(rows - 1)}1fr`;
    this._renderDayCells(row, weekStart, `1 / ${rows + 2}`, ctx);

    for (const seg of segments) {
      if (maxLanes > 0 && seg.lane >= maxLanes) continue;
      row.appendChild(this._eventEl(seg, ctx.weekCol, ctx.todayOrd, ctx.glass));
    }
    if (hasMore) {
      for (let d = 0; d < 7; d++) {
        if (!hiddenPerDay[d]) continue;
        const more = this._moreEl(row, hiddenPerDay[d]);
        more.style.gridColumn = String(d + 1 + ctx.weekCol);
        more.style.gridRow = String(shownLanes + 2);
      }
    }
  },

  // Cards layout: all-day and multi-day events stay as bars across the week; timed events are
  // stacked under them as cards (title, time range, location), as many as fit in the day.
  _renderWeekCards(row, weekStart, ctx) {
    const M = this.METRICS;
    const c = this.config;
    const { segments } = this._layoutWeek(weekStart, this.events.filter((e) => e.fullDayEvent || e.multiDayEvent));
    const ws = this._ordinal(weekStart);
    const perDay = [[], [], [], [], [], [], []];
    for (const e of this.events) {
      if (e.fullDayEvent || e.multiDayEvent) continue;
      const d = this._ordinal(e.startDate) - ws;
      if (d >= 0 && d < 7) perDay[d].push(e);
    }

    // Bars: lane-packed, capped so that at least one card still fits under them.
    const barLanes = segments.reduce((n, s) => Math.max(n, s.lane + 1), 0);
    let maxBars = Math.max(0, Number(c.maxEventLanes) || 0);
    if (!maxBars && ctx.rowPx) {
      const room = ctx.rowPx - M.label - M.rowPad - M.rowBorder - this._cardHeight(1, 1);
      maxBars = Math.max(1, Math.floor(room / (M.bar + M.barGap)));
    }
    let shownBars = maxBars > 0 ? Math.min(barLanes, maxBars) : barLanes;
    const hiddenBars = [0, 0, 0, 0, 0, 0, 0];
    if (shownBars < barLanes) {
      shownBars = Math.max(0, shownBars - 1); // the last bar row becomes "+N more"
      for (const s of segments) if (s.lane >= shownBars) for (let d = s.first; d <= s.last; d++) hiddenBars[d]++;
    }
    const barRows = shownBars + (hiddenBars.some((n) => n) ? 1 : 0);
    const rows = 1 + barRows + 1; // label, bar rows, card stack
    row.style.gridTemplateRows = `var(--gmc-label-height) ${"auto ".repeat(barRows)}1fr`;
    this._renderDayCells(row, weekStart, `1 / ${rows + 1}`, ctx);

    for (const seg of segments) {
      if (seg.lane >= shownBars) continue;
      row.appendChild(this._eventEl(seg, ctx.weekCol, ctx.todayOrd, ctx.glass));
    }

    // Room left for cards in each day (null = no limit, height "auto").
    const room = ctx.rowPx
      ? ctx.rowPx - M.label - M.rowPad - M.rowBorder - barRows * (M.bar + M.barGap)
      : null;

    for (let d = 0; d < 7; d++) {
      if (hiddenBars[d]) {
        const more = this._moreEl(row, hiddenBars[d]);
        more.style.gridColumn = String(d + 1 + ctx.weekCol);
        more.style.gridRow = String(shownBars + 2);
      }
      const list = perDay[d].sort((a, b) => a.startDate - b.startDate || a.endDate - b.endDate || a.title.localeCompare(b.title));
      if (!list.length) continue;
      const stack = this._el("div", "gmc-stack", row);
      stack.style.gridColumn = String(d + 1 + ctx.weekCol);
      stack.style.gridRow = String(rows);

      let used = 0;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const lines = this._cardLines(e);
        const tl = this._titleLines(e.title, ctx);
        const h = this._cardHeight(lines.length, tl) + (i ? M.cardGap : 0);
        const restAfter = list.length - i - 1;
        const needMore = restAfter > 0 ? M.cardGap + M.more : 0;
        if (room != null && used + h + needMore > room) {
          // Not enough room for this card (plus the "+N more" line after it).
          if (room - used >= M.more + (i ? M.cardGap : 0)) this._moreEl(stack, list.length - i);
          else if (stack.children && stack.children.length) {
            // Swap the last card for the "+N more" line.
            stack.removeChild(stack.children[stack.children.length - 1]);
            this._moreEl(stack, list.length - i + 1);
          }
          break;
        }
        stack.appendChild(this._cardEl(e, lines, tl, ctx));
        used += h;
      }
    }
  },

  // Detail lines under a card's title.
  _cardLines(e) {
    const c = this.config;
    const lines = [{ cls: "gmc-card-time", text: c.showEndTime ? this._formatRange(e.startDate, e.endDate) : this._formatTime(e.startDate) }];
    const loc = typeof e.location === "string" ? e.location.split(/\r?\n/)[0].trim() : "";
    if (c.showLocation && loc) lines.push({ cls: "gmc-card-location", text: loc, icon: "location-dot" });
    return lines;
  },

  _cardEl(e, lines, titleLines, ctx) {
    const c = this.config;
    const card = this._el("div", "gmc-card");
    if (e.color) card.style.setProperty("--gmc-ev", e.color);
    if (titleLines > 1) card.classList.add("gmc-card-wrap");
    if (e.endDate < ctx.now) {
      if (c.dimPastEvents) card.classList.add("gmc-event-past");
    } else if (e.startDate <= ctx.now) {
      card.classList.add("gmc-card-now");
    }
    if (!ctx.glass && e.color) {
      card.style.backgroundColor = e.color;
      card.classList.add(this._luminance(e.color) >= c.luminanceThreshold ? "gmc-light-bg" : "gmc-dark-bg");
    }
    const title = this._el("div", "gmc-card-title", card);
    if (c.displaySymbol && Array.isArray(e.symbol)) {
      for (const s of e.symbol) if (s) this._el("span", `gmc-event-symbol fa fa-${s}`, title);
    }
    this._el("span", "gmc-card-title-text", title, e.title);
    for (const l of lines) {
      const line = this._el("div", `gmc-card-line ${l.cls}`, card);
      if (l.icon) this._el("i", `fa fa-${l.icon}`, line);
      this._el("span", null, line, l.text);
    }
    return card;
  },

  // "9:45 – 11am", "11:30am – 1:15pm", "13:00 – 14:30"
  _formatRange(start, end) {
    if (!end || end <= start) return this._formatTime(start);
    const a = this._formatTime(start);
    const b = this._formatTime(end);
    if (!this._use24h() && (start.getHours() < 12) === (end.getHours() < 12)) {
      return `${a.replace(/[ap]m$/, "")} – ${b}`;
    }
    return `${a} – ${b}`;
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
