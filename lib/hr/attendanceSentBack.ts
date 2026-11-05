export function getAttendanceSentBackDetails(dailySubmission: any, period: any) {
  const daily = String(dailySubmission?.status || "").toLowerCase() === "reopened"
    ? dailySubmission
    : null;

  return {
    reason: daily?.reopen_reason || period?.send_back_reason || "No reason recorded.",
    sender: daily?.reopened_by_name || daily?.reopened_by_email || period?.reopened_by_name || period?.reopened_by_email || "-",
    sentBackAt: daily?.reopened_at || period?.reopened_at || null,
    previouslySubmittedAt: daily?.submitted_at || period?.submitted_at || null,
  };
}
