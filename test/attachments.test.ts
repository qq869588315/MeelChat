import { buildFileAttachmentText } from "@/app/utils/attachments";

describe("file attachment persistence", () => {
  test("sends file contents to the model but stores only placeholders", () => {
    const privateFileBody = "private file body that must stay off sync storage";
    const { requestText, savedText } = buildFileAttachmentText("analyze this", [
      {
        name: "notes.txt",
        content: privateFileBody,
        size: privateFileBody.length,
      },
    ]);

    expect(requestText).toContain(privateFileBody);
    expect(requestText).toContain('<file name="notes.txt">');
    expect(savedText).toBe("analyze this\n\n[文件未同步: notes.txt]");
    expect(savedText).not.toContain(privateFileBody);
  });

  test("keeps plain messages unchanged when no files are attached", () => {
    expect(buildFileAttachmentText("hello")).toEqual({
      requestText: "hello",
      savedText: "hello",
    });
  });
});
