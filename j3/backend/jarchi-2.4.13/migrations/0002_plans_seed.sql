-- Seed the plan catalog used by billing, the Mini App and Telegram Stars.
-- Prices are the 1.2.0 defaults; admins can edit them from the Plans screen.
-- ON CONFLICT DO NOTHING keeps operator-edited prices intact on re-run.

INSERT INTO plans(id,name,duration_days,price_toman,telegram_stars,is_trial,active) VALUES
  ('trial_7d',   'آزمایشی ۷ روزه',  7,       0,    0, true,  true),
  ('monthly',    'یک ماهه',         30,  990000,  250, false, true),
  ('quarterly',  'سه ماهه',         90, 2490000,  600, false, true),
  ('semiannual', 'شش ماهه',        180, 4490000, 1100, false, true),
  ('annual',     'یک ساله',        365, 7990000, 1900, false, true)
ON CONFLICT (id) DO NOTHING;
