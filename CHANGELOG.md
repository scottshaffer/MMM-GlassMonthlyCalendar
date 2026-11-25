# Changelog

## [0.6.2]

- Event popup: an event with no notes or location no longer shows "false" (the calendar module
  sends `false` for empty fields); the Notes section is left out instead.

## [0.6.1]

- The 2 Weeks / 4 Weeks / Month buttons are replaced by one calendar-icon button that switches
  between the 2-week and 4-week views on each tap. `viewSwitch` (default `["twoWeeks", "fourWeeks"]`)
  sets the views it steps through; add `"currentMonth"` to include Month view.

## [0.6.0]

- View switch in the title bar: 2 Weeks / 4 Weeks / Month (`viewSwitch`). The picked view stays;
  switching keeps the same dates in view.
- Month picker (`monthPicker`): tap the title for the 12 months of a year (arrows change the year);
  week views then start at the week holding the month's 1st, Month view shows the whole month.
- `navigationResetSeconds` returns to today but keeps the picked view.

## [0.5.0]

- Tap an event for a details card: calendar name and color, title, date, times and duration (or all
  day), ended / happening now, location and notes (the description, shown as plain text). Tap
  "+N more" for the day's full list. Closes with ✕, a tap outside, `popupTimeout`, or navigation.
- Events show press feedback when touched. New options `eventPopup`, `popupTimeout`.

## [0.4.2]

- Touch buttons: darker background (navy glass at night, deep navy in day mode) and slightly larger
  (52 px). Pressing a button fills it with a bright color at once; the view changes a moment later
  and the button flashes with a spreading ring to confirm the tap. Double taps are ignored.

## [0.4.1]

- Day mode: events are a deep shade of each calendar's color with white text instead of pale tints,
  for legibility on the light glass. `--gmc-day-shade` (default 58%) sets how dark. Past events
  fade less in day mode.

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
