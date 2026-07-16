import type { Metadata } from "next";

import "./admin-operations.css";
import "./admin-growth.css";
import "./admin-security.css";
import "./admin-system.css";
import { AdminShell } from "./components/admin-shell";

export const metadata: Metadata = {
  title: "CRM",
  robots: { index: false, follow: false, noarchive: true },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
