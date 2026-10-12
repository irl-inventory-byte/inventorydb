import Link from "next/link";
import { signOut } from "@/auth";
import { requireRole } from "@/lib/authz";
import { ROLE_LABELS, one } from "@/lib/labels";
import type { Role } from "@/lib/schema";
import { istTimestamp } from "@/lib/time";
import styles from "./dashboard/dashboard.module.css";
import { Icon, type IconName } from "./dashboard/icons";

interface Tile {
  href: string;
  title: string;
  desc: string;
  icon: IconName;
  roles: Role[];
}

const HANDLERS: Role[] = ["admin", "im", "rig"];

// A tile only shows for the configured roles.
const WORK: Tile[] = [
  {
    href: "/dashboard/my",
    title: "My dashboard",
    desc: "View my sent items, received items, corrections and activity history.",
    icon: "chart",
    roles: HANDLERS,
  },
  {
    href: "/dashboard",
    title: "Dashboard",
    desc: "Live stock by hub, status and person, with the hub tree.",
    icon: "chart",
    roles: ["admin", "im", "rig"],
  },
  {
    href: "/inventory",
    title: "Inventory",
    desc: "Search, filter and open any item and its history.",
    icon: "list",
    roles: ["admin", "im", "rig"],
  },
  {
    href: "/handover/receipts",
    title: "Receipts",
    desc: "View and download every receipt. Admins can edit or delete.",
    icon: "database",
    roles: ["admin", "im", "rig"],
  },
  {
    href: "/handover/send",
    title: "Send items",
    desc: "Hand items to an IM, IFO, FO, the rig team or a hub.",
    icon: "send",
    roles: HANDLERS,
  },
  {
    href: "/handover/receive",
    title: "Receive items",
    desc: "Take items back into stock at a hub.",
    icon: "inbox",
    roles: HANDLERS,
  },
  {
    href: "/admin/people",
    title: "Manage people",
    desc: "The IMs, IFOs, FOs and rig team.",
    icon: "users",
    roles: ["admin", "im"],
  },
];

const ADMIN: Tile[] = [
  {
    href: "/admin/hubs",
    title: "Manage hubs",
    desc: "Add hubs and arrange the hierarchy.",
    icon: "pin",
    roles: ["admin"],
  },
  {
    href: "/admin/users",
    title: "Manage users",
    desc: "Who can sign in, and as what.",
    icon: "shield",
    roles: ["admin"],
  },
  {
    href: "/admin/deletions",
    title: "Deleted items log",
    desc: "Which admin deleted which item, and when.",
    icon: "clock",
    roles: ["admin"],
  },
];

function Section({
  label,
  tiles,
}: {
  label: string;
  tiles: Tile[];
}) {
  if (tiles.length === 0) return null;

  return (
    <>
      <p className={styles.sectionLabel}>{label}</p>

      <div className={styles.menuGrid}>
        {tiles.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={styles.menuItem}
          >
            <span className={styles.menuIcon}>
              <Icon name={t.icon} size={22} />
            </span>

            <span className={styles.menuBody}>
              <span className={styles.menuTitle}>
                {t.title}
              </span>

              <span className={styles.menuDesc}>
                {t.desc}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}

export default async function Home({
  searchParams,
}: PageProps<"/">) {
  const user = await requireRole();
  const sp = await searchParams;

  const email = user.email ?? "";
  const initials = [email.split("@")[0] || "?"]
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join("");

  // Good morning / afternoon / evening, by the hour in India.
  const hour = Number(istTimestamp().slice(11, 13));

  const greeting =
    hour < 12
      ? "Good morning"
      : hour < 17
        ? "Good afternoon"
        : "Good evening";

  return (
    <div className={styles.root}>
      <main className={styles.wrap}>
        <div className={styles.top}>
          <div className={styles.brand}>
            <span className={styles.brandIconPlain}>
              <Icon name="layers" size={26} />
            </span>

            <div>
              <h1>Inventory</h1>

              <p className={styles.subtitle}>
                {greeting}. SD card tracking across hubs.
              </p>
            </div>
          </div>

          <div className={styles.actions}>
            <div className={styles.userChip}>
              <span
                className={styles.avatar}
                aria-hidden
              >
                {initials}
              </span>

              <span className={styles.userMeta}>
                <strong>{email}</strong>
                <span>{ROLE_LABELS[user.role]}</span>
              </span>
            </div>

            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className={`${styles.btn} ${styles.btnReset}`}
              >
                <Icon name="logout" size={16} />
                {" "}Sign out
              </button>
            </form>
          </div>
        </div>

        {one(sp.denied) && (
          <p className={styles.banner}>
            Your role can&apos;t open that page.
          </p>
        )}

        <Section
          label="Work"
          tiles={WORK.filter((t) =>
            t.roles.includes(user.role)
          )}
        />

        <Section
          label="Admin"
          tiles={ADMIN.filter((t) =>
            t.roles.includes(user.role)
          )}
        />
      </main>
    </div>
  );
}