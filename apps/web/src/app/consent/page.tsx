import type { Metadata } from "next";
import { LegalDocument } from "../components/legal-document";
import { legalDocument } from "../lib/legal-documents";
import { loadLegalSettings } from "../lib/public-settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Согласие на обработку данных",
  alternates: { canonical: "/consent" },
  description: "Согласие пользователя на обработку персональных данных для выполнения заказа.",
};

export default async function ConsentPage() {
  const settings = await loadLegalSettings();
  return <LegalDocument {...legalDocument("consent", settings)} />;
}
