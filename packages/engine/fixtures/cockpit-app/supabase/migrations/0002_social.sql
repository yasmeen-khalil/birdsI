create table profiles (id uuid primary key, handle text);
alter table users add column handle text;
