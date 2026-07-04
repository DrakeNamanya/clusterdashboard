-- ============================================================================
-- reach_targets — per-district, per-month programme targets (from Targets.xlsx).
-- One row per (district, month). `month` is the first day of the month.
--   Monthly_Target      -> target
--   Monthly_SHGs        -> target_shgs
--   Monthly_YiW(70%)    -> target_yiw
--   Monthly_Female(70%) -> target_female
--   Monthly_PWDs(3%)    -> target_pwds
--
-- Card semantics for the dashboards:
--   Target_Selected_Period = SUM(target) over rows matching the selected
--                            districts AND months in the selected date range.
--   Monthly_Target         = average per-month target across those same rows
--                            (i.e. Target_Selected_Period / months_in_range),
--                            which for a single month equals that month's total.
-- ============================================================================

create table if not exists public.reach_targets (
  cluster        text,
  district       text not null,
  month          date not null,
  target         numeric,
  target_shgs    numeric,
  target_yiw     numeric,
  target_female  numeric,
  target_pwds    numeric,
  primary key (district, month)
);
create index if not exists reach_targets_month_idx on public.reach_targets (month);

grant select on public.reach_targets to anon, service_role;
