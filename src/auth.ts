import NextAuth, { type DefaultSession } from "next-auth";
import { authConfig } from "./auth.config";
import { getStore } from "@/lib/store";
import type { Role } from "@/lib/schema";
import { resolveLinkedPerson, type LoginRole } from "@/lib/user-link";

declare module "next-auth" {
  interface Session {
    user: { role: Role; personId: string; roleRaw?: string; secondaryRole?: Role } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role?: Role;
    roleRaw?: string;
    personId?: string;
    secondaryRole?: Role;
  }
}

// A role as typed in the users tab ("Hardware team", " QC ", "Inventory manager") → its code.
const ROLE_ALIASES: Record<string, Role> = {
  admin: "admin",
  im: "im",
  "inventory manager": "im",
  rig: "rig",
  "rig team": "rig",
  fo: "fo",
  "field officer": "fo",
  hardware: "hardware",
  "hardware team": "hardware",
  qc: "qc",
  "qc team": "qc",
  internal: "internal",
  "internal team": "internal",
};
const normalizeRole = (raw: string | undefined): Role | undefined =>
  ROLE_ALIASES[String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ")];

// Only people listed in the `users` tab can sign in. Role changes apply at next sign-in.
async function findUser(email: string) {
  const users = await getStore().list("users");
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase() && u.active !== "false");
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ profile }) {
      if (!profile?.email || !profile.email_verified) return false;
      return !!(await findUser(profile.email));
    },
    async jwt({ token, profile }) {
      if (profile?.email) {
        // Present only at sign-in, so the sheet is read once per login, not per request.
        const user = await findUser(profile.email);
        const role = normalizeRole(user?.role);
        token.role = role;
        token.roleRaw = user?.role ?? "";
        // Optional second role the person can switch to (Home / Dashboard). Ignored if it equals the primary.
        const secondary = normalizeRole(user?.secondary_role);
        token.secondaryRole = secondary && secondary !== role ? secondary : undefined;
        token.personId = user && role
          ? resolveLinkedPerson({ ...user, role } as { email: string; role: LoginRole; person_id: string }, await getStore().list("people"))
          : "";
      }
      return token;
    },
    session({ session, token }) {
      session.user.role = token.role as Role;
      session.user.personId = token.personId ?? "";
      session.user.roleRaw = token.roleRaw ?? "";
      session.user.secondaryRole = token.secondaryRole;
      return session;
    },
  },
});