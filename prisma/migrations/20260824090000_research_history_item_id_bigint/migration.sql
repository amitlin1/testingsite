-- research_history.item_id was int4 while items.item_id / item_routes.item_id are
-- bigint. Item ids are built by string-concatenation (customer/date/counter), so
-- the 10th item of a day for a three-digit customer already exceeds 2^31-1 and
-- the INSERT in /api/testing/results aborts with 22003 (numeric_value_out_of_range).
ALTER TABLE "research_history" ALTER COLUMN "item_id" TYPE BIGINT;
