alter table public.ai_provider_settings
  add column if not exists generation_mode text not null default 'auto';

alter table public.ai_provider_settings
  drop constraint if exists ai_provider_settings_generation_mode_check;

alter table public.ai_provider_settings
  add constraint ai_provider_settings_generation_mode_check
  check (generation_mode in ('auto', 'primary', 'backup'));

comment on column public.ai_provider_settings.generation_mode is
  'Global AI generation routing mode: auto, primary, or backup.';

notify pgrst, 'reload schema';
