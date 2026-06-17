/**
 * Google Apps Script Web App Endpoint
 * Appends approved gas refill request data from Vercel to active sheet.
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    // Acquire a 10-second lock to prevent concurrent write collisions
    lock.waitLock(10000);
    
    // Parse the incoming JSON payload from Vercel
    const data = JSON.parse(e.postData.contents);
    
    // Get the active spreadsheet and locate target sheet
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("ApprovedRequests");
    if (!sheet) {
      // Create it if it doesn't exist yet
      sheet = ss.insertSheet("ApprovedRequests");
      // Append headers
      sheet.appendRow([
        "Request ID",
        "Submitted Date",
        "Employee Name",
        "Employee Mobile",
        "Branch/Location",
        "Cylinder Type",
        "Quantity (Kg)",
        "Expected Amount (₹)",
        "Approved Amount (₹)",
        "Admin Remarks",
        "Status",
        "Approved By",
        "Approval Date & Time"
      ]);
      // Format headers bold
      sheet.getRange("A1:M1").setFontWeight("bold");
    }
    
    // Helper to format ISO timestamps cleanly
    const formatDate = (isoString) => {
      if (!isoString) return "";
      try {
        const d = new Date(isoString);
        return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
      } catch (err) {
        return isoString;
      }
    };

    // Prepare the row array
    const rowData = [
      data.request_id || "",
      formatDate(data.created_at),
      data.employee_name || "",
      data.employee_mobile || "",
      data.branch || "",
      data.cylinder_type || "",
      data.quantity || 0,
      data.expected_amount || 0,
      data.approved_amount || 0,
      data.admin_remarks || "",
      data.status || "",
      data.approved_by || "",
      formatDate(data.approval_date_time)
    ];
    
    // Append the record
    sheet.appendRow(rowData);
    
    return ContentService.createTextOutput(JSON.stringify({ success: true, message: "Request sync successful" }))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    console.error("Error writing to sheet:", error);
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
                         .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
