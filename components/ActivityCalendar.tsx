'use client'

import { useState } from 'react'
import { todayIST } from '@/lib/formatDate'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const pad = (n: number) => String(n).padStart(2, '0')
const dateKey = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`

// Month-grid date picker for the Activity Log's date filter. A dot marks
// days that actually have recorded activity, so staff aren't clicking
// through empty dates — days with nothing recorded aren't clickable at all.
export default function ActivityCalendar({
  activeDates,
  selectedDate,
  onSelectDate,
}: {
  activeDates: Set<string>
  selectedDate: string | null
  onSelectDate: (date: string | null) => void
}) {
  const today = todayIST()
  const [anchor, setAnchor] = useState(() => {
    const [y, m] = (selectedDate || today).split('-').map(Number)
    return { year: y, month: m - 1 }
  })

  const goMonth = (delta: number) => {
    setAnchor((prev) => {
      let month = prev.month + delta
      let year = prev.year
      if (month < 0) {
        month = 11
        year -= 1
      } else if (month > 11) {
        month = 0
        year += 1
      }
      return { year, month }
    })
  }

  const firstWeekday = new Date(anchor.year, anchor.month, 1).getDay()
  const daysInMonth = new Date(anchor.year, anchor.month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg shadow p-4 h-fit">
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => goMonth(-1)}
          className="w-7 h-7 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-100 transition"
        >
          ‹
        </button>
        <span className="text-sm font-semibold text-gray-100">
          {MONTH_NAMES[anchor.month]} {anchor.year}
        </span>
        <button
          type="button"
          onClick={() => goMonth(1)}
          className="w-7 h-7 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-100 transition"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-500 mb-1">
        {WEEKDAY_LABELS.map((label, i) => (
          <div key={i}>{label}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} />

          const key = dateKey(anchor.year, anchor.month, day)
          const hasActivity = activeDates.has(key)
          const isSelected = key === selectedDate
          const isToday = key === today

          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDate(isSelected ? null : key)}
              disabled={!hasActivity}
              className={`relative h-8 rounded-lg text-xs font-semibold transition ${
                isSelected
                  ? 'bg-indigo-600 text-white'
                  : hasActivity
                    ? 'text-gray-100 hover:bg-gray-800'
                    : 'text-gray-700 cursor-default'
              } ${isToday && !isSelected ? 'ring-1 ring-indigo-500' : ''}`}
            >
              {day}
              {hasActivity && !isSelected && (
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-indigo-400" />
              )}
            </button>
          )
        })}
      </div>

      {selectedDate && (
        <button
          type="button"
          onClick={() => onSelectDate(null)}
          className="mt-3 text-xs font-semibold text-indigo-400 hover:text-indigo-300"
        >
          Clear filter — show all
        </button>
      )}
    </div>
  )
}
