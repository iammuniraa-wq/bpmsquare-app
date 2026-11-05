"use client";

import CountUp from "@/components/ui/CountUp";
import { formatMoneyCompact, type CurrencyDef } from "@/lib/currency";

/**
 * A figure that counts up once (CountUp). CountUp takes a format function, which a server component cannot pass across the client
 * boundary, so this wrapper takes plain data (the currency definition) and builds the function here.
 */
export default function RichCount({ value, cur }: { value: number; cur?: CurrencyDef }) {
  return <CountUp value={value} format={cur ? (n) => formatMoneyCompact(n, cur, 1) : undefined} />;
}
