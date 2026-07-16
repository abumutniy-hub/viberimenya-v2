import type { Metadata } from "next";
import { TrackClient } from "./track-client";

export const metadata: Metadata = {
  title: "Отслеживание заказа",
  robots: { index: false, follow: false, noarchive: true },
};

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function Page({ params }: PageProps) {
  const { token } = await params;

  return <TrackClient token={token} />;
}
