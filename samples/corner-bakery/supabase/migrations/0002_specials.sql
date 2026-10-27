alter table menu_items add column if not exists special_since timestamptz;
create index if not exists menu_items_special_idx on menu_items (special) where special;
