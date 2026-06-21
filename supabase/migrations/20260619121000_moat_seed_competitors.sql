-- Initial Moat competitor seed. Reviews are intentionally not seeded.

INSERT INTO public.competitors (name, slug, status, metadata)
VALUES
  ('Scaler', 'scaler', 'active', '{}'::jsonb),
  ('UpGrad', 'upgrad', 'active', '{}'::jsonb),
  ('Great Learning', 'great-learning', 'active', '{}'::jsonb),
  ('Simplilearn', 'simplilearn', 'active', '{}'::jsonb),
  ('Intellipaat', 'intellipaat', 'active', '{}'::jsonb),
  ('AlmaBetter', 'almabetter', 'active', '{}'::jsonb),
  ('Coding Ninjas', 'coding-ninjas', 'active', '{}'::jsonb),
  ('PW Skills', 'pw-skills', 'active', '{}'::jsonb),
  ('DataMites', 'datamites', 'active', '{}'::jsonb),
  ('ExcelR', 'excelr', 'active', '{}'::jsonb),
  ('AnalytixLabs', 'analytixlabs', 'active', '{}'::jsonb),
  ('Edureka', 'edureka', 'active', '{}'::jsonb),
  ('OdinSchool', 'odinschool', 'active', '{}'::jsonb),
  ('Newton School', 'newton-school', 'active', '{}'::jsonb),
  ('AccioJob', 'acciojob', 'active', '{}'::jsonb),
  ('Masai', 'masai', 'active', '{}'::jsonb)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  updated_at = now();
