-- rollback: ALTER TABLE bill_master_bills DROP COLUMN IF EXISTS hotel_sac, DROP COLUMN IF EXISTS food_sac;
-- SAC codes on GST bills (MJ, 5 Nov 2026; his CA confirms them once): rooms (accommodation) 996311, restaurant food 996331. Each bill keeps the codes it was made with, so a
-- later change of the codes never changes a bill already given. Adding the columns with a constant default fills every existing bill with the codes the tax invoice has always
-- printed, without rewriting the table or firing its triggers; new bills are written with the codes HMS holds at that moment (ui-shared billing GST_SAC).
ALTER TABLE bill_master_bills ADD COLUMN IF NOT EXISTS hotel_sac varchar(8) NOT NULL DEFAULT '996311' CHECK (hotel_sac ~ '^[0-9]{4,8}$');
ALTER TABLE bill_master_bills ADD COLUMN IF NOT EXISTS food_sac varchar(8) NOT NULL DEFAULT '996331' CHECK (food_sac ~ '^[0-9]{4,8}$');
