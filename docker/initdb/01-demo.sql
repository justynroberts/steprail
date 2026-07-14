-- MIT License - Copyright (c) fintonlabs.com
-- Demo data for the bundled Postgres: enough shape to exercise real queries,
-- filters, loops and reports.
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer TEXT NOT NULL,
  total NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO orders (customer, total, status, created_at) VALUES
  ('Asha Patel',      84.50, 'paid',      now() - interval '2 hours'),
  ('Ben Okafor',     129.00, 'paid',      now() - interval '5 hours'),
  ('Chen Wei',        42.10, 'refunded',  now() - interval '8 hours'),
  ('Dana Kovacs',    310.75, 'paid',      now() - interval '12 hours'),
  ('Eli Svensson',    18.99, 'pending',   now() - interval '20 hours'),
  ('Fatima Noor',     67.30, 'paid',      now() - interval '1 day'),
  ('Georg Weber',    220.00, 'paid',      now() - interval '2 days'),
  ('Hana Sato',       95.60, 'refunded',  now() - interval '3 days'),
  ('Ivan Petrov',     54.20, 'paid',      now() - interval '4 days'),
  ('Jade Muller',    410.00, 'paid',      now() - interval '5 days'),
  ('Kwame Mensah',    33.45, 'pending',   now() - interval '6 days'),
  ('Lena Fischer',   150.80, 'paid',      now() - interval '7 days');

CREATE TABLE events (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO events (kind, payload, created_at) VALUES
  ('deploy',   '{"service": "api", "sha": "a1b2c3d"}', now() - interval '3 hours'),
  ('alert',    '{"service": "web", "severity": "warning"}', now() - interval '9 hours'),
  ('deploy',   '{"service": "worker", "sha": "d4e5f6a"}', now() - interval '1 day'),
  ('signup',   '{"plan": "pro", "source": "form"}', now() - interval '2 days');
