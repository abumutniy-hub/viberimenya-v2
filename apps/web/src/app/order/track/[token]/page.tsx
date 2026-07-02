import { TrackClient } from "./track-client";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function Page({ params }: PageProps) {
  const { token } = await params;

  return <TrackClient token={token} />;
}
