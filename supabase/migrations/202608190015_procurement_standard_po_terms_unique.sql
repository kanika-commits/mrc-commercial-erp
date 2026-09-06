-- Keep one active Standard Purchase Order Terms template per company.
create unique index if not exists company_po_terms_templates_one_standard_active_idx
  on public.company_po_terms_templates (organization_id, company_id)
  where status = 'active' and template_name = 'Standard Purchase Order Terms';
