-- Kageflow 0026: a car advertised from a supplier's floor plan, not yet bought (own migration: a new enum value
-- can't be used in the transaction that adds it)
alter type public.unit_status add value if not exists 'listed' after 'on_order';
