# Changelog

## [0.4.0]

- Each calendar gets its own color: calendars without a `color` in the calendar module (which then
  sends white) get a distinct color from `colorPalette`, in name order, skipping colors already set.
  `calendarColors: "off"` turns this off.

## [0.3.0]

- Event cards (new default `eventLayout: "cards"`): timed events show the title (two lines when
  long), the time range and the location, tinted in the calendar's color; the event happening now
  is highlighted. `eventLayout: "compact"` keeps the one-line entries.
- `height: "fill"` and `width: "fill"` (new defaults): the window uses the full screen height and
  the width beside the Glass cards (`reserveWidth`, `reserveGap`); each day shows as many cards as
  fit, then "+N more". Redraws when the screen size changes.
- New options `showEndTime`, `showLocation`, `titleLines`. `maxEventLanes` now defaults to "as many
  as fit" and limits only the all-day bars in the cards layout.

## [0.2.1]

- `dayMode: "auto"` takes today's sunrise and sunset from MMM-GlassTempest's weather broadcast
  (`sunNotification`, default `AMBIENT_WEATHER_DATA`), so no location is needed.
  `latitude`/`longitude` and `dayStart`/`dayEnd` remain as fallbacks.

## [0.2.0]

- `dayMode` option: `"day"`, `"night"`, or `"auto"` (light from sunrise to sunset at `latitude` /
  `longitude`, or between `dayStart` and `dayEnd`). Light mode no longer needs a theme that sets
  `body.mm-day`.
- `dayModeScope`: `"calendar"` (default) lightens only this window; `"page"` sets `body.mm-day`.

## [0.1.0]

- First release: month / multi-week calendar drawn as a liquid-glass "main window" in the
  MMM-GlassClock / MMM-GlassTempest family.
- Every MMM-MonthlyCalendar mode and option (same names and defaults), fed by the default
  calendar module's CALENDAR_EVENTS broadcast.
- Additions: title bar with month/year or date range, calendar legend, touch navigation with
  auto-return, `maxEventLanes` with "+N more", glass or solid event style, past-event dimming,
  weekend tint, midnight refresh, day mode and the Pi / reduced-motion profile.
- Fixes over the original: nextMonth/lastMonth no longer skip a month on the 29th-31st; the
  grid redraws at midnight even when no new events arrive.
