-- rollback: DROP INDEX IF EXISTS meal_plan_rates_plan_day_key;
-- One price per meal plan per effective date (without regard to the plan's case): Pallav's MealPlanRateController updates the existing row for that
-- date. A second one for the same date replaces it (the admin repository's upsert); the database makes it a rule.
CREATE UNIQUE INDEX meal_plan_rates_plan_day_key ON meal_plan_rates (lower(plan), effective_from);
