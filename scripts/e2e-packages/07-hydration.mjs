// Which pages throw browser errors (hydration etc.) on a plain visit.
import { launch, login, goto, check, summary } from "./lib.mjs";

const { browser, page, errors } = await launch();
try {
  await login(page);
  for (const p of ["/", "/packages", "/shipments", "/dashboard/tests", "/testing", "/settings/packages", "/settings/item-types", "/settings/testing-routes", "/files"]) {
    const before = errors.length;
    await goto(page, p);
    await new Promise((r) => setTimeout(r, 1500));
    const mine = errors.slice(before);
    check(`no browser errors on ${p}`, mine.length === 0, mine.map((e) => e.slice(0, 160)).join(" || "));
  }
} finally {
  summary();
  await browser.close();
}
