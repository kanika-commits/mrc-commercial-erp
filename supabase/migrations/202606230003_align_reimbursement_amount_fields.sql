alter table public.reimbursement_claims
  add column if not exists amount numeric not null default 0,
  add column if not exists gst_amount numeric not null default 0,
  add column if not exists total_amount numeric not null default 0,
  add column if not exists payment_id uuid references public.payments(id) on delete set null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'reimbursement_claims'
      and column_name = 'claim_amount'
  ) then
    execute '
      update public.reimbursement_claims
      set
        amount = coalesce(nullif(amount, 0), claim_amount, 0),
        total_amount = coalesce(nullif(total_amount, 0), claim_amount, 0)
      where claim_amount is not null
    ';

    execute 'alter table public.reimbursement_claims drop column claim_amount';
  end if;
end $$;

create index if not exists reimbursement_claims_payment_idx
  on public.reimbursement_claims (payment_id);
