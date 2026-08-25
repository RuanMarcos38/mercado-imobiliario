update public.affiliate_settings
set hold_days = 30,
    updated_at = now()
where id = 1;
