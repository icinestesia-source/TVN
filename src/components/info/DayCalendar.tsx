import { useEffect, useId, useRef, useState } from 'react'
import { addDaysIso, localDayIso } from '../../info/football/normalize.ts'
import { keepKey } from '../keep-key.ts'

function monthStartIso(dayIso: string): string {
  return `${dayIso.slice(0, 7)}-01`
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

function formatMonthLabel(dayIso: string): string {
  const ms = Date.parse(`${dayIso}T12:00:00`)
  if (!Number.isFinite(ms)) return dayIso.slice(0, 7)
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(ms)
}

export function formatSelectedDayLabel(dayIso: string): string {
  const ms = Date.parse(`${dayIso}T12:00:00`)
  if (!Number.isFinite(ms)) return dayIso
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(ms)
}

/**
 * Lightweight accessible day picker — no calendar dependency.
 * Days with published match data can be marked; any date remains selectable.
 */
export function DayCalendar({
  selectedDayIso,
  onSelect,
  daysWithData,
}: {
  selectedDayIso: string
  onSelect: (dayIso: string) => void
  daysWithData?: ReadonlySet<string>
}) {
  const [open, setOpen] = useState(false)
  const [viewMonthIso, setViewMonthIso] = useState(() => monthStartIso(selectedDayIso))
  const rootRef = useRef<HTMLDivElement>(null)
  const dialogId = useId()
  const today = localDayIso()

  useEffect(() => {
    if (!open) return
    setViewMonthIso(monthStartIso(selectedDayIso))
  }, [open, selectedDayIso])

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const year = Number(viewMonthIso.slice(0, 4))
  const monthIndex = Number(viewMonthIso.slice(5, 7)) - 1
  const firstWeekday = new Date(year, monthIndex, 1).getDay()
  const count = daysInMonth(year, monthIndex)
  const cells: (string | null)[] = []
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null)
  for (let day = 1; day <= count; day += 1) {
    cells.push(`${viewMonthIso.slice(0, 7)}-${String(day).padStart(2, '0')}`)
  }

  const shiftMonth = (delta: number) => {
    const next = new Date(year, monthIndex + delta, 1)
    const y = next.getFullYear()
    const m = String(next.getMonth() + 1).padStart(2, '0')
    setViewMonthIso(`${y}-${m}-01`)
  }

  return (
    <div className="info-day-calendar" ref={rootRef}>
      <button
        type="button"
        className={open ? 'tab is-on' : 'tab'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        title="Open calendar"
        onKeyDown={keepKey}
        onClick={() => setOpen((value) => !value)}
      >
        Calendar
      </button>
      {open ? (
        <div className="info-day-calendar-popover" id={dialogId} role="dialog" aria-label="Choose match date">
          <div className="info-day-calendar-head">
            <button type="button" className="tab" aria-label="Previous month" onKeyDown={keepKey} onClick={() => shiftMonth(-1)}>
              ‹
            </button>
            <span className="info-day-calendar-month">{formatMonthLabel(viewMonthIso)}</span>
            <button type="button" className="tab" aria-label="Next month" onKeyDown={keepKey} onClick={() => shiftMonth(1)}>
              ›
            </button>
          </div>
          <div className="info-day-calendar-weekdays" aria-hidden="true">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="info-day-calendar-grid" role="grid" aria-label={formatMonthLabel(viewMonthIso)}>
            {cells.map((dayIso, index) =>
              dayIso ? (
                <button
                  key={dayIso}
                  type="button"
                  role="gridcell"
                  className={[
                    'info-day-calendar-cell',
                    dayIso === selectedDayIso ? 'is-selected' : '',
                    dayIso === today ? 'is-today' : '',
                    daysWithData?.has(dayIso) ? 'has-data' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-selected={dayIso === selectedDayIso}
                  aria-current={dayIso === today ? 'date' : undefined}
                  onKeyDown={keepKey}
                  onClick={() => {
                    onSelect(dayIso)
                    setOpen(false)
                  }}
                >
                  {Number(dayIso.slice(8, 10))}
                </button>
              ) : (
                <span key={`pad-${index}`} className="info-day-calendar-cell is-pad" />
              ),
            )}
          </div>
          <button
            type="button"
            className="tab"
            onKeyDown={keepKey}
            onClick={() => {
              onSelect(today)
              setViewMonthIso(monthStartIso(today))
              setOpen(false)
            }}
          >
            Today
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** Shift a YYYY-MM-DD calendar day by whole days (local calendar semantics). */
export function shiftSelectedDay(dayIso: string, delta: number): string {
  return addDaysIso(dayIso, delta)
}
