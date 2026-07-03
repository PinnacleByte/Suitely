'use client'

import { Item } from '@/lib/types'
import { formatMoney } from '@/lib/currency'

// Presentational item picker: a grid of catalog items with a quantity
// stepper each. Shared between the checkout wizard and the Folio panel's
// "From Catalog" charge mode — both keep their own quantities state and
// decide what to do with the selection (batch-add now vs. stage for the
// wizard's review step).
export default function ItemGrid({
  items,
  quantities,
  onQuantityChange,
}: {
  items: Item[]
  quantities: Record<string, number>
  onQuantityChange: (itemId: string, quantity: number) => void
}) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-500">No catalog items yet.</p>
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {items.map((item) => {
        const qty = quantities[item.id] || 0
        return (
          <div
            key={item.id}
            className={`p-3 rounded-lg border transition ${
              qty > 0 ? 'border-indigo-500 bg-indigo-500/10' : 'border-gray-800 bg-gray-800/50'
            }`}
          >
            <p className="font-semibold text-gray-100 text-sm truncate">{item.name}</p>
            <p className="text-xs text-gray-400 mb-2">{formatMoney(Number(item.price))}</p>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => onQuantityChange(item.id, Math.max(0, qty - 1))}
                disabled={qty === 0}
                className="w-7 h-7 rounded bg-gray-700 text-gray-200 font-bold hover:bg-gray-600 transition disabled:opacity-40"
              >
                −
              </button>
              <span className="text-gray-100 font-semibold">{qty}</span>
              <button
                type="button"
                onClick={() => onQuantityChange(item.id, qty + 1)}
                className="w-7 h-7 rounded bg-gray-700 text-gray-200 font-bold hover:bg-gray-600 transition"
              >
                +
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
