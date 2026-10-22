-- Kageflow 0013a: payment methods for trade-in credits and bank payouts (enum values need their own migration)
alter type public.payment_method add value if not exists 'trade_in';
alter type public.payment_method add value if not exists 'bank_payout';
