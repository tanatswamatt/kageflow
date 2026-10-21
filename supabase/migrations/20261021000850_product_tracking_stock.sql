-- Kageflow 0009a: enum values must be added in their own migration before 0009 uses them
alter type public.product_tracking add value if not exists 'stock';
create type public.stock_move_kind as enum ('receipt', 'sale', 'return', 'adjustment');
