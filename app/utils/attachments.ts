export type ChatFileAttachment = {
  name: string;
  content: string;
  size: number;
};

export function buildFileAttachmentText(
  content: string,
  attachments: ChatFileAttachment[] = [],
) {
  const requestFiles = attachments
    .map((file) =>
      [`<file name="${file.name}">`, file.content, "</file>"].join("\n"),
    )
    .join("\n\n");
  const savedFiles = attachments
    .map((file) => `[文件未同步: ${file.name}]`)
    .join("\n");

  return {
    requestText: [content, requestFiles].filter(Boolean).join("\n\n"),
    savedText: [content, savedFiles].filter(Boolean).join("\n\n"),
  };
}
