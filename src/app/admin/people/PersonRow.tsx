"use client";

import { useRef } from "react";
import { formatMobile } from "@/lib/mobile";
import type { Hub, Person } from "@/lib/schema";
import styles from "../admin.module.css";
import { savePerson } from "./actions";
import { PERSON_ROLES } from "./filters";

/** Every field applies immediately: text fields on blur (if changed), selects and checkboxes on change. No Save button. */
export default function PersonRow({ person, hubs, keep = "" }: { person: Person; hubs: Hub[]; keep?: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = () => formRef.current?.requestSubmit();

  return (
    <form ref={formRef} action={savePerson} className={styles.row}>
      <input type="hidden" name="person_id" value={person.person_id} />
      {/* The page's current filters, so they stay applied after this save. */}
      <input type="hidden" name="keep" value={keep} />
      <input name="name" defaultValue={person.name} required onBlur={(e) => e.target.value !== person.name && submit()} />
      <select name="role" defaultValue={person.role} onChange={submit}>
        {PERSON_ROLES.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      <select name="hub" defaultValue={person.hub} onChange={submit}>
        {hubs.map((h) => (
          <option key={h.hub_id} value={h.hub_id}>
            {h.name}
          </option>
        ))}
      </select>
      <input
        name="email"
        type="email"
        required
        placeholder="Email (required)"
        aria-label={`${person.name} email`}
        defaultValue={person.linked_user}
        onBlur={(e) => e.target.value !== person.linked_user && submit()}
      />
      <input
        name="mobile"
        type="tel"
        inputMode="numeric"
        required
        placeholder="Mobile (required)"
        aria-label={`${person.name} mobile number`}
        defaultValue={person.mobile ? formatMobile(person.mobile) : ""}
        style={person.mobile ? undefined : { borderColor: "#B42318" }}
        onBlur={(e) => e.target.value.replace(/\D/g, "") !== (person.mobile ?? "") && submit()}
      />
      <label>
        <input type="checkbox" name="active" defaultChecked={person.active !== "false"} onChange={submit} /> Active
      </label>
    </form>
  );
}