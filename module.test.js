/* Tests for MMM-GlassMonthlyCalendar.js (minimal fake DOM, no browser). Run with: npm test */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MODULE_PATH = path.join(__dirname, "MMM-GlassMonthlyCalendar.js");

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this._classes = new Set();
    this.textContent = "";
    this.attrs = {};
    this.listeners = {};
    const style = {};
    style.setProperty = (k, v) => (style[k] = v);
    this.style = style;
    this.classList = {
      add: (c) => this._classes.add(c),
      remove: (c) => this._classes.delete(c),
      contains: (c) => this._classes.has(c)
    };
  }
  get className() {
    return [...this._classes].join(" ");
  }
  set className(v) {
    this._classes = new Set(`${v}`.split(/\s+/).filter(Boolean));
  }
  appendChild(c) {
    this.children.push(c);
    c.parentNode = this;
    return c;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
    this.parentNode = null;
  }
  removeChild(c) {
    this.children = this.children.filter((x) => x !== c);
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener(t, fn) {
    this.listeners[t] = fn;
  }
  // depth-first search by class
  findAll(cls, out = []) {
    for (const ch of this.children) {
      if (ch._classes.has(cls)) out.push(ch);
      ch.findAll(cls, out);
    }
    return out;
  }
  text() {
    return this.textContent + this.children.map((c) => c.text()).join("");
  }
}

// "now" is fixed at Monday 23 Nov 2026, 20:46 local time.
const NOW = new Date(2026, 10, 23, 20, 46).getTime();

function setup(overrides = {}, globalConfig = { language: "en-US", timeFormat: 12 }) {
  const timers = [];
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...a) {
      if (a.length) super(...a);
      else super(NOW);
    }
    static now() {
      return NOW;
    }
  }
  FixedDate.UTC = RealDate.UTC;
  const sandbox = {
    Module: { register: (n, d) => (sandbox.def = d) },
    Log: { info() {}, log() {}, warn() {}, error() {} },
    config: globalConfig,
    window: undefined,
    navigator: undefined,
    Intl,
    Date: FixedDate,
    Math,
    console,
    document: { createElement: (t) => new FakeElement(t), body: new FakeElement("body") },
    setTimeout: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimeout() {},
    setInterval: (fn, ms) => (timers.push({ fn, ms, interval: true }), timers.length)
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(MODULE_PATH, "utf8"), sandbox, { filename: MODULE_PATH });
  const m = Object.assign({}, sandbox.def, {
    name: "MMM-GlassMonthlyCalendar",
    config: Object.assign({}, sandbox.def.defaults, overrides),
    file: (f) => f,
    domUpdates: 0,
    updateDom() {
      this.domUpdates++;
    }
  });
  m.start();
  return { m, timers };
}

const ms = (y, mo, d, h = 0, mi = 0) => String(new Date(y, mo, d, h, mi).getTime());
const ev = (title, start, end, extra = {}) => Object.assign({ title, startDate: start, endDate: end }, extra);

function feed(m, timers, events, sender = "calendar_1") {
  m.notificationReceived("CALENDAR_EVENTS", events, { identifier: sender });
  timers[timers.length - 1].fn();
}

const ymd = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

test("currentMonth grid starts on the configured weekday and covers the month", () => {
  const { m } = setup();
  let r = m._range(new Date(NOW));
  assert.equal(r.kind, "month");
  assert.equal(ymd(r.start), "2026-11-1"); // 1 Nov 2026 is a Sunday
  assert.equal(r.weeks, 5);

  m.config.firstDayOfWeek = "monday";
  r = m._range(new Date(NOW));
  assert.equal(ymd(r.start), "2026-10-26");
  assert.equal(r.weeks, 6); // Monday 30 Nov needs a sixth row
});

test("lastMonth / nextMonth do not overflow on the 31st", () => {
  const { m } = setup({ mode: "nextMonth" });
  const r = m._range(new Date(2027, 0, 31)); // 31 Jan → February, not March
  assert.equal(r.month.getMonth(), 1);
  m.config.mode = "lastMonth";
  assert.equal(m._range(new Date(2026, 2, 31)).month.getMonth(), 1);
});

test("week modes and firstDayOfWeek: today", () => {
  const { m } = setup({ mode: "twoWeeks" });
  let r = m._range(new Date(NOW));
  assert.equal(r.kind, "weeks");
  assert.equal(r.weeks, 2);
  assert.equal(ymd(r.start), "2026-11-22");
  m.config.firstDayOfWeek = "today";
  m.config.mode = "fourWeeks";
  r = m._range(new Date(NOW));
  assert.equal(ymd(r.start), "2026-11-23");
  assert.equal(r.weeks, 4);
});

test("navigation moves by months (month modes) and by the view length (week modes)", () => {
  const { m, timers } = setup({ mode: "threeWeeks", navigationResetSeconds: 30 });
  m._navigate(1);
  assert.equal(ymd(m._range(new Date(NOW)).start), "2026-12-13");
  assert.equal(timers.at(-1).ms, 30000); // auto-return scheduled
  m._navigate(0);
  assert.equal(m.navOffset, 0);
  m.config.mode = "currentMonth";
  m._navigate(-1);
  assert.equal(m._range(new Date(NOW)).month.getMonth(), 9);
});

test("all-day events end on their last included day; multi-day detection", () => {
  const { m } = setup();
  const [a, b, c] = m._normalizeEvents([
    ev("Holiday", ms(2026, 10, 26), ms(2026, 10, 27), { fullDayEvent: true }),
    ev("Trip", ms(2026, 10, 21), ms(2026, 10, 25), { fullDayEvent: true }),
    ev("Late show", ms(2026, 10, 23, 22), ms(2026, 10, 24, 1))
  ]);
  assert.equal(m._ordinal(a.endDate), m._ordinal(a.startDate));
  assert.equal(a.multiDayEvent, false);
  assert.equal(b.endDate.getDate(), 24);
  assert.equal(b.multiDayEvent, true);
  assert.equal(c.multiDayEvent, true); // crosses midnight in under 24 hours
});

test("hideCalendars and hideDuplicateEvents", () => {
  const { m } = setup({ hideCalendars: ["Spam"] });
  const evs = m._normalizeEvents([
    ev("A", ms(2026, 10, 2, 9), ms(2026, 10, 2, 10), { calendarName: "Home" }),
    ev("A", ms(2026, 10, 2, 9), ms(2026, 10, 2, 10), { calendarName: "Work" }),
    ev("B", ms(2026, 10, 3, 9), ms(2026, 10, 3, 10), { calendarName: "Spam" })
  ]);
  assert.equal(evs.length, 2);
  assert.equal(m._mergeEvents({ x: evs }).length, 1);
  m.config.hideDuplicateEvents = false;
  assert.equal(m._mergeEvents({ x: evs }).length, 2);
});

test("events from several calendar instances are merged; redraw waits for updateDelay", () => {
  const { m, timers } = setup({ updateDelay: 5 });
  m.notificationReceived("CALENDAR_EVENTS", [ev("A", ms(2026, 10, 2, 9), ms(2026, 10, 2, 10))], { identifier: "c1" });
  m.notificationReceived("CALENDAR_EVENTS", [ev("B", ms(2026, 10, 4, 9), ms(2026, 10, 4, 10))], { identifier: "c2" });
  const t = timers.at(-1);
  assert.equal(t.ms, 5000);
  assert.equal(m.domUpdates, 0);
  t.fn();
  assert.equal(m.domUpdates, 1);
  assert.equal(m.events.map((e) => e.title).join(","), "A,B");
  // Same events again: no redraw
  m.notificationReceived("CALENDAR_EVENTS", [ev("A", ms(2026, 10, 2, 9), ms(2026, 10, 2, 10))], { identifier: "c1" });
  timers.at(-1).fn();
  assert.equal(m.domUpdates, 1);
});

test("lane packing: overlapping events get separate lanes, bars first", () => {
  const { m } = setup();
  const evs = m._normalizeEvents([
    ev("Timed", ms(2026, 10, 23, 9), ms(2026, 10, 23, 10)),
    ev("Trip", ms(2026, 10, 22), ms(2026, 10, 25), { fullDayEvent: true }),
    ev("Thanks", ms(2026, 10, 26), ms(2026, 10, 27), { fullDayEvent: true })
  ]);
  const { segments, lanes } = m._layoutWeek(new Date(2026, 10, 22), m._mergeEvents({ x: evs }));
  const byTitle = Object.fromEntries(segments.map((s) => [s.event.title, s]));
  assert.equal(byTitle.Trip.lane, 0);
  assert.equal(byTitle.Trip.first, 0);
  assert.equal(byTitle.Trip.last, 2);
  assert.equal(byTitle.Timed.lane, 1);
  assert.equal(byTitle.Thanks.lane, 0); // reuses lane 0 after the trip ends
  assert.equal(lanes, 2);
});

test("ISO week numbers", () => {
  const { m } = setup();
  assert.equal(m._weekNumber(new Date(2026, 10, 23)), 48); // Monday-start row
  assert.equal(m._weekNumber(new Date(2026, 10, 22)), 48); // Sunday-start row, same majority week
  assert.equal(m._weekNumber(new Date(2026, 11, 28)), 53);
});

test("time format follows MagicMirror (12h compact like the original, 24h)", () => {
  const { m } = setup();
  assert.equal(m._formatTime(new Date(2026, 0, 1, 9, 0)), "9am");
  assert.equal(m._formatTime(new Date(2026, 0, 1, 13, 5)), "1:05pm");
  assert.equal(m._formatTime(new Date(2026, 0, 1, 0, 30)), "12:30am");
  m.config.timeFormat = 24;
  assert.equal(m._formatTime(new Date(2026, 0, 1, 13, 5)), "13:05");
});

test("luminance of hex and rgb colors", () => {
  const { m } = setup();
  assert.ok(m._luminance("#ffffff") > 250);
  assert.ok(m._luminance("#000") < 1);
  assert.ok(Math.abs(m._luminance("rgb(255, 0, 0)") - 76.245) < 0.01);
});

test("getDom: title, today, other-month, events, labels and until-time", () => {
  const { m, timers } = setup({ displaySymbol: true, eventLayout: "compact" });
  feed(m, timers, [
    ev("Thanksgiving", ms(2026, 10, 26), ms(2026, 10, 27), { fullDayEvent: true, color: "#34d399", calendarName: "Holidays" }),
    ev("Pickleball", ms(2026, 10, 23, 9), ms(2026, 10, 23, 10, 30), { color: "#60a5fa", calendarName: "Family", symbol: ["calendar"] }),
    ev("Road trip", ms(2026, 10, 28, 8), ms(2026, 11, 1, 17), { calendarName: "Family" })
  ]);
  const dom = m.getDom();
  assert.equal(dom.findAll("gmc-heading-main")[0].textContent, "November");
  assert.equal(dom.findAll("gmc-heading-sub")[0].textContent, "2026");
  assert.equal(dom.findAll("gmc-week").length, 5);
  const today = dom.findAll("gmc-today");
  assert.equal(today.length, 1);
  assert.equal(today[0].text(), "23");
  assert.equal(dom.findAll("gmc-other-month").length, 5); // Dec 1-5
  const labels = dom.findAll("gmc-date-num").map((e) => e.textContent);
  assert.equal(labels[0], "Nov 1");
  assert.ok(labels.includes("Dec 1"));

  const events = dom.findAll("gmc-event");
  const pick = events.find((e) => e.text().includes("Pickleball"));
  assert.match(pick.text(), /9amPickleball/);
  assert.equal(pick.findAll("fa-calendar").length, 1);
  assert.equal(pick.style["--gmc-ev"], "#60a5fa");
  const trip = events.filter((e) => e.text().includes("Road trip"));
  assert.equal(trip.length, 2); // split across two weeks
  assert.match(trip[0].text(), /^8amRoad trip$/);
  assert.ok(trip[0].classList.contains("gmc-continues-right"));
  assert.match(trip[1].text(), /Road trip until 5pm$/);
  assert.ok(trip[1].classList.contains("gmc-continues-left"));

  // Legend lists both calendars
  assert.equal(dom.findAll("gmc-legend-item").length, 2);
});

test("maxEventLanes collapses the rest into +N more", () => {
  const { m, timers } = setup({ maxEventLanes: 1, eventLayout: "compact" });
  feed(m, timers, [
    ev("One", ms(2026, 10, 24, 9), ms(2026, 10, 24, 10)),
    ev("Two", ms(2026, 10, 24, 11), ms(2026, 10, 24, 12)),
    ev("Three", ms(2026, 10, 24, 13), ms(2026, 10, 24, 14))
  ]);
  const dom = m.getDom();
  assert.equal(dom.findAll("gmc-event").length, 1);
  const more = dom.findAll("gmc-more");
  assert.equal(more.length, 1);
  assert.equal(more[0].textContent, "+2 more");
});

test("solid style keeps the original color behaviour", () => {
  const { m, timers } = setup({ eventStyle: "solid", eventLayout: "compact" });
  feed(m, timers, [
    ev("Light", ms(2026, 10, 26), ms(2026, 10, 27), { fullDayEvent: true, color: "#ffeb3b" }),
    ev("Dark", ms(2026, 10, 27), ms(2026, 10, 28), { fullDayEvent: true, color: "#1e3a8a" }),
    ev("Timed", ms(2026, 10, 24, 9), ms(2026, 10, 24, 10), { color: "#f472b6" })
  ]);
  const events = m.getDom().findAll("gmc-event");
  const get = (t) => events.find((e) => e.text().includes(t));
  assert.ok(get("Light").classList.contains("gmc-light-bg"));
  assert.ok(get("Dark").classList.contains("gmc-dark-bg"));
  assert.equal(get("Timed").style.color, "#f472b6");
  assert.equal(get("Timed").findAll("gmc-dot").length, 0);
});

test("week mode title shows the date range; week numbers add a column", () => {
  const { m } = setup({ mode: "fourWeeks", showWeekNumber: true });
  const dom = m.getDom();
  assert.equal(dom.findAll("gmc-heading-main")[0].textContent, "Nov 22 – Dec 19");
  assert.equal(dom.findAll("gmc-weeknum").length, 4);
  assert.match(dom.style["--gmc-columns"], /^3\.2ch /);
});

test("touch buttons: press shows at once, then the view changes and the button flashes", () => {
  const { m, timers } = setup();
  const dom = m.getDom();
  const btns = dom.findAll("gmc-nav")[0].findAll("gmc-nav-btn");
  assert.equal(btns.length, 3);
  btns[2].listeners.pointerdown({});
  assert.ok(btns[2].classList.contains("gmc-pressed"));
  btns[2].listeners.pointerup({});
  assert.ok(!btns[2].classList.contains("gmc-pressed"));

  btns[2].listeners.click({});
  assert.ok(btns[2].classList.contains("gmc-pressed")); // visible before the redraw
  assert.equal(m.navOffset, 0);
  const t = timers.at(-1);
  assert.ok(t.ms > 0 && t.ms <= 200);
  t.fn();
  assert.equal(m.navOffset, 1);
  const redrawn = m.getDom();
  assert.equal(redrawn.findAll("gmc-heading-main")[0].textContent, "December");
  const next = redrawn.findAll("gmc-nav")[0].findAll("gmc-nav-btn")[2];
  assert.ok(next.classList.contains("gmc-nav-flash"));
  // only once
  assert.ok(!m.getDom().findAll("gmc-nav")[0].findAll("gmc-nav-btn")[2].classList.contains("gmc-nav-flash"));
});

test("sunrise and sunset (Chicago, 23 Nov 2026)", () => {
  const { m } = setup();
  const sun = m._sunTimes(new Date(2026, 10, 23, 12), 41.88, -87.63);
  const near = (d, iso) => Math.abs(d - new Date(iso)) < 5 * 60000;
  assert.ok(near(sun.rise, "2026-11-23T12:51:00Z"), sun.rise.toISOString());
  assert.ok(near(sun.set, "2026-11-23T22:23:00Z"), sun.set.toISOString());
});

test("dayMode: day / night / none / auto with fixed hours", () => {
  let { m } = setup({ dayMode: "day" });
  assert.ok(m.getDom().classList.contains("gmc-light"));
  ({ m } = setup({ dayMode: "night" }));
  assert.ok(!m.getDom().classList.contains("gmc-light"));
  ({ m } = setup());
  assert.equal(m.isDay, null);
  assert.ok(!m.getDom().classList.contains("gmc-light"));
  // now is 20:46: night with the default 07:00-19:00, day with 07:00-21:00
  ({ m } = setup({ dayMode: "auto" }));
  assert.equal(m.isDay, false);
  ({ m } = setup({ dayMode: "auto", dayEnd: "21:00" }));
  assert.equal(m.isDay, true);
  assert.equal(m._computeIsDay(new Date(2026, 10, 24, 6, 59)), false);
  assert.equal(m._computeIsDay(new Date(2026, 10, 24, 7, 0)), true);
});

test("dayMode auto with coordinates schedules a check and toggles the live window", () => {
  const { m, timers } = setup({ dayMode: "auto", latitude: 41.88, longitude: -87.63 });
  const win = m.getDom();
  const tick = timers.find((t) => t.interval);
  assert.equal(tick.ms, 60000);
  m._computeIsDay = () => !m.isDay; // pretend the sun just came up / went down
  const before = win.classList.contains("gmc-light");
  tick.fn();
  assert.notEqual(win.classList.contains("gmc-light"), before);
});

test("dayMode auto uses sunrise/sunset broadcast by MMM-GlassTempest", () => {
  const { m } = setup({ dayMode: "auto" }); // 20:46, no location: night
  const win = m.getDom();
  assert.equal(m.isDay, false);
  // Broadcast with sunset at 21:30 local: now (20:46) is daytime
  m.notificationReceived("AMBIENT_WEATHER_DATA", {
    temperature: 47,
    sunrise: new Date(2026, 10, 23, 6, 51).toISOString(),
    sunset: new Date(2026, 10, 23, 21, 30).toISOString()
  });
  assert.equal(m.isDay, true);
  assert.ok(win.classList.contains("gmc-light"));
  // Yesterday's times still work (moved to today); a week-old payload is ignored
  m.weatherSun = { rise: new Date(2026, 10, 22, 6, 50), set: new Date(2026, 10, 22, 16, 24) };
  assert.equal(m._computeIsDay(new Date(2026, 10, 23, 12)), true);
  assert.equal(m._computeIsDay(new Date(2026, 10, 23, 17)), false);
  m.weatherSun = { rise: new Date(2026, 10, 10, 6, 40), set: new Date(2026, 10, 10, 23, 0) };
  assert.equal(m._computeIsDay(new Date(2026, 10, 23, 22)), false); // falls back to 07:00-19:00
  // Payload without sun times is ignored
  m.notificationReceived("AMBIENT_WEATHER_DATA", { temperature: 50 });
  assert.equal(m.weatherSun.rise.getDate(), 10);
});

test("cards: timed events show title, time range and location; bars stay bars", () => {
  const { m, timers } = setup();
  feed(m, timers, [
    ev("Thanksgiving", ms(2026, 10, 26), ms(2026, 10, 27), { fullDayEvent: true, color: "#34d399" }),
    ev("Coffee with Diane", ms(2026, 10, 25, 9, 45), ms(2026, 10, 25, 11), { color: "#f472b6", location: "Starbucks, 123 Main St\nHouston TX" }),
    ev("Lunch", ms(2026, 10, 25, 11, 30), ms(2026, 10, 25, 13, 15)),
    ev("Road trip", ms(2026, 10, 28, 8), ms(2026, 11, 1, 17))
  ]);
  const dom = m.getDom();
  assert.ok(dom.classList.contains("gmc-layout-cards"));
  const cards = dom.findAll("gmc-card");
  assert.equal(cards.length, 2);
  assert.equal(cards[0].findAll("gmc-card-title-text")[0].textContent, "Coffee with Diane");
  assert.equal(cards[0].findAll("gmc-card-time")[0].text(), "9:45 – 11am");
  assert.equal(cards[0].findAll("gmc-card-location")[0].text(), "Starbucks, 123 Main St");
  assert.equal(cards[1].findAll("gmc-card-time")[0].text(), "11:30am – 1:15pm");
  assert.equal(cards[1].findAll("gmc-card-location").length, 0);
  // all-day and multi-day events are still bars
  const bars = dom.findAll("gmc-event-bar").map((b) => b.text());
  assert.ok(bars.some((t) => t.includes("Thanksgiving")));
  assert.equal(bars.filter((t) => t.includes("Road trip")).length, 2);
});

test("cards: showEndTime / showLocation off, 24-hour ranges", () => {
  const { m, timers } = setup({ showEndTime: false, showLocation: false });
  feed(m, timers, [ev("Golf", ms(2026, 10, 25, 10, 30), ms(2026, 10, 25, 11, 45), { location: "Club" })]);
  const card = m.getDom().findAll("gmc-card")[0];
  assert.equal(card.findAll("gmc-card-line").length, 1);
  assert.equal(card.findAll("gmc-card-time")[0].text(), "10:30am");
  m.config.timeFormat = 24;
  assert.equal(m._formatRange(new Date(2026, 0, 1, 13), new Date(2026, 0, 1, 14, 30)), "13:00 – 14:30");
});

test("fill: rows share the screen height and extra cards become +N more", () => {
  const { m, timers } = setup({ mode: "fourWeeks" });
  // 1920x1080 screen with MagicMirror's 60 px body margins
  m._viewport = () => ({ width: 1800, height: 960 });
  const day = (h, i) => ev(`Event ${i}`, ms(2026, 10, 25, h), ms(2026, 10, 25, h, 30));
  feed(m, timers, [8, 9, 10, 11, 12, 13, 14].map(day));
  const dom = m.getDom();
  assert.equal(dom.style.width, "1390px"); // 1800 - 380 - 30
  const rows = dom.findAll("gmc-week");
  const rowPx = parseInt(rows[0].style.height, 10);
  // 960 - (78 + 26 + 40 + 3) = 813, / 4 weeks
  assert.equal(rowPx, 203);
  const shown = dom.findAll("gmc-card").length;
  const more = dom.findAll("gmc-more");
  assert.equal(more.length, 1);
  assert.equal(more[0].textContent, `+${7 - shown} more`);
  // everything shown fits in the row
  const M = m.METRICS;
  const used = shown * (m._cardHeight(1, 1) + M.cardGap) + M.more;
  assert.ok(used <= rowPx - M.label - M.rowPad - M.rowBorder, `${used} > room`);
  assert.ok(shown >= 3);
});

test("fill: long titles get two lines when the column is narrow", () => {
  const { m } = setup();
  const ctx = { colWidth: 170 };
  assert.equal(m._titleLines("Golf", ctx), 1);
  assert.equal(m._titleLines("Cataract surgery follow-up appointment", ctx), 2);
  m.config.titleLines = 1;
  assert.equal(m._titleLines("Cataract surgery follow-up appointment", ctx), 1);
});

test("height auto and explicit widths keep the old sizing", () => {
  const { m } = setup({ height: "auto", width: "100%" });
  m._viewport = () => ({ width: 1800, height: 960 });
  const dom = m.getDom();
  assert.equal(dom.style.width, "100%");
  assert.equal(dom.findAll("gmc-week")[0].style.height, undefined);
});

test("calendars without their own color get different colors; set colors are kept", () => {
  const { m, timers } = setup();
  feed(m, timers, [
    ev("A", ms(2026, 10, 25, 9), ms(2026, 10, 25, 10), { calendarName: "Scott", color: "#fff" }),
    ev("B", ms(2026, 10, 25, 11), ms(2026, 10, 25, 12), { calendarName: "Family", color: "#ffffff" }),
    ev("C", ms(2026, 10, 25, 13), ms(2026, 10, 25, 14), { calendarName: "Holidays" }),
    ev("D", ms(2026, 10, 26, 9), ms(2026, 10, 26, 10), { calendarName: "Scott", color: "#fff" }),
    ev("E", ms(2026, 10, 27, 9), ms(2026, 10, 27, 10), { calendarName: "Work", color: "#60a5fa" })
  ]);
  const col = (t) => m.events.find((e) => e.title === t).color;
  assert.equal(col("A"), col("D")); // same calendar, same color
  const auto = new Set([col("A"), col("B"), col("C")]);
  assert.equal(auto.size, 3); // three calendars, three colors
  assert.equal(col("E"), "#60a5fa"); // a color set in config.js is kept...
  assert.ok(!auto.has("#60a5fa")); // ...and not reused for another calendar
  // stable across updates: same assignment on the next broadcast
  const before = col("B");
  feed(m, timers, [ev("B", ms(2026, 10, 25, 11), ms(2026, 10, 25, 12), { calendarName: "Family", color: "#fff" }),
    ev("A", ms(2026, 10, 25, 9), ms(2026, 10, 25, 10), { calendarName: "Scott", color: "#fff" }),
    ev("C", ms(2026, 10, 25, 13), ms(2026, 10, 25, 14), { calendarName: "Holidays" }),
    ev("E", ms(2026, 10, 27, 9), ms(2026, 10, 27, 10), { calendarName: "Work", color: "#60a5fa" })]);
  assert.equal(col("B"), before);
  // the legend lists each calendar with its color
  assert.equal(m.getDom().findAll("gmc-legend-item").length, 4);
});

test("calendarColors off keeps the colors as sent", () => {
  const { m, timers } = setup({ calendarColors: "off" });
  feed(m, timers, [ev("A", ms(2026, 10, 25, 9), ms(2026, 10, 25, 10), { calendarName: "Scott", color: "#fff" })]);
  assert.equal(m.events[0].color, "#fff");
});

test("tapping an event opens a card with everything known about it", () => {
  const { m, timers } = setup({ mode: "fourWeeks" });
  feed(m, timers, [
    ev("Cataract surgery", ms(2026, 11, 14, 8), ms(2026, 11, 14, 10), {
      calendarName: "Scott", color: "#34d399", location: "Houston Eye Associates\n2855 Gramercy St",
      description: "Arrive 30 min early.<br>Bring <b>insurance card</b> &amp; photo ID.\\nDriver needed: Rudy"
    })
  ]);
  const dom = m.getDom();
  const card = dom.findAll("gmc-card")[0];
  assert.ok(card.classList.contains("gmc-tappable"));
  card.listeners.click({});
  const overlay = m.popupEl;
  assert.ok(overlay && overlay.parentNode); // on the page
  const pop = overlay.findAll("gmc-popup")[0];
  assert.equal(pop.style["--gmc-ev"], "#34d399");
  assert.equal(pop.findAll("gmc-popup-calendar")[0].text(), "Scott");
  assert.equal(pop.findAll("gmc-popup-title")[0].text(), "Cataract surgery");
  const rows = pop.findAll("gmc-popup-row").map((r) => r.text());
  assert.equal(rows[0], "Monday, December 14, 2026");
  assert.equal(rows[1], "8 – 10am (2 hr)");
  assert.equal(rows[2], "Houston Eye Associates\n2855 Gramercy St");
  const notes = pop.findAll("gmc-popup-notes")[0].textContent;
  assert.equal(notes, "Arrive 30 min early.\nBring insurance card & photo ID.\nDriver needed: Rudy");
  // close button removes it
  pop.findAll("gmc-popup-close")[0].listeners.click({});
  assert.equal(m.popupEl, null);
  assert.equal(overlay.parentNode, null);
});

test("popup closes by itself after popupTimeout and when navigating", () => {
  const { m, timers } = setup({ popupTimeout: 30 });
  feed(m, timers, [ev("Golf", ms(2026, 10, 25, 10), ms(2026, 10, 25, 12))]);
  m._openEvent(m.events[0]);
  const t = timers.at(-1);
  assert.equal(t.ms, 30000);
  t.fn();
  assert.equal(m.popupEl, null);
  m._openEvent(m.events[0]);
  m._navigate(1);
  assert.equal(m.popupEl, null);
});

test("all-day, multi-day and now/ended wording", () => {
  const { m, timers } = setup();
  feed(m, timers, [
    ev("Thanksgiving", ms(2026, 10, 26), ms(2026, 10, 27), { fullDayEvent: true }),
    ev("Grandkids visiting", ms(2026, 10, 21), ms(2026, 10, 25), { fullDayEvent: true }),
    ev("Call", ms(2026, 10, 23, 20, 30), ms(2026, 10, 23, 21)),
    ev("Pickleball", ms(2026, 10, 23, 9), ms(2026, 10, 23, 10, 30))
  ]);
  const rows = (t) => m._openEvent(m.events.find((e) => e.title === t)).findAll("gmc-popup-row").map((r) => r.text());
  assert.deepEqual([...rows("Thanksgiving")], ["Thursday, November 26, 2026", "All day"]);
  assert.deepEqual([...rows("Grandkids visiting")], ["Sat, Nov 21 – Tue, Nov 24", "All day · 4 days · Happening now"]);
  assert.equal(rows("Call")[1], "8:30 – 9pm (30 min) · Happening now");
  assert.equal(rows("Pickleball")[1], "9 – 10:30am (1.5 hr) · Ended");
});

test("+N more opens the day's full list; an item opens its details", () => {
  const { m, timers } = setup({ mode: "fourWeeks" });
  m._viewport = () => ({ width: 1800, height: 960 });
  feed(m, timers, [8, 9, 10, 11, 12, 13].map((h) => ev(`Event ${h}`, ms(2026, 10, 25, h), ms(2026, 10, 25, h, 30)))
    .concat([ev("Holiday", ms(2026, 10, 25), ms(2026, 10, 26), { fullDayEvent: true })]));
  const more = m.getDom().findAll("gmc-more")[0];
  more.listeners.click({});
  const items = m.popupEl.findAll("gmc-popup-item");
  assert.equal(items.length, 7);
  assert.equal(items[0].text().startsWith("All day"), true);
  items[3].listeners.click({});
  assert.equal(m.popupEl.findAll("gmc-popup-title")[0].text(), "Event 10");
});

test("eventPopup: false leaves events untappable", () => {
  const { m, timers } = setup({ eventPopup: false });
  feed(m, timers, [ev("Golf", ms(2026, 10, 25, 10), ms(2026, 10, 25, 12))]);
  const card = m.getDom().findAll("gmc-card")[0];
  assert.ok(!card.classList.contains("gmc-tappable"));
  assert.equal(card.listeners.click, undefined);
});

const tap = (m, timers, el) => {
  m.lastPress = 0; // the test clock is frozen, so two taps would look like a double tap
  el.listeners.click({});
  const t = timers.at(-1);
  if (t && t.ms === 140) t.fn(); // buttons act after their press flash
};

test("calendar button toggles between 2 and 4 weeks", () => {
  const { m, timers } = setup({ mode: "fourWeeks" });
  let btn = m.getDom().findAll("gmc-view-toggle");
  assert.equal(btn.length, 1);
  assert.equal(btn[0].findAll("fa-calendar-days").length, 1);
  assert.equal(btn[0].attrs["aria-label"], "Show 2 Weeks");
  tap(m, timers, btn[0]);
  let dom = m.getDom();
  assert.equal(dom.findAll("gmc-week").length, 2);
  btn = dom.findAll("gmc-view-toggle");
  assert.equal(btn[0].attrs["aria-label"], "Show 4 Weeks");
  assert.ok(btn[0].classList.contains("gmc-nav-flash")); // the press is confirmed after the change
  tap(m, timers, btn[0]);
  assert.equal(m.getDom().findAll("gmc-week").length, 4);
});

test("a mode outside viewSwitch steps to the first view; Month can be added back", () => {
  const { m, timers } = setup({ mode: "currentMonth" });
  tap(m, timers, m.getDom().findAll("gmc-view-toggle")[0]);
  assert.equal(m._mode(), "twoweeks");
  const r = setup({ viewSwitch: ["twoWeeks", "fourWeeks", "currentMonth"], mode: "fourWeeks" });
  tap(r.m, r.timers, r.m.getDom().findAll("gmc-view-toggle")[0]);
  assert.equal(r.m._mode(), "currentmonth");
});

test("switching views keeps the dates you were looking at", () => {
  const { m } = setup({ mode: "fourWeeks" });
  m._navigate(1); // Dec 20 – Jan 16
  m._setView("twoWeeks");
  assert.equal(ymd(m._range(new Date(NOW)).start), "2026-12-20");
  m._setView("currentMonth");
  assert.equal(m._range(new Date(NOW)).month.getMonth(), 11);
  m._navigate(0); // Today
  assert.equal(m._range(new Date(NOW)).month.getMonth(), 10);
  assert.equal(m._mode(), "currentmonth"); // the picked view stays
});

test("month picker: tap the title, pick a month; week views start at its first week", () => {
  const { m, timers } = setup({ mode: "fourWeeks" });
  const heading = m.getDom().findAll("gmc-heading")[0];
  heading.listeners.click({});
  const card = m.popupEl.findAll("gmc-popup-months")[0];
  assert.equal(card.findAll("gmc-months-year")[0].text(), "2026");
  const tiles = card.findAll("gmc-month-tile");
  assert.equal(tiles.length, 12);
  assert.ok(tiles[10].classList.contains("gmc-month-now"));
  assert.ok(tiles[10].classList.contains("gmc-month-shown"));
  // next year, then March
  card.findAll("gmc-months-head")[0].children[2].listeners.click({});
  const card2 = m.popupEl.findAll("gmc-popup-months")[0];
  assert.equal(card2.findAll("gmc-months-year")[0].text(), "2027");
  card2.findAll("gmc-month-tile")[2].listeners.click({});
  assert.equal(m.popupEl, null);
  const r = m._range(new Date(NOW));
  assert.equal(ymd(r.start), "2027-2-28"); // the week holding 1 March 2027
  assert.equal(r.weeks, 4);
  // the picker now marks March 2027 as shown
  m.getDom().findAll("gmc-heading")[0].listeners.click({});
  assert.ok(m.popupEl.findAll("gmc-month-tile")[2].classList.contains("gmc-month-shown"));
  // Today goes back, and the auto-return timer was set
  m._navigate(0);
  assert.equal(ymd(m._range(new Date(NOW)).start), "2026-11-22");
});

test("month picker in month view shows the whole month; arrows step from there", () => {
  const { m } = setup({ mode: "currentMonth" });
  m._showMonth(2027, 6);
  assert.equal(m._range(new Date(NOW)).month.getMonth(), 6);
  m._navigate(1);
  assert.equal(m._range(new Date(NOW)).month.getMonth(), 7);
  m._showMonth(2026, 10);
  assert.ok(m._atToday());
});

test("viewSwitch [] and monthPicker false hide the controls", () => {
  const { m } = setup({ viewSwitch: [], monthPicker: false });
  const dom = m.getDom();
  assert.equal(dom.findAll("gmc-view-toggle").length, 0);
  assert.equal(dom.findAll("gmc-heading")[0].listeners.click, undefined);
});

test("empty notes and location (sent as false) are left out of the popup", () => {
  const { m, timers } = setup();
  feed(m, timers, [ev("Golf", ms(2026, 10, 25, 10), ms(2026, 10, 25, 12), { description: false, location: false })]);
  const card = m._openEvent(m.events[0]);
  assert.equal(card.findAll("gmc-popup-notes").length, 0);
  assert.equal(card.findAll("gmc-popup-label").length, 0);
  assert.equal(card.findAll("gmc-popup-location").length, 0);
  assert.ok(!card.text().includes("false"));
  // and the card in the grid shows no location line either
  assert.equal(m.getDom().findAll("gmc-card-location").length, 0);
  assert.equal(m._plainText(""), "");
  assert.equal(m._plainText("   "), "");
});

test("the details card closes after 30 seconds by default; popupTimeout changes it", () => {
  let { m, timers } = setup();
  feed(m, timers, [ev("Golf", ms(2026, 10, 25, 10), ms(2026, 10, 25, 12))]);
  m._openEvent(m.events[0]);
  assert.equal(timers.at(-1).ms, 30000);
  ({ m, timers } = setup({ popupTimeout: 90 }));
  feed(m, timers, [ev("Golf", ms(2026, 10, 25, 10), ms(2026, 10, 25, 12))]);
  m._openEvent(m.events[0]);
  assert.equal(timers.at(-1).ms, 90000);
  ({ m, timers } = setup({ popupTimeout: 0 }));
  feed(m, timers, [ev("Golf", ms(2026, 10, 25, 10), ms(2026, 10, 25, 12))]);
  const before = timers.length;
  m._openEvent(m.events[0]);
  assert.equal(timers.length, before); // no auto-close
});
