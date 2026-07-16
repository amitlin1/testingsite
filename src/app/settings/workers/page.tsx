"use client";
import WorkersTable from "./WorkersTable";

export default function WorkersPage() {
  return (
    <WorkersTable
      title="ניהול עובדים"
      subtitle="הוספה, עריכה ומחיקה של עובדים במערכת."
      countLabel="עובדים"
    />
  );
}
