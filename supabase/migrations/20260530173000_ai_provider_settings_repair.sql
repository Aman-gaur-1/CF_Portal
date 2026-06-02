-- Repair/idempotency migration for environments where the provider settings
-- feature shipped before the table was applied to the remote Supabase project.

create table if not exists public.ai_provider_settings (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'qwen',
  model text not null,
  base_url text not null,
  enabled boolean not null default true,
  priority integer not null default 1,
  is_active boolean not null default false,
  encrypted_api_key text,
  masked_key_preview text,
  last_tested_at timestamptz,
  last_test_success boolean not null default false,
  last_test_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_provider_settings_priority_check check (priority >= 1 and priority <= 100),
  constraint ai_provider_settings_base_url_check check (base_url ~* '^https?://')
);

alter table public.ai_provider_settings enable row level security;

alter table public.ai_provider_settings
  add column if not exists encrypted_api_key text,
  add column if not exists masked_key_preview text,
  add column if not exists last_tested_at timestamptz,
  add column if not exists last_test_success boolean not null default false,
  add column if not exists last_test_message text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists ai_provider_settings_one_active_idx
  on public.ai_provider_settings (is_active)
  where is_active = true;

create index if not exists ai_provider_settings_enabled_priority_idx
  on public.ai_provider_settings (enabled, priority);

create or replace function public.set_ai_provider_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ai_provider_settings_updated_at on public.ai_provider_settings;
create trigger ai_provider_settings_updated_at
before update on public.ai_provider_settings
for each row
execute function public.set_ai_provider_settings_updated_at();

insert into public.ai_provider_settings (provider, model, base_url, enabled, priority, is_active)
select 'qwen', 'qwen3-coder-480b-a35b-instruct', 'https://integrate.api.nvidia.com/v1', true, 1, true
where not exists (select 1 from public.ai_provider_settings);

comment on table public.ai_provider_settings is
  'Admin-managed AI provider routing metadata. API keys are encrypted server-side and never exposed to clients.';

comment on column public.ai_provider_settings.encrypted_api_key is
  'Server-encrypted provider API key. Never select this column in browser-facing APIs.';

comment on column public.ai_provider_settings.masked_key_preview is
  'Non-secret API key preview for admin confirmation only.';

grant all on table public.ai_provider_settings to service_role;

notify pgrst, 'reload schema';
