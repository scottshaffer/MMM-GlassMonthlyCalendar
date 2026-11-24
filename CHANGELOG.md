# Changelog

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
