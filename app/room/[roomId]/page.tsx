import Board from "@/components/Board";

export default async function RoomPage({ params, searchParams }: { params: Promise<{ roomId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { roomId } = await params;
  const query = await searchParams;
  const role = query.role === "viewer" ? "viewer" : "editor";
  const token = typeof query.token === "string" ? query.token : "";
  const viewerToken = typeof query.viewer === "string" ? query.viewer : "";
  const local = query.local === "1";
  return <Board roomId={roomId} role={role} token={token} viewerToken={viewerToken} local={local} />;
}
