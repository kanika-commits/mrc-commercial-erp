"use client";

export type WorkOrderPilotDraft = {
  form: any;
  keyTerms: any;
  lines: any[];
  supportingDocuments: File[];
  payload: any;
  previewUrl: string;
};

let draft: WorkOrderPilotDraft | null = null;

export function getWorkOrderPilotDraft() {
  return draft;
}

export function setWorkOrderPilotDraft(next: WorkOrderPilotDraft) {
  draft = next;
}
