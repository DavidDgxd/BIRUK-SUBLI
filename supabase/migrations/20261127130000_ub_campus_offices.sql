-- Issue #127: move the office directory to University of Baguio campus scope.
--
-- The directory used Baguio City offices (BCPIO, CITY_HALL_INFO, MARKET). This
-- replaces them with the University of Baguio campus counters and refreshes the
-- campus addresses so no public office text says "Baguio City". It is
-- idempotent, so re-running it is safe.
--
-- Items still point at a legacy office with ON DELETE RESTRICT, so they are
-- reassigned to the Security Office before the delete. login_history.office_id
-- is ON DELETE SET NULL, so deleting the old offices only clears the stale
-- reference and keeps the audit row. In non-production environments, a legacy
-- office with a linked staff login (auth_user_id) is left unlinked until
-- reassigned.

-- Canonical campus offices. Status is not overwritten, so a counter that was
-- deliberately suspended stays suspended.
insert into public.offices (id, name, address, counter_hours, status) values
    ('UB_SECURITY', 'University of Baguio Security Office',
     'University of Baguio, Gen. Luna Road, Baguio',
     'Mon-Fri, 8:00 AM - 5:00 PM', 'active'),
    ('UB_INFO_DESK', 'UB Information Desk',
     'University of Baguio Main Lobby, Gen. Luna Road, Baguio',
     'Mon-Fri, 8:00 AM - 5:00 PM', 'active'),
    ('UB_LIBRARY', 'University of Baguio Library',
     'University of Baguio Library, Gen. Luna Road, Baguio',
     'Mon-Fri, 8:00 AM - 5:00 PM', 'active'),
    ('UB_STUDENT_CENTER', 'UB Student Center',
     'University of Baguio Student Center, Gen. Luna Road, Baguio',
     'Mon-Sat, 7:00 AM - 7:00 PM', 'active')
on conflict (id) do update set
    name = excluded.name,
    address = excluded.address,
    counter_hours = excluded.counter_hours;

-- Re-point custody rows that still reference a legacy city office. The items
-- foreign keys are ON DELETE RESTRICT, so this must run before the delete.
update public.items
   set holding_office_id = 'UB_SECURITY'
 where holding_office_id in ('BCPIO', 'CITY_HALL_INFO', 'MARKET');
update public.items
   set logging_office_id = 'UB_SECURITY'
 where logging_office_id in ('BCPIO', 'CITY_HALL_INFO', 'MARKET');
update public.items
   set releasing_office_id = 'UB_SECURITY'
 where releasing_office_id in ('BCPIO', 'CITY_HALL_INFO', 'MARKET');

delete from public.offices
 where id in ('BCPIO', 'CITY_HALL_INFO', 'MARKET');
