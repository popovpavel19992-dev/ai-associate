"use client";

interface SummaryCard {
  label: string;
  value: string;
  subtitle?: string;
}

export function SummaryCards({ cards }: { cards: SummaryCard[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((card, i) => (
        <div
          key={i}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
        >
          <p className="text-xs font-medium text-zinc-500">{card.label}</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-50">{card.value}</p>
          {card.subtitle && (
            <p className="mt-0.5 text-xs text-zinc-500">{card.subtitle}</p>
          )}
        </div>
      ))}
    </div>
  );
}
