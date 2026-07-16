import type { Metadata } from "next";
import { LegalDocument } from "../components/legal-document";
import { legalDocument } from "../lib/legal-documents";
import { loadLegalSettings } from "../lib/public-settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Публичная оферта",
  alternates: { canonical: "/offer" },
  description: "Условия оформления, оплаты, сборки и доставки заказов.",
};

export default async function OfferPage() {
  const settings = await loadLegalSettings();
  return <LegalDocument {...legalDocument("offer", settings)} />;
}
