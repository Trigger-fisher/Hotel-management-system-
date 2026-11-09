-- rollback: ALTER TABLE platform.platform_admin_hotel_access DROP CONSTRAINT IF EXISTS platform_admin_hotel_access_view_only;
-- A Platform Admin visits hotels view only (MJ, 5 Nov 2026: full power is the Super Admin's only). A level 'full' given before today becomes 'view'; the app refuses 'full' (staffService),
-- and a visit's access for anyone but the Super Admin is view (visitService.accessFor).
UPDATE platform.platform_admin_hotel_access SET level = 'view' WHERE level = 'full';

ALTER TABLE platform.platform_admin_hotel_access DROP CONSTRAINT IF EXISTS platform_admin_hotel_access_view_only;
ALTER TABLE platform.platform_admin_hotel_access ADD CONSTRAINT platform_admin_hotel_access_view_only CHECK (level IN ('none', 'view'));
