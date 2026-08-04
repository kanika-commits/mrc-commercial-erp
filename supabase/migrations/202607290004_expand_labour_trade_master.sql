begin;

with trade_seed(trade_name, trade_code) as (
  values
    ('Labour', 'LAB'),
    ('Contractual Labour', 'CONLAB'),
    ('Coolie', 'COO'),
    ('Helper', 'HEL'),
    ('Mason', 'MAS'),
    ('Carpenter', 'CAR'),
    ('Bar Bender', 'BAR'),
    ('Steel Fixer', 'STL'),
    ('Plumber', 'PLU'),
    ('Electrician', 'ELE'),
    ('Welder', 'WEL'),
    ('Painter', 'PAI'),
    ('Scaffolder', 'SCA'),
    ('Rigger', 'RIG'),
    ('Foreman', 'FOR'),
    ('Supervisor', 'SUP'),
    ('Site Supervisor', 'SITSUP'),
    ('Store Keeper', 'STOKEP'),
    ('Store Incharge', 'STOINC'),
    ('Cook', 'COOK'),
    ('Cook Helper', 'COOHEL'),
    ('Sweeper', 'SWP'),
    ('Housekeeping', 'HOU'),
    ('Security Guard', 'SEC'),
    ('Driver', 'DRI'),
    ('JCB Operator', 'JCB'),
    ('Crane Operator', 'CRO'),
    ('Plant Operator', 'PLO'),
    ('Concrete Plant Operator', 'CPO'),
    ('Concrete Pump Operator', 'CPUO'),
    ('Pump Operator', 'PUO'),
    ('Generator Operator', 'GENOP'),
    ('Excavator Operator', 'EXCOP'),
    ('Dumper Operator', 'DUMOP'),
    ('Roller Operator', 'ROLOP'),
    ('Lab Incharge', 'LABINC')
)
insert into public.labour_trades (organization_id, trade_name, trade_code, status)
select o.id, s.trade_name, s.trade_code, 'active'
from public.organizations o
cross join trade_seed s
where not exists (
  select 1
  from public.labour_trades t
  where t.organization_id = o.id
    and upper(regexp_replace(trim(t.trade_name), '\s+', ' ', 'g')) = upper(regexp_replace(trim(s.trade_name), '\s+', ' ', 'g'))
    and t.status <> 'deleted'
);

commit;
