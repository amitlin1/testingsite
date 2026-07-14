"use client";
import SearchableCombobox from "./SearchableCombobox";

export interface PeriodOption<V extends string> {
  id: V;
  name: string;
}

/**
 * Period picker built on the unified SearchableCombobox (same look as the
 * "סוג פריט" field). Replaces the small MUI period <Select>s in the history
 * dialogs and charts. Generic over the period value union `V`.
 */
export default function PeriodCombobox<V extends string>({
  value,
  onChange,
  options,
  label = "תקופה",
  width = 170,
}: {
  value: V;
  onChange: (v: V) => void;
  options: PeriodOption<V>[];
  label?: string;
  width?: number | string;
}) {
  return (
    <SearchableCombobox<PeriodOption<V>>
      options={options}
      value={options.find((o) => o.id === value) ?? null}
      onChange={(v) => {
        if (v) onChange(v.id);
      }}
      getOptionLabel={(o) => o.name}
      isOptionEqualToValue={(o, v) => o.id === v.id}
      disableClearable
      floatingLabel={label}
      width={width}
    />
  );
}
