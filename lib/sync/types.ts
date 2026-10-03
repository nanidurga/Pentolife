// The subset of an Excalidraw element that sync logic relies on.
export type SyncElement = {
  id: string;
  version: number;
  versionNonce: number;
  index?: string | null;
  isDeleted?: boolean;
};
