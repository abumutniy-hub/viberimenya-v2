import type { Metadata } from "next";
import { LegalDocument } from "../components/legal-document";
import { legalDocument } from "../lib/legal-documents";
import { loadLegalSettings } from "../lib/public-settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Возврат и претензии",
  alternates: { canonical: "/returns" },
  description: "Как сообщить о проблеме с заказом и как рассматриваются возвраты.",
};

export default async function ReturnsPage() {
  const settings = await loadLegalSettings();
  return <LegalDocument {...legalDocument("returns", settings)} />;
}
