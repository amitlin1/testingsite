import next from "eslint-config-next";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...next,
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      ".tmp-testingsite-next-app/**",
      // A design handoff (static .dc.html mockups and their support.js): never compiled, never
      // imported by the app — not app code.
      "route-fields-handoff/**",
    ],
  },
];

export default eslintConfig;
