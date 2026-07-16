import type { Metadata } from "next";
import { LegalDocument } from "../components/legal-document";
import { legalDocument } from "../lib/legal-documents";
import { loadLegalSettings } from "../lib/public-settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Политика конфиденциальности",
  alternates: { canonical: "/privacy" },
  description: "Правила обработки персональных данных покупателей и получателей заказов.",
};

export default async function PrivacyPage() {
  const settings = await loadLegalSettings();
  return <LegalDocument {...legalDocument("privacy", settings)} />;
}
