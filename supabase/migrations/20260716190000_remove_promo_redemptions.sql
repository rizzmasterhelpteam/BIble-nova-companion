drop table if exists public.promo_redemptions;

update auth.users
set raw_app_meta_data = raw_app_meta_data - 'subscription'
where raw_app_meta_data->'subscription'->>'source' = 'promo_code';
