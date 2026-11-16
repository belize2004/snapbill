-- Reset all tables to zero / clean state
DELETE FROM bills;

UPDATE budget_settings
SET monthly_income = 0.00,
    monthly_limit = 0.00,
    current_spent = 0.00,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;
