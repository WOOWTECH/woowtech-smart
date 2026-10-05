import { createExpoAttachmentFileSystem } from "@/attachments/attachment-file-system";
import { createLocalFileAttachmentStore } from "@/attachments/local-file-attachment-store";
import { pathToFileUri } from "@/attachments/utils";

export function createNativeFileAttachmentStore() {
  return createLocalFileAttachmentStore({
    storageType: "native-file",
    baseDirectoryName: "paseo-native-attachments",
    fileSystem: createExpoAttachmentFileSystem(),
    // woowtech smart: the same URI as pathToFileUri, with #, ? and % encoded.
    resolvePreviewUrl: async (attachment) => pathToFileUri(attachment.storageKey),
  });
}
