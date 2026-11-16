CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY,
  merchant TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uncovered', -- 'uncovered', 'reserved', 'paid'
  is_recurring INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  ocr_raw TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS budget_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  monthly_income REAL NOT NULL DEFAULT 5000.00,
  monthly_limit REAL NOT NULL DEFAULT 4200.00,
  current_spent REAL NOT NULL DEFAULT 1719.50,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO budget_settings (id, monthly_income, monthly_limit, current_spent)
VALUES (1, 5000.00, 4200.00, 1719.50);

INSERT OR IGNORE INTO bills (id, merchant, amount, category, due_date, status, is_recurring)
VALUES
  ('bill-1', 'Con Edison', 112.40, 'Utilities', '2026-11-01', 'reserved', 1),
  ('bill-2', 'Apple Services', 14.99, 'Subscriptions', '2026-11-05', 'reserved', 1),
  ('bill-3', 'State Farm Insurance', 185.00, 'Insurance', '2026-11-12', 'reserved', 1),
  ('bill-4', 'Verizon Wireless', 137.61, 'Telecom', '2026-11-15', 'reserved', 1),
  ('bill-5', 'Equinox Fitness', 260.00, 'Health & Fitness', '2026-11-20', 'uncovered', 1);
