import type { Metadata } from "next";
import { LegalDocument } from "../components/legal-document";
import { legalDocument } from "../lib/legal-documents";
import { loadLegalSettings } from "../lib/public-settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Условия доставки",
  alternates: { canonical: "/delivery" },
  description: "Зоны, интервалы, стоимость и правила вручения заказов.",
};

export default async function DeliveryTermsPage() {
  const settings = await loadLegalSettings();
  return <LegalDocument {...legalDocument("delivery", settings)} />;
}
