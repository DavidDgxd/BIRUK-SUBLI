-- Admin-editable bilingual synonyms for public search.
--
-- The AI service loads this table (60-second cache) and falls back to the
-- built-in glossary in ai-service/glossary.py if the database is unreachable.
-- Editing a row takes effect on the next cache refresh; no deploy is needed.
--
-- Only the service role can read it: the table is internal search vocabulary,
-- not a public listing. Add an admin RPC if a UI is added later.

create table if not exists public.search_synonyms (
    term text primary key,
    synonyms text[] not null check (cardinality(synonyms) > 0),
    enabled boolean not null default true,
    updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.search_synonyms enable row level security;

revoke all on table public.search_synonyms from anon, authenticated;
grant all on table public.search_synonyms to service_role;

create or replace function public.touch_search_synonyms()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    new.updated_at := timezone('utc'::text, now());
    return new;
end;
$$;

drop trigger if exists search_synonyms_touch on public.search_synonyms;
create trigger search_synonyms_touch
before update on public.search_synonyms
for each row execute function public.touch_search_synonyms();

insert into public.search_synonyms (term, synonyms) values
    ('aklat', array['book']),
    ('asul', array['blue']),
    ('bago', array['new']),
    ('bahay', array['house']),
    ('barya', array['coins', 'change']),
    ('basag', array['cracked', 'broken']),
    ('basahan', array['rag', 'cloth']),
    ('baso', array['glass', 'cup']),
    ('baunan', array['lunch box', 'container']),
    ('bayong', array['bag', 'basket']),
    ('bentilador', array['fan', 'electric fan']),
    ('berde', array['green']),
    ('bimpo', array['towel', 'washcloth']),
    ('bola', array['ball']),
    ('bolpen', array['pen']),
    ('bote', array['bottle']),
    ('bughaw', array['blue']),
    ('damit', array['clothes', 'clothing']),
    ('dilaw', array['yellow']),
    ('dyaket', array['jacket']),
    ('eskwela', array['school']),
    ('eskwelaham', array['school']),
    ('ginto', array['gold', 'golden']),
    ('guwantes', array['gloves']),
    ('hikaw', array['earring', 'earrings']),
    ('itim', array['black']),
    ('kahel', array['orange']),
    ('kaldero', array['pot']),
    ('kamiseta', array['shirt', 't-shirt']),
    ('kawali', array['pan', 'frying pan']),
    ('kayumanggi', array['brown']),
    ('kompyuter', array['computer', 'laptop']),
    ('kotse', array['car']),
    ('kumot', array['blanket']),
    ('kuryente', array['power', 'electric']),
    ('kutsara', array['spoon']),
    ('kutsilyo', array['knife']),
    ('kuwaderno', array['notebook']),
    ('kuwintas', array['necklace']),
    ('kwaderno', array['notebook']),
    ('kwintas', array['necklace']),
    ('lalagyan', array['case', 'container', 'pouch']),
    ('lapis', array['pencil']),
    ('laruan', array['toy']),
    ('libro', array['book']),
    ('lila', array['purple']),
    ('luma', array['old']),
    ('luntian', array['green']),
    ('mahaba', array['long']),
    ('maikli', array['short']),
    ('malaki', array['large', 'big']),
    ('maleta', array['suitcase', 'luggage']),
    ('maliit', array['small', 'little']),
    ('manika', array['doll']),
    ('medyas', array['socks']),
    ('ospital', array['hospital']),
    ('paaralan', array['school']),
    ('palda', array['skirt']),
    ('palengke', array['market']),
    ('pantalon', array['pants', 'trousers']),
    ('panyo', array['handkerchief']),
    ('papel', array['paper']),
    ('parke', array['park']),
    ('payong', array['umbrella']),
    ('pera', array['money', 'cash']),
    ('pilak', array['silver']),
    ('pitaka', array['wallet', 'purse']),
    ('plantsa', array['iron']),
    ('plato', array['plate', 'dish']),
    ('pula', array['red']),
    ('pulseras', array['bracelet']),
    ('puti', array['white']),
    ('relo', array['watch', 'wristwatch']),
    ('rosaryo', array['rosary']),
    ('rosas', array['pink']),
    ('salamin', array['glasses', 'eyeglasses', 'mirror']),
    ('sapatos', array['shoes', 'shoe', 'sneakers']),
    ('sasakyan', array['vehicle', 'car']),
    ('selpon', array['phone', 'cellphone', 'iphone']),
    ('simbahan', array['church']),
    ('singsing', array['ring']),
    ('sinturon', array['belt']),
    ('sira', array['broken', 'damaged']),
    ('sombrero', array['hat', 'cap']),
    ('suklay', array['comb']),
    ('sulat', array['letter', 'note']),
    ('sumbrero', array['hat', 'cap']),
    ('supot', array['bag', 'plastic bag']),
    ('susi', array['keys']),
    ('telebisyon', array['television', 'tv']),
    ('telepono', array['phone', 'cellphone', 'iphone']),
    ('tinidor', array['fork']),
    ('tsinelas', array['slippers', 'sandals']),
    ('tubig', array['water']),
    ('tubigan', array['water bottle']),
    ('tuwalya', array['towel']),
    ('unan', array['pillow']),
    ('uniporme', array['uniform']),
    ('walis', array['broom'])
on conflict (term) do nothing;
