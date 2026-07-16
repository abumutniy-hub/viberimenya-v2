import "./admin-operations.css";
import "./admin-growth.css";
import { AdminShell } from "./components/admin-shell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
