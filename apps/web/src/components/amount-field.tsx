"use client";

/** A token amount input with the symbol inside the field and optional quick picks. */
export function AmountField({ id, label, value, onChange, symbol, big = false, quick, quickLabel = (item: string) => item }: {
  id: string; label: string; value: string; onChange: (value: string) => void; symbol: string; big?: boolean; quick?: string[];
  quickLabel?: (item: string) => string;
}) {
  return <div>
    <label htmlFor={id} className="font-semibold">{label}</label>
    <div className={`field mt-2 flex items-baseline gap-2 focus-within:border-lilac focus-within:shadow-[0_0_0_4px_rgb(169_139_255/0.2)] ${big ? "py-3" : ""}`}>
      <input id={id} inputMode="decimal" autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)}
        className={`w-full min-w-0 bg-transparent outline-none ${big ? "font-display text-5xl font-extrabold" : "text-lg font-semibold"}`} />
      <span className={`font-semibold text-muted ${big ? "text-xl" : ""}`}>{symbol}</span>
    </div>
    {quick ? <div className="mt-2 flex flex-wrap gap-2">{quick.map((item) => <button key={item} type="button" onClick={() => onChange(item)}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${value === item ? "bg-ink text-white" : "bg-soft hover:bg-[#ebe9f3]"}`}>{quickLabel(item)}</button>)}</div> : null}
  </div>;
}
