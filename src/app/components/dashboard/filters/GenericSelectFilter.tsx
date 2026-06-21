"use client";
import * as React from "react";
import SelectFilter from "./SelectFilter";
import { Option } from "@/types/dashboard";

interface GenericSelectFilterProps {
  label: string;
  options: Option[];
  selectedId: number | null;
  onChange: (id: number | null) => void;
  loading?: boolean;
  width?: number | string;
  placeholder?: string;
  icon?: React.ReactNode;
}

export default function GenericSelectFilter({
  label,
  options,
  selectedId,
  onChange,
  loading,
  width,
  placeholder,
  icon
}: GenericSelectFilterProps) {
    
  const value = React.useMemo(() => 
    options.find(o => o.id === selectedId) || null, 
  [options, selectedId]);

  return (
    <SelectFilter
      label={label}
      options={options}
      value={value}
      onChange={(newValue) => onChange(newValue ? Number(newValue.id) : null)}
      loading={loading}
      width={width}
      placeholder={placeholder}
      icon={icon}
    />
  );
}
