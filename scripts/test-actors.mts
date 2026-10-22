import assert from "node:assert/strict";
import { actorOptions, allowedActors, defaultActor, resolveActor } from "../src/lib/actors";
import type { AppUser, Person } from "../src/lib/schema";

const person = (id: string, name: string, role: Person["role"], active = "true"): Person => ({
  person_id: id, name, role, hub: "bangalore", linked_user: "", active,
});
const user = (email: string, role: AppUser["role"], person_id = "", active = ""): AppUser => ({ email, role, person_id, active, secondary_role: "" });

const people = [
  person("p-mihir", "Mihir", "im"),
  person("p-asha", "Asha", "im"),
  person("p-old", "Old IM", "im", "false"),
  person("p-ravi", "Ravi", "fo"),
  person("p-suresh", "Suresh", "rig"),
];
const users = [
  user("Sraj@x.com", "admin"),
  user("ayadav@x.com", "admin", "p-asha"), // admin who is also the IM Asha: listed once, as a person
  user("gone@x.com", "admin", "", "false"),
  user("mihir@x.com", "im", "p-mihir"),
];

const options = actorOptions(people, users, (h) => h.toUpperCase());
assert.deepEqual(options.map((o) => o.value), ["p-asha", "p-mihir", "p-suresh", "sraj@x.com"]);
assert.equal(options[1].label, "Mihir (IM, BANGALORE)");
assert.equal(options[2].label, "Suresh (Rig, BANGALORE)");
assert.equal(options[3].label, "Sraj@x.com (Admin)");

// IMs and rig team members, plus admins: not FOs, not inactive people, not inactive admins.
assert.ok(!options.some((o) => ["p-ravi", "p-old", "gone@x.com"].includes(o.value)));

// Default is the linked person, or the admin's email in lower case.
assert.equal(defaultActor({ personId: "p-mihir", email: "mihir@x.com" }), "p-mihir");
assert.equal(defaultActor({ personId: "", email: "Sraj@X.com" }), "sraj@x.com");

// Only listed values are accepted.
assert.equal(resolveActor("p-mihir", options), "p-mihir");
assert.equal(resolveActor("p-ravi", options), undefined);
assert.equal(resolveActor("", options), undefined);

// Admins may act as anyone on the list. An IM may only act as themselves.
const admin = { role: "admin" as const, personId: "", email: "Sraj@x.com" };
assert.deepEqual(allowedActors(admin, options).map((o) => o.value), ["p-asha", "p-mihir", "p-suresh", "sraj@x.com"]);

const mihir = { role: "im" as const, personId: "p-mihir", email: "mihir@x.com" };
assert.deepEqual(allowedActors(mihir, options).map((o) => o.value), ["p-mihir"]);
// The form can ask for someone else, but the allowed list is what the server checks against.
assert.equal(resolveActor("p-asha", allowedActors(mihir, options)), undefined);
assert.equal(resolveActor("sraj@x.com", allowedActors(mihir, options)), undefined);
assert.equal(resolveActor("p-mihir", allowedActors(mihir, options)), "p-mihir");

// A rig team member gets exactly the same treatment as an IM: only themselves, same as everyone non-admin.
const suresh = { role: "rig" as const, personId: "p-suresh", email: "suresh@x.com" };
assert.deepEqual(allowedActors(suresh, options).map((o) => o.value), ["p-suresh"]);
assert.equal(resolveActor("p-mihir", allowedActors(suresh, options)), undefined);
assert.equal(resolveActor("p-suresh", allowedActors(suresh, options)), "p-suresh");

// An IM whose login is not linked to a person, or linked to someone inactive, gets no options at all.
assert.deepEqual(allowedActors({ role: "im", personId: "", email: "new@x.com" }, options), []);
assert.deepEqual(allowedActors({ role: "im", personId: "p-old", email: "old@x.com" }, options), []);

console.log("actors tests passed");
