-- Build the reusable global coursework catalog without rewriting legacy rows.
-- Only rows with a supported phase are eligible. Phase-less/unknown rows remain
-- legacy data and are intentionally excluded from automatic globalization.

begin;

create unique index if not exists coursework_items_global_identity_uidx
on public.coursework_items (
  lower(btrim(phase)),
  lower(btrim(item_type)),
  regexp_replace(lower(btrim(title)), E'\\s+', ' ', 'g')
)
where batch is null and phase is not null;

with canonical_candidates as (
  select distinct on (
    lower(btrim(phase)),
    lower(btrim(item_type)),
    regexp_replace(lower(btrim(title)), E'\\s+', ' ', 'g')
  )
    item_type,
    title,
    case lower(btrim(phase))
      when 'python' then 'Python'
      when 'data analytics' then 'Data Analytics'
      when 'sql' then 'SQL'
    end as phase,
    lower(btrim(phase)) as normalized_phase,
    lower(btrim(item_type)) as normalized_type,
    regexp_replace(lower(btrim(title)), E'\\s+', ' ', 'g') as normalized_title
  from public.coursework_items
  where batch is not null
    and phase is not null
    and lower(btrim(phase)) in ('python', 'data analytics', 'sql')
    and lower(btrim(item_type)) in ('assignment', 'project')
  order by
    lower(btrim(phase)),
    lower(btrim(item_type)),
    regexp_replace(lower(btrim(title)), E'\\s+', ' ', 'g'),
    created_at asc,
    id asc
)
insert into public.coursework_items (item_type, title, phase, batch, due_at, active)
select item_type, title, phase, null, null, true
from canonical_candidates candidate
where not exists (
  select 1
  from public.coursework_items existing
  where existing.batch is null
    and lower(btrim(existing.phase)) = candidate.normalized_phase
    and lower(btrim(existing.item_type)) = candidate.normalized_type
    and regexp_replace(lower(btrim(existing.title)), E'\\s+', ' ', 'g') = candidate.normalized_title
);

commit;
