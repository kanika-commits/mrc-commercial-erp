/*
 * Add this action to the existing GOOGLE_DRIVE_DOWNLOAD_WEB_APP_URL Apps Script.
 * It preserves the existing download_file action and only adds folder inventory
 * support required by Labour Import's folder + filename workbook model.
 */

function handleListFolderFiles_(payload) {
  var folderId = String(payload.folder_id || payload.folderId || "").trim();
  if (!folderId) {
    return { success: false, error: "folder_id is required." };
  }

  var folder = DriveApp.getFolderById(folderId);
  var files = [];
  var iterator = folder.getFiles();

  while (iterator.hasNext()) {
    var file = iterator.next();
    files.push({
      file_id: file.getId(),
      file_url: file.getUrl(),
      file_name: file.getName(),
      mime_type: file.getMimeType(),
      size_bytes: file.getSize()
    });
  }

  return {
    success: true,
    folder_id: folder.getId(),
    folder_url: folder.getUrl(),
    folder_name: folder.getName(),
    files: files
  };
}

/*
 * In the existing doPost action router, add:
 *
 * if (payload.action === "list_folder_files") {
 *   return jsonResponse_(handleListFolderFiles_(payload));
 * }
 *
 * Use the existing JSON response helper already used by download_file.
 */
