"use client";

import { useActionState, useState } from "react";
import styles from "../admin.module.css";
import { runImport, type ImportState } from "./import-actions";

export default function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(runImport, { stage: "idle" });
  const [text, setText] = useState("");

  return (
    <form action={action} className={styles.list}>
      <input
        type="file"
        accept=".csv,.tsv,.txt"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) setText(await file.text());
        }}
      />
      <textarea
        name="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder={"Name\tRole\tHub\tEmail\tMobile\nRahul Kumar\tIM\tBangalore\trahul@example.com\t9876543210"}
        className={styles.textarea}
      />

      <div className={styles.row}>
        <button type="submit" name="intent" value="preview" disabled={pending || !text.trim()}>
          Preview
        </button>
        {state.stage === "preview" && state.errors.length === 0 && state.adds.length > 0 && (
          <button type="submit" name="intent" value="commit" disabled={pending}>
            Import {state.adds.length} {state.adds.length === 1 ? "person" : "people"}
          </button>
        )}
      </div>

      {state.stage === "done" && (
        <p>
          Imported {state.added} {state.added === 1 ? "person" : "people"}
          {state.skipped > 0 && `, skipped ${state.skipped} that already existed`}.
        </p>
      )}

      {state.stage === "preview" && (
        <>
          {state.errors.length > 0 && (
            <div>
              <p className={styles.error}>Fix these rows, then preview again. Nothing was saved.</p>
              <ul>
                {state.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {state.adds.length > 0 && (
            <div>
              <p className={styles.muted}>Will add {state.adds.length}:</p>
              <ul>
                {state.adds.map((p, i) => (
                  <li key={i}>
                    {p.name} · {p.role.toUpperCase()} · {p.hub}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {state.skipped.length > 0 && (
            <div>
              <p className={styles.muted}>Will skip {state.skipped.length}:</p>
              <ul>
                {state.skipped.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {state.errors.length === 0 && state.adds.length === 0 && (
            <p className={styles.muted}>Nothing new to import.</p>
          )}
        </>
      )}
    </form>
  );
}