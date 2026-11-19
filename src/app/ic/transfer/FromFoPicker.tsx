"use client";

import Form from "next/form";
import { useMemo, useState } from "react";
import styles from "../../handover/form.module.css";

export interface FromFoOption {
  id: string;
  name: string;
  city: string;
}

/**
 * The "From" picker at the top of Transfer between FOs: City then FO name, same two-step pattern as
 * the recipient picker below it. Unlike the recipient picker, choosing a name here reloads the page
 * (via a GET form to /ic/transfer?fromCity=&from=) because the server then has to compute that FO's
 * overdue items (lib/handover.ts has no client-reachable equivalent) — city alone only narrows the
 * Name dropdown client-side, same as FoNamePicker.
 */
export default function FromFoPicker({
  fos,
  defaultCity,
  defaultFrom,
}: {
  fos: FromFoOption[];
  defaultCity: string;
  defaultFrom: string;
}) {
  const [city, setCity] = useState(defaultCity);
  const [from, setFrom] = useState(defaultFrom);

  const cities = useMemo(() => [...new Set(fos.map((f) => f.city))].sort((a, b) => a.localeCompare(b)), [fos]);
  const filtered = useMemo(() => fos.filter((f) => !city || f.city === city), [fos, city]);

  return (
    <Form action="/ic/transfer" scroll={false} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <select
        name="fromCity"
        value={city}
        onChange={(e) => {
          setCity(e.target.value);
          setFrom("");
        }}
        aria-label="From city"
      >
        <option value="">All cities</option>
        {cities.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        name="from"
        value={from}
        onChange={(e) => {
          setFrom(e.target.value);
          e.currentTarget.form?.requestSubmit();
        }}
        disabled={!city}
        aria-label="From field officer"
      >
        <option value="">{city ? "Select a field officer" : "Pick a city first"}</option>
        {filtered.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>

      {defaultFrom && (
        <a href="/ic/transfer" className={styles.hint}>
          Clear
        </a>
      )}
    </Form>
  );
}